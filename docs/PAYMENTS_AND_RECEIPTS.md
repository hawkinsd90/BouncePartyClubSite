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

Every financial event is one of these transaction types:

| Type | Used In | Meaning |
|---|---|---|
| `deposit` | `payments`, `transaction_receipts` | Initial deposit collected at order confirmation |
| `balance` | `payments`, `transaction_receipts` | Remaining balance collected at or after event |
| `tip` | `payments`, `transaction_receipts` | Optional crew tip |
| `full_payment` | `payments`, `transaction_receipts` | Single payment covering the entire order |
| `refund` | `transaction_receipts` | Refund event logged in receipt audit trail |
| `incidental` | `payments` only | Negative-amount payment record created in the `payments` ledger when a Stripe refund fires (`charge.refunded` webhook). Uses negative `amount_cents` and references the original payment via `refunded_payment_id`. The corresponding `transaction_receipts` entry uses type `refund`. |

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

`order_financials_applied` is `true` once the payment has been applied to update `deposit_paid_cents`, `balance_paid_cents`, or `total_refunded_cents` on the order. This flag enables safe idempotency — the edge function can retry without double-counting. It is checked and set atomically by the `apply_balance_payment_financials` RPC.

---

## Stripe Integration

### Checkout Flow

The `stripe-checkout` edge function creates a Stripe Checkout Session or Payment Intent. It:

1. Reads the Stripe secret key from `admin_settings` (never from env vars).
2. Applies rate limiting per order (prevents duplicate checkout session creation) using the order ID + IP as the identifier.
3. Performs server-side blackout date check — returns error code `DATE_BLACKED_OUT` or `SAME_DAY_PICKUP_BLACKED_OUT` if the date is blocked.
4. Supports `setupMode` (card-on-file only, no charge) and `invoiceMode` (pay-later invoice).
5. Sets Stripe session metadata: `order_id`, `payment_type`, `deposit_amount`, `tip_cents`.
6. Returns the session URL or client secret to the frontend.

### Webhook Processing (`stripe-webhook` edge function)

Every Stripe webhook is verified via cryptographic signature before any processing occurs. There is no dev-mode bypass — missing or invalid signatures return 400.

After verification, the idempotency system (`webhook-idempotency.ts`) checks whether the event has already been processed. If it has, the function returns immediately without re-applying changes.

**Handled webhook events:**

| Event | Action |
|---|---|
| `checkout.session.completed` | Saves payment method details; calls `handleDepositPayment` or `handleBalancePayment` depending on payment type; advances order status |
| `payment_intent.succeeded` | Calls `apply_balance_payment_financials` RPC atomically; updates order payment tracking |
| `charge.refunded` | Inserts a negative-amount `incidental` payment row in `payments` table (referenced via `refunded_payment_id`); creates `order_refunds` record; logs a `refund` transaction receipt |
| `setup_intent.succeeded` | Saves payment method to order; advances status if needed |

### Race-Condition Safety for Balance Payments (`reconcile-balance-payment`)

The unique constraint on `payments.stripe_payment_intent_id` acts as a distributed mutex:

1. The first caller inserts the payment row successfully.
2. Any concurrent duplicate caller gets a `23505` constraint violation.
3. Both paths call `apply_balance_payment_financials()` RPC, which checks `order_financials_applied`.
4. Only the first caller to set the flag updates the order totals. The second caller detects the flag is already true and returns without double-writing.

This guarantees exactly one update to `balance_paid_cents` even under concurrent webhook delivery.

### Deposit Charge Race-Condition Safety (`charge-deposit`)

The deposit charge function uses a sentinel value to prevent double-charging:

1. Atomically sets `deposit_paid_cents = -1` (sentinel) only if it is currently `<= 0`.
2. If the update touches 0 rows (another caller already set the sentinel), returns `409 Conflict`.
3. If the Stripe charge fails, the sentinel is released (reset to 0).
4. After a successful charge, the real `deposit_paid_cents` value is written.

This ensures exactly one deposit charge fires even if the approval button is clicked multiple times or two admin sessions are open simultaneously.

### Tip Handling

Tips are included in the total Stripe charge amount but tracked separately:
- `charge amount = payment_amount + tip_cents`
- `deposit_paid_cents` is set to `payment_amount` only (tip excluded)
- `tip_cents` is stored separately on the order
- Balance due calculation excludes tip to prevent double-counting: `balance_due_cents = total_cents - deposit_paid_cents - balance_paid_cents`

### Stripe Refunds (`stripe-refund` edge function)

