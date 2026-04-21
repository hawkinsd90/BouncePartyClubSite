# Payments and Receipts

## Overview

The payment system supports five payment methods: Stripe card (online), cash, check, Apple Pay, and Google Pay. All monetary values are stored in cents. The `payments` table is the source of truth for what has been collected. The `transaction_receipts` table (managed via `transactionReceiptService.ts`) provides an immutable audit log of every financial event.

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

## Stripe Integration

### Checkout Flow

The `stripe-checkout` edge function creates a Stripe Checkout Session or Payment Intent. It:

1. Reads the Stripe secret key from `admin_settings` (never from env vars).
2. Applies rate limiting per order (prevents duplicate checkout creation).
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

Admins (and crew with admin/master role) can charge the saved card on file directly from the Calendar Task Detail Modal without going through the order approval flow.

**When available:** The "Charge Card on File" button appears in the Order Management section of the Task Detail Modal when:
- `balance_due_cents > 0` (balance is outstanding)
- `stripe_payment_method_id` is set on the order (a card is saved)

**How it works:**
1. Admin clicks "Charge Card on File" — shows a confirmation modal with card brand, last four digits, and the exact amount
2. On confirmation, calls the `charge-deposit` edge function with:
   - `orderId`
   - `paymentAmountCents` = current `balance_due_cents`
   - `tipCents` = 0
   - `selectedPaymentType` = `'balance'`
3. The edge function charges the card off-session, records the payment, and sends the customer a receipt email
4. `balance_due_cents` is updated on the order
5. Admin sees a success alert; the task refreshes to reflect the new payment state

This provides a shortcut for common day-of balance collection without navigating to the full Order Detail Modal.

---

## Order Approval and Deposit Charging (`src/lib/orderApprovalService.ts`)

When an admin approves an order:

1. Availability is re-checked to prevent overbooking.
2. If deposit is zero: order moves to `confirmed`, card flagged for balance collection.
3. If deposit is positive: the `charge-deposit` edge function charges the saved payment method.
4. Invoice is created with status `paid` (fully paid), `partial` (deposit only), or `sent`.
5. Transaction receipt is logged.
6. Customer receives email and SMS confirmation.

If the card is declined, a custom email and SMS are sent with a link to the customer portal to update payment.

Force-approve (admin override) skips the deposit charge entirely and confirms without collecting payment.

---

## Cash and Check Payments

Both are processed through their respective edge functions, which require `admin`, `crew`, or `master` role.

The workflow is atomic:

1. A database RPC (`record_cash_payment` or `record_check_payment`) executes as a single transaction: creates the payment record, updates `deposit_paid_cents` / `balance_paid_cents` on the order, and logs the change to `order_changelog`.
2. Only after the RPC succeeds does the function log the transaction receipt and send the customer a receipt email (both are best-effort, non-atomic).

Check payments require a non-empty check number, which is included in the `payments.notes` field and in the customer receipt email.

---

## Transaction Receipt Logging (`src/lib/transactionReceiptService.ts`)

Every payment event is written to a `transaction_receipts` table with a unique receipt number.

**Deduplication:** The primary key for deduplication is `(payment_intent_id, transaction_type)`. This prevents a deposit and a tip from the same Stripe charge from collapsing into a single receipt. A fallback key of `(charge_id, transaction_type)` handles cases where only the charge ID is available.

**Grouped Receipts:** When a single Stripe charge covers multiple transaction types (e.g., deposit + tip), `logGroupedTransactions()` assigns a shared `receipt_group_id` so they can be displayed together.

**Admin Notifications:** After logging, `logAndNotifyTransaction()` sends a formatted HTML receipt email to the admin. This is fire-and-forget — a failure does not block the payment flow.

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

---

## Customer-Selected Payment Amount

At checkout, customers can optionally pay a custom amount rather than the full deposit. The `orders` table tracks:

- `customer_payment_amount_cents` — what the customer said they would pay
- `customer_selected_payment_type` — "deposit", "balance", or "custom"

This is used to pre-fill the payment amount selector in the checkout UI and is reconciled against actual Stripe charges when the webhook fires.

---

## Notification Reliability (`src/lib/notificationReliability.ts`)

The system tracks email and SMS notification failures in a `notification_failures` table. If three or more consecutive failures occur for the same notification type, the admin is alerted. Failures can be marked as resolved from the admin dashboard's Notification Failures panel.

---

## Reconciliation

The SQL queries in `supabase/migrations/` (specifically the receipt deduplication and constraint migrations) ensure that:

- Every order with a Stripe payment has a corresponding transaction receipt
- Deposit and tip can coexist as separate receipts for the same charge
- Refunds are traceable back to their original charge via `original_charge_id`

For manual reconciliation or audit queries, the `order_refunds`, `payments`, and `transaction_receipts` tables can be joined on `order_id` and `stripe_payment_intent_id`.
