# Payments and Receipts

## Overview

The payment system supports five payment methods: Stripe card (online), cash, check, Apple Pay, and Google Pay. All monetary values are stored as integers in cents. The `payments` table is the source of truth for what has been collected. The `transaction_receipts` table provides an immutable audit log of every financial event.

---

## Payment Types

| Type | How it's recorded |
|---|---|
| Stripe card | Automated via `stripe-webhook` edge function after payment intent succeeds |
| Apple Pay / Google Pay | Processed through Stripe's checkout session — treated identically to card |
| Cash | Admin records manually via `record-cash-payment` edge function |
| Check | Admin records manually via `record-check-payment` edge function (requires check number) |

---

## Transaction Types

Every financial event is one of five transaction types:

| Type | Meaning |
|---|---|
| `deposit` | Initial deposit collected at order confirmation |
| `balance` | Remaining balance collected at or after event |
| `tip` | Optional crew tip |
| `full_payment` | Single payment covering the entire order |
| `refund` | Partial or full refund |

---

## Payments Table

The `payments` table records every individual payment event. Key columns:

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `order_id` | uuid | Which order this payment is for |
| `type` | text | Transaction type (deposit, balance, tip, full_payment, refund) |
| `amount_cents` | integer | Payment amount in cents |
| `stripe_payment_intent_id` | text | Stripe PaymentIntent ID (null for cash/check) |
| `status` | text | Payment status |
| `created_at` | timestamptz | When the payment was recorded |
| `paid_at` | timestamptz | When payment was confirmed |
| `failed_at` | timestamptz | When payment failed (if applicable) |
| `payment_method` | text | `card`, `cash`, `check`, `apple_pay`, `google_pay` |
| `payment_brand` | text | Card brand (Visa, Mastercard, etc.) |
| `payment_last4` | text | Last four digits of card |
| `ledger_sequence` | bigint | Auto-incrementing sequence for ordered financial ledger |
| `stripe_fee_amount` | integer | Stripe processing fee in cents |
| `stripe_net_amount` | integer | Net amount after Stripe fee in cents |
| `currency` | text | Currency code (typically `usd`) |
| `refunded_payment_id` | uuid | FK to original payment if this is a refund |
| `order_financials_applied` | boolean | Whether this payment updated the order totals |

### Ledger Sequence

`ledger_sequence` is an auto-incrementing big integer that provides a total ordering of all payment events across the entire system. It enables reliable financial audit queries: events can be sorted by `ledger_sequence` to get the exact order in which payments were processed, independent of timestamp precision.

### Stripe Fee Tracking

`stripe_fee_amount` and `stripe_net_amount` are populated by the `stripe-webhook` handler from the Stripe charge object. These allow the business to see the actual net revenue after Stripe's processing fees, rather than just the gross charge amount.

### Financial Application Flag

`order_financials_applied` is `true` once the payment has been applied to update `deposit_paid_cents`, `balance_paid_cents`, or `total_refunded_cents` on the order. This flag enables safe idempotency checks — the edge function can retry without double-counting.

---

## Stripe Integration

### Checkout Flow

The `stripe-checkout` edge function creates a Stripe Checkout Session or Payment Intent. It:

1. Reads the Stripe secret key from `admin_settings` (never from env vars).
2. Applies rate limiting per order (prevents duplicate checkout session creation).
3. Supports `setupMode` (card-on-file only, no charge) and `invoiceMode` (pay-later invoice).
4. Returns the session URL or client secret to the frontend.

### Webhook Processing (`stripe-webhook` edge function)

Every Stripe webhook is verified via cryptographic signature before any processing occurs. There is no dev-mode bypass — missing or invalid signatures return 400.

After verification, the idempotency system (`webhook-idempotency.ts`) checks whether the event has already been processed. If it has, the function returns immediately without re-applying changes.

Handled webhook events:
- `payment_intent.succeeded` — records payment, updates order payment status, logs transaction receipt
- `charge.refunded` — records refund, updates order, logs refund receipt
- `checkout.session.completed` — saves payment method details to order

### Stripe Refunds (`stripe-refund` edge function)

Admin-only (requires `admin` or `master` role). Accepts `orderId`, `amountCents`, and `reason`. Calls Stripe's refund API, then records the refund in `order_refunds` and logs a transaction receipt.

---

## Admin Direct Card Charge from Task Detail

Admins can charge the saved card on file directly from the Calendar Task Detail Modal without navigating to the full order detail.

**When available:** The "Charge Card on File" button appears when:
- `balance_due_cents > 0` (balance is outstanding)
- `stripe_payment_method_id` is set on the order (a card is saved)