Admin-only (requires `admin` or `master` role). Accepts `orderId`, `amountCents`, and `reason`. Calls Stripe's refund API, then records the refund in `order_refunds` and logs a transaction receipt.

---

## Admin Direct Card Charge from Task Detail

Admins can charge the saved card on file directly from the Calendar Task Detail Modal without navigating to the full order detail.

**When available:** The "Charge Card on File" button appears when:
- `balance_due_cents > 0` (balance is outstanding)
- `stripe_payment_method_id` is set on the order (a card is saved)

**Display:** Button shows card brand and last four digits (e.g., "Mastercard •••• 1840") from `payment_method_brand` and `payment_method_last_four` on the order.

**How it works:**
1. Admin clicks — confirmation modal shows exact amount
2. On confirmation, calls `charge-deposit` edge function with `selectedPaymentType: 'balance'`
3. Edge function charges off-session, records payment, sends receipt email
4. `balance_due_cents` updated on order
5. Admin sees success; task card refreshes

---

## Order Approval and Deposit Charging (`src/lib/orderApprovalService.ts`)

When an admin approves an order:

1. Availability re-checked to prevent overbooking.
2. Idempotency guard: aborts if order is already `confirmed`, `cancelled`, or `void`.
3. **Zero-deposit path:** If `deposit_due_cents <= 0`, sets `stripe_payment_status = 'paid'` (signals the payment obligation is satisfied without an actual charge) and skips to confirmation.
4. **Standard deposit path:** Calls `charge-deposit` edge function. The response includes `paymentDetails: { paymentIntentId, chargeId, amountCents, paymentMethod, paymentBrand }`. The actual Stripe charge amount is the source of truth — not `deposit_due_cents`.
5. Invoice created with status `paid` (fully paid), `partial` (deposit only), or `sent` (no charge).
6. Transaction receipt logged via `logGroupedTransactions()` (handles deposit + tip as grouped receipts if applicable).
7. Customer receives email and SMS confirmation.

If the card is declined, a custom email and SMS are sent with a link to the Customer Portal to update the payment method. Order stays unapproved until the admin retries.

**Force Approve** (admin override) skips the deposit charge entirely and confirms without collecting payment. Calls `enterConfirmed()` with `paymentOutcome: 'waived'`.

### Payment Outcome Values

The `paymentOutcome` parameter passed to `order-lifecycle` controls how the order's financial state is recorded:

| Value | Meaning |
|---|---|
| `waived` | Admin waived the deposit |
| `already_paid` | Payment was collected earlier |
| `charged_now` | Deposit just charged successfully |
| `zero_due_with_card` | Zero deposit, card saved for future use |
| `full_paid` | Full amount collected |
| `custom_paid` | Custom amount collected |
| `cash` | Cash payment outside Stripe |

---

## Customer Approval Modal (`ApprovalModal.tsx`)

The `ApprovalModal` component shown during the customer order-change approval flow displays contextual payment messaging based on payment state:

| State | Message Shown | Button Text |
|---|---|---|
| Deposit already paid | "No payment required — your deposit of $X is on file. Any price changes will be added to your balance." | **Confirm Changes** |
| Zero deposit due, card on file | "No deposit required today — your card will be kept on file for the final payment." | **Confirm Booking** |
| Zero deposit due, no card on file | Warning: "No card is on file. Please add a payment method before confirming." + Add Card button | **Confirm Booking** (disabled until card added) |
| Deposit due | Shows charge amount with balance-due breakdown | **Confirm & Pay** |

The "already paid" path (when `deposit_paid_cents > 0` or `stripe_payment_status === 'paid'`) skips the Stripe charge entirely and confirms the order without collecting additional payment.

---

## Payment Success Screen ("Request Received")

The payment success screen (`PaymentSuccessState.tsx`) shown after checkout completion displays the event date using a timezone-safe parse: `new Date(event_date + 'T12:00:00')`. This prevents the date from rendering one day early due to UTC midnight interpretation when the raw `YYYY-MM-DD` string is passed directly to `new Date()`.

---

## Cash and Check Payments

Both are processed through their respective edge functions, which require `admin`, `crew`, or `master` role.

The workflow is atomic:

1. A database RPC (`record_cash_payment` or `record_check_payment`) executes as a single transaction: creates the payment record, updates `deposit_paid_cents` / `balance_paid_cents` on the order, and logs the change to `order_changelog`.
2. Only after the RPC succeeds does the function log the transaction receipt and send the customer a receipt email (both are best-effort, non-atomic).

Check payments require a non-empty check number, which is stored in `payments.notes` and included in the customer receipt email.

