# Webhook Payment & Refund Fixes

## Overview

Two critical fixes to `supabase/functions/stripe-webhook/index.ts` to ensure accurate payment tracking and correct refund accounting.

---

## Fix 1: Reliable Balance Payment Method Details

### Problem
Balance payments through Stripe Checkout often had `session.payment_method` as null, causing payment method details (type, brand, last4) to be missing from payment records and transaction receipts.

### Solution
Modified the `checkout.session.completed` handler for balance payments to retrieve the PaymentIntent with expanded `payment_method` and `latest_charge`:

```typescript
// IMPORTANT: expand payment_method and latest_charge for reliable payment details
const pi = await stripe.paymentIntents.retrieve(piId, {
  expand: ['payment_method', 'latest_charge'],
});

// Extract payment method details from expanded payment_method
const pm = pi.payment_method;
if (pm && typeof pm === 'object') {
  paymentMethodType = pm.type || null;
  if (pm.card) {
    paymentBrand = pm.card.brand || null;
    paymentLast4 = pm.card.last4 || null;
  }
}
```

### Impact
- Payment method details (Visa, Mastercard, etc.) now consistently appear in admin receipts
- Transaction receipts show correct card brand and last 4 digits
- Payments table has complete payment_method, payment_brand, payment_last4 data

---

## Fix 2: Negative Refund Amounts (Ledger Accounting)

### Problem
Refunds were stored as positive amounts in `payments.amount_cents` and `transaction_receipts.amount_cents`, causing ledger math errors and incorrect reporting (double-counting refunds).

### Solution
Modified the `charge.refunded` handler to store refunds as negative amounts:

```typescript
const refundAmountCents = charge.amount_refunded || 0;
// Store refunds as negative amounts for correct ledger math
const refundAmountSigned = -Math.abs(refundAmountCents);

// Insert refund payment with negative amount
await supabaseClient
  .from("payments")
  .insert({
    amount_cents: refundAmountSigned,
    stripe_net_amount: refundAmountSigned,
    // ... other fields
  });

// Log transaction with negative amount
await logTransaction(supabaseClient, {
  amountCents: refundAmountSigned,
  // ... other fields
});
```

**Backwards Compatibility:** The `order_refunds` table still stores positive amounts for compatibility with existing code.

### Impact
- Refunds now correctly subtract from ledger totals
- Sum queries on payments table return accurate net revenue
- Transaction receipts display refunds as negative amounts
- Reporting queries work without special refund handling

---

## Verification Queries

### Check Balance Payment Details
```sql
-- Verify payment method details are captured
SELECT
  order_id,
  type,
  amount_cents / 100.0 as amount_usd,
  payment_method,
  payment_brand,
  payment_last4,
  stripe_fee_amount / 100.0 as fee_usd,
  created_at
FROM payments
WHERE type = 'balance'
ORDER BY created_at DESC
LIMIT 5;
```

Expected: All recent balance payments should have `payment_method`, `payment_brand`, and `payment_last4` populated.

---

### Check Refund Accounting (UPDATED)
```sql
-- Verify refunds are stored as negative amounts
SELECT
  order_id,
  type,
  amount_cents / 100.0 as amount_usd,
  stripe_net_amount / 100.0 as net_usd,
  payment_method,
  payment_brand,
  refunded_payment_id,
  created_at
FROM payments
WHERE type = 'refund'
ORDER BY created_at DESC
LIMIT 5;
```

Expected: All refunds should show **negative** `amount_usd` and `net_usd`.

---

### Ledger Balance by Order
```sql
-- Calculate net balance per order (refunds automatically subtract)
SELECT
  order_id,
  SUM(amount_cents) / 100.0 as net_balance_usd,
  COUNT(*) as transaction_count,
  STRING_AGG(type, ', ' ORDER BY created_at) as payment_types
FROM payments
GROUP BY order_id
ORDER BY order_id DESC
LIMIT 10;
```

Expected: Refunded orders show reduced balances; fully refunded orders show $0 or near $0.

---

### Transaction Receipt Ledger
```sql
-- Verify transaction receipts also use negative amounts for refunds
SELECT
  order_id,
  transaction_type,
  amount_cents / 100.0 as amount_usd,
  payment_method_brand,
  stripe_charge_id,
  notes,
  created_at
FROM transaction_receipts
WHERE transaction_type = 'refund'
ORDER BY created_at DESC
LIMIT 5;
```

Expected: All refund receipts show **negative** `amount_usd`.

---

## Deployment

```bash
npm run build
# Deploy stripe-webhook function
```

Function deployed successfully on 2026-03-11.

---

## Notes

1. **Payment Method Expansion**: The PaymentIntent is now retrieved with `expand: ['payment_method', 'latest_charge']` to ensure payment details are always available, even when Checkout session doesn't provide them.

2. **Refund Sign Convention**:
   - `payments.amount_cents`: **negative** for refunds
   - `transaction_receipts.amount_cents`: **negative** for refunds
   - `order_refunds.amount_cents`: **positive** (backwards compatibility)

3. **Fee Tracking**: The existing balance_transaction expansion for fee tracking remains unchanged.

4. **Idempotency**: Transaction receipts use `stripe_charge_id` as unique constraint, preventing duplicate refund receipts.