**How it works:**
1. Button displays card brand and last four digits (e.g., "Mastercard •••• 1840")
2. Admin clicks — confirmation modal shows exact amount
3. On confirmation, calls `charge-deposit` edge function with `selectedPaymentType: 'balance'`
4. Edge function charges off-session, records payment, sends receipt email
5. `balance_due_cents` updated on order
6. Admin sees success; task card refreshes

---

## Order Approval and Deposit Charging (`src/lib/orderApprovalService.ts`)

When an admin approves an order:

1. Availability re-checked to prevent overbooking.
2. If deposit is zero: order moves to `confirmed`, card flagged for balance collection.
3. If deposit is positive: `charge-deposit` edge function charges the saved payment method.
4. Invoice created with status `paid` (fully paid), `partial` (deposit only), or `sent` (no charge).
5. Transaction receipt logged.
6. Customer receives email and SMS confirmation.

If the card is declined, a custom email and SMS are sent with a link to the Customer Portal to update the payment method. Order stays unapproved until the admin retries.

Force-approve (admin override) skips the deposit charge entirely and confirms without collecting payment.

---

## Cash and Check Payments

Both are processed through their respective edge functions, which require `admin`, `crew`, or `master` role.

The workflow is atomic:

1. A database RPC (`record_cash_payment` or `record_check_payment`) executes as a single transaction: creates the payment record, updates `deposit_paid_cents` / `balance_paid_cents` on the order, and logs the change to `order_changelog`.
2. Only after the RPC succeeds does the function log the transaction receipt and send the customer a receipt email (both are best-effort, non-atomic).

Check payments require a non-empty check number, which is stored in `payments.notes` and included in the customer receipt email.

---

## Transaction Receipt Logging (`src/lib/transactionReceiptService.ts`)

Every payment event is written to `transaction_receipts` with a unique, sequential receipt number.

### Deduplication

The primary deduplication key is `(payment_intent_id, transaction_type)`. This prevents a deposit and a tip from the same Stripe charge from collapsing into a single receipt. A fallback key of `(charge_id, transaction_type)` handles cases where only the charge ID is available.

### Grouped Receipts

When a single Stripe charge covers multiple transaction types (e.g., deposit + tip), `logGroupedTransactions()` assigns a shared `receipt_group_id` so they can be displayed together in a single admin receipt email.

### Admin Notifications

After logging, `logAndNotifyTransaction()` sends a formatted HTML receipt email to the admin. This is fire-and-forget — a send failure does not block the payment flow.

---

## Payment Amount Tracking (Orders Table)

The `orders` table tracks payment progress with these columns (all in cents):

| Column | Meaning |
|---|---|
| `deposit_due_cents` | Deposit required at confirmation |
| `deposit_paid_cents` | Amount collected toward deposit |
| `balance_due_cents` | Remaining balance |
| `balance_paid_cents` | Amount collected toward balance |
| `tip_cents` | Tip collected |
| `total_cents` | Full order total (subtotal + all fees + tax) |

Payment status is derived (not stored) using `getPaymentStatus(order)` from `src/lib/constants/statuses.ts`.

### Balance Due Calculation

`balance_due_cents` is computed excluding the tip: `total_cents - deposit_paid_cents - balance_paid_cents`. The tip is tracked separately in `tip_cents` and excluded from balance calculations to prevent tip double-counting.

---

## Customer-Selected Payment Amount

At checkout, customers can choose how much to pay:

- `customer_payment_amount_cents` — what the customer indicated they would pay
- `customer_selected_payment_type` — `deposit`, `balance`, or `custom`

This is used to pre-fill the payment amount selector in the checkout UI and is reconciled against actual Stripe charges when the webhook fires.

---

## Notification Reliability (`src/lib/notificationReliability.ts`)

The system tracks email and SMS notification failures in `notification_failures`. If three or more consecutive failures occur for the same notification type, the admin is alerted. Failures can be marked as resolved from the admin dashboard's Notification Failures panel.

---

## Reconciliation

For audit queries, the `order_refunds`, `payments`, and `transaction_receipts` tables can be joined on `order_id` and `stripe_payment_intent_id`.

Key constraints enforced by the schema:
- Every order with a Stripe payment has a corresponding transaction receipt
- Deposit and tip can coexist as separate receipts for the same Stripe charge (deduplication key includes `transaction_type`)
- Refunds are traceable back to their original charge via `original_charge_id` on `order_refunds`
- `order_financials_applied` on `payments` prevents double-counting when the webhook is retried