---

## Transaction Receipt Logging (`src/lib/transactionReceiptService.ts`)

Every payment event is written to `transaction_receipts` with a unique, sequential receipt number (generated by a database sequence).

### `transaction_receipts` Table Schema (confirmed from live DB)

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `transaction_type` | text | `deposit`, `balance`, `tip`, `full_payment`, `refund` |
| `order_id` | uuid | Which order |
| `customer_id` | uuid | Which customer |
| `payment_id` | uuid | FK to `payments` row |
| `amount_cents` | integer | Transaction amount in cents |
| `payment_method` | text | `card`, `cash`, `check` |
| `payment_method_brand` | text | Card brand (Visa, Mastercard, etc.) |
| `stripe_charge_id` | text | Stripe charge ID (for Stripe transactions) |
| `stripe_payment_intent_id` | text | Stripe PaymentIntent ID |
| `receipt_number` | text | Unique human-readable receipt number (auto-generated by `generate_receipt_number()` DB function) |
| `receipt_group_id` | uuid | Groups related transactions (e.g., deposit + tip from same charge) |
| `receipt_sent_to_admin` | boolean | Whether admin receipt email was sent |
| `admin_notified_at` | timestamptz | When admin was notified |
| `transaction_date` | timestamptz | When the transaction occurred |
| `notes` | text | Optional notes (e.g., check number) |
| `created_at` | timestamptz | Record creation timestamp |

**Immutability:** The `transaction_receipts` table has no UPDATE or DELETE RLS policies — records cannot be modified after creation. This makes it an immutable financial audit log.

### Deduplication

The primary deduplication key is `(payment_intent_id, transaction_type)`. This prevents a deposit and a tip from the same Stripe charge from collapsing into a single receipt. A fallback key of `(charge_id, transaction_type)` handles cases where only the charge ID is available.

### Grouped Receipts

When a single Stripe charge covers multiple transaction types (e.g., deposit + tip), `logGroupedTransactions()` assigns a shared `receipt_group_id` (UUID) so they can be displayed together in a single admin receipt email.

### Admin Notifications

After logging, `logAndNotifyTransaction()` sends a formatted HTML receipt email to the admin. This is fire-and-forget — a send failure does not block the payment flow. The email includes receipt number, transaction type, amount, order ID, customer name, payment method brand and last four, event date, and a link to the admin panel.

---

## Stripe Refunds

The `stripe-refund` edge function (admin/master only) calls Stripe's refund API, then creates a record in the `order_refunds` table.

### `order_refunds` Table Schema (confirmed from live DB)

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `order_id` | uuid | Which order |
| `amount_cents` | integer | Refund amount in cents |
| `reason` | text | Reason for the refund |
| `stripe_refund_id` | text | Stripe refund ID for cross-referencing |
| `refunded_by` | uuid | Admin user who initiated the refund |
| `status` | text | `pending` or `succeeded` |
| `created_at` | timestamptz | When the refund was initiated |

Additionally, when Stripe confirms the refund via the `charge.refunded` webhook, the `handleChargeRefunded` function creates a negative-amount `incidental` record in the `payments` table (type: `incidental`, negative `amount_cents`) and updates `total_refunded_cents` on the order.

---

## Payment Amount Tracking (Orders Table)

The `orders` table tracks payment progress with these columns (all in cents):

| Column | Meaning |
|---|---|
| `deposit_due_cents` | Deposit required at confirmation |
| `deposit_paid_cents` | Amount collected toward deposit (excludes tip) |
| `balance_due_cents` | Remaining balance |
| `balance_paid_cents` | Amount collected toward balance |
| `tip_cents` | Tip collected (tracked separately, excluded from balance calculations) |
| `total_cents` | Full order total (subtotal + all fees + tax) |
| `total_refunded_cents` | Total amount refunded |
| `damage_charged_cents` | Amount charged for equipment damage |

Payment status is derived (not stored) using `getPaymentStatus(order)` from `src/lib/constants/statuses.ts`.

### Balance Due Calculation

`balance_due_cents` is computed excluding the tip: `total_cents - deposit_paid_cents - balance_paid_cents`. The tip is tracked separately in `tip_cents` and excluded from balance calculations to prevent double-counting.

---

## Customer-Selected Payment Amount

At checkout, customers can choose how much to pay:

- `customer_selected_payment_cents` — what the customer indicated they would pay (confirmed from live DB column name)
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
- Refunds are traceable back to their original charge via `stripe_refund_id` on `order_refunds`
- `order_financials_applied` on `payments` prevents double-counting when the webhook is retried
