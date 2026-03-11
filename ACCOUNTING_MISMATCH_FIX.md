# Accounting Mismatch Fix - Customer Selected Payment Amount

## Problem Statement

**Red Flag 1:** Receipt amounts didn't match actual Stripe charge
- Frontend used `orderData.deposit_due_cents` for receipt/invoice calculations
- Edge function `charge-deposit` used `customer_selected_payment_cents ?? deposit_due_cents`
- When customer selected custom deposit amount, receipts showed wrong amount

**Red Flag 2:** Invoice paid_amount_cents didn't match actual charge
- Same root cause - used hardcoded `deposit_due_cents` instead of actual charged amount

## Solution

Use the SAME deposit calculation logic in frontend that matches the edge function charge.

---

## Code Changes

### File: `src/lib/orderApprovalService.ts`

**BEFORE (lines 96-167):**
```typescript
// Log deposit transaction and notify admin with grouped receipts
if (customerData) {
  const depositAmount = orderData.deposit_due_cents;  // ❌ Wrong - ignores customer_selected_payment_cents
  const tipAmount = orderData.tip_cents ?? 0;

  // Build array of transactions to log (grouped)
  const transactions = [
    {
      transactionType: 'deposit' as const,
      orderId,
      customerId: orderData.customer_id,
      paymentId: paymentRecord?.id,
      amountCents: depositAmount,  // ❌ Wrong amount
      // ... rest
    }
  ];

  // Add tip transaction if present
  if (tipAmount > 0) {
    transactions.push({
      transactionType: 'tip' as const,
      // ...
      amountCents: tipAmount,
      // ...
    });
  }

  await logGroupedTransactions(transactions, orderData, customerData);
}

const { data: invoiceNumberData } = await supabase.rpc('generate_invoice_number');
const invoiceNumber = invoiceNumberData || `INV-${Date.now()}`;

const totalCents =
  orderData.subtotal_cents +
  orderData.travel_fee_cents +
  (orderData.surface_fee_cents ?? 0) +
  (orderData.same_day_pickup_fee_cents ?? 0) +
  (orderData.tax_cents ?? 0) +
  (orderData.tip_cents ?? 0);

// Calculate paid amount (deposit + tip charged at approval)
const paidAmount = orderData.deposit_due_cents + (orderData.tip_cents ?? 0);  // ❌ Wrong

// Determine invoice status based on payment amount vs total
const invoiceStatus = paidAmount >= totalCents ? 'paid' : (paidAmount > 0 ? 'partial' : 'sent');

await supabase.from('invoices').insert({
  invoice_number: invoiceNumber,
  order_id: orderId,
  customer_id: orderData.customer_id,
  due_date: orderData.event_date,
  status: invoiceStatus,
  subtotal_cents: orderData.subtotal_cents,
  tax_cents: orderData.tax_cents ?? 0,
  travel_fee_cents: orderData.travel_fee_cents ?? 0,
  surface_fee_cents: orderData.surface_fee_cents ?? 0,
  same_day_pickup_fee_cents: orderData.same_day_pickup_fee_cents ?? 0,
  total_cents: totalCents,
  paid_amount_cents: paidAmount,  // ❌ Wrong amount
});
```

**AFTER (lines 96-169):**
```typescript
// Calculate amounts to match what was actually charged in charge-deposit
// charge-deposit uses: customer_selected_payment_cents || deposit_due_cents
const depositAmountCents = orderData.customer_selected_payment_cents ?? orderData.deposit_due_cents;
const tipAmountCents = orderData.tip_cents ?? 0;
const paidAmountCents = depositAmountCents + tipAmountCents;

// Log deposit transaction and notify admin with grouped receipts
if (customerData) {
  // Build array of transactions to log (grouped)
  const transactions = [
    {
      transactionType: 'deposit' as const,
      orderId,
      customerId: orderData.customer_id,
      paymentId: paymentRecord?.id,
      amountCents: depositAmountCents,  // ✅ Correct - matches actual charge
      paymentMethod: data.paymentDetails?.paymentMethod,
      paymentMethodBrand: data.paymentDetails?.paymentBrand,
      stripeChargeId: data.paymentDetails?.chargeId,
      stripePaymentIntentId: data.paymentDetails?.paymentIntentId,
      notes: `Deposit payment for Order ${formatOrderId(orderId)}`,
    }
  ];

  // Add tip transaction if present
  if (tipAmountCents > 0) {
    transactions.push({
      transactionType: 'tip' as const,
      orderId,
      customerId: orderData.customer_id,
      paymentId: paymentRecord?.id,
      amountCents: tipAmountCents,  // ✅ Correct
      paymentMethod: data.paymentDetails?.paymentMethod,
      paymentMethodBrand: data.paymentDetails?.paymentBrand,
      stripeChargeId: data.paymentDetails?.chargeId,
      stripePaymentIntentId: data.paymentDetails?.paymentIntentId,
      notes: `Crew tip for Order ${formatOrderId(orderId)}`,
    });
  }

  // Log all transactions as a grouped receipt
  await logGroupedTransactions(transactions, orderData, customerData);
}

const { data: invoiceNumberData } = await supabase.rpc('generate_invoice_number');
const invoiceNumber = invoiceNumberData || `INV-${Date.now()}`;

const totalCents =
  orderData.subtotal_cents +
  orderData.travel_fee_cents +
  (orderData.surface_fee_cents ?? 0) +
  (orderData.same_day_pickup_fee_cents ?? 0) +
  (orderData.tax_cents ?? 0) +
  (orderData.tip_cents ?? 0);

// Determine invoice status based on payment amount vs total
const invoiceStatus = paidAmountCents >= totalCents ? 'paid' : (paidAmountCents > 0 ? 'partial' : 'sent');

await supabase.from('invoices').insert({
  invoice_number: invoiceNumber,
  order_id: orderId,
  customer_id: orderData.customer_id,
  due_date: orderData.event_date,
  status: invoiceStatus,
  subtotal_cents: orderData.subtotal_cents,
  tax_cents: orderData.tax_cents ?? 0,
  travel_fee_cents: orderData.travel_fee_cents ?? 0,
  surface_fee_cents: orderData.surface_fee_cents ?? 0,
  same_day_pickup_fee_cents: orderData.same_day_pickup_fee_cents ?? 0,
  total_cents: totalCents,
  paid_amount_cents: paidAmountCents,  // ✅ Correct - matches actual charge
});
```

---

## Changes Summary

### Variables Introduced (lines 96-100)
```typescript
const depositAmountCents = orderData.customer_selected_payment_cents ?? orderData.deposit_due_cents;
const tipAmountCents = orderData.tip_cents ?? 0;
const paidAmountCents = depositAmountCents + tipAmountCents;
```

### Variables Replaced
1. **Deposit receipt `amountCents`:** Changed from `depositAmount` → `depositAmountCents`
2. **Tip receipt `amountCents`:** Changed from `tipAmount` → `tipAmountCents`
3. **Invoice `paid_amount_cents`:** Changed from `paidAmount` → `paidAmountCents`
4. **Invoice `status` calculation:** Uses `paidAmountCents` instead of `paidAmount`

### Variables Removed
- ❌ `const depositAmount = orderData.deposit_due_cents;`
- ❌ `const tipAmount = orderData.tip_cents ?? 0;`
- ❌ `const paidAmount = orderData.deposit_due_cents + (orderData.tip_cents ?? 0);`

---

## Files Changed

✅ **ONLY** `src/lib/orderApprovalService.ts` (lines 96-169)

❌ **NO** edge functions changed
❌ **NO** Stripe checkout mode changed
❌ **NO** charge-deposit logic changed
❌ **NO** transactionReceiptService logic changed
❌ **NO** order status transitions changed

---

## Build Status

✅ **Build succeeded** - All 2080 modules transformed successfully (10.26s)

---

## SQL Verification

```sql
-- ============================================================================
-- Verify Payment Amount Matches Invoice Paid Amount
-- ============================================================================
-- This query ensures that the Stripe charge amount (deposit + tip) matches
-- what was recorded in the invoice as paid_amount_cents

SELECT
  o.id as order_id,
  p.amount_cents as payment_amount,           -- What was charged (deposit + tip)
  i.paid_amount_cents as invoice_paid_amount, -- What invoice says was paid
  p.amount_cents = i.paid_amount_cents as amounts_match,
  p.stripe_payment_intent_id,
  p.created_at
FROM orders o
JOIN payments p ON p.order_id = o.id AND p.type = 'deposit'
JOIN invoices i ON i.order_id = o.id
WHERE p.created_at > NOW() - INTERVAL '1 day'
ORDER BY p.created_at DESC
LIMIT 20;

-- Expected: amounts_match should be TRUE for all rows
-- If FALSE, payment amount doesn't match invoice (accounting mismatch)


-- ============================================================================
-- Verify Receipt Amounts Match Payment Amount
-- ============================================================================
-- This query ensures deposit receipt + tip receipt = total payment amount

SELECT
  p.order_id,
  p.amount_cents as total_payment,
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'deposit'), 0) as deposit_receipt_amount,
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'tip'), 0) as tip_receipt_amount,
  (
    COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'deposit'), 0) +
    COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'tip'), 0)
  ) as total_receipts,
  p.amount_cents = (
    COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'deposit'), 0) +
    COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'tip'), 0)
  ) as receipts_match_payment,
  p.stripe_payment_intent_id
FROM payments p
LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE p.type = 'deposit'
AND p.created_at > NOW() - INTERVAL '1 day'
GROUP BY p.order_id, p.amount_cents, p.stripe_payment_intent_id, p.created_at
ORDER BY p.created_at DESC
LIMIT 20;

-- Expected: receipts_match_payment should be TRUE for all rows
-- total_payment should equal (deposit_receipt_amount + tip_receipt_amount)


-- ============================================================================
-- Verify Customer Selected Payment Amount Logic
-- ============================================================================
-- This query shows which orders used customer_selected_payment_cents
-- vs default deposit_due_cents

SELECT
  o.id as order_id,
  o.deposit_due_cents as default_deposit,
  o.customer_selected_payment_cents as customer_selected,
  COALESCE(o.customer_selected_payment_cents, o.deposit_due_cents) as actual_deposit_charged,
  o.tip_cents,
  (COALESCE(o.customer_selected_payment_cents, o.deposit_due_cents) + COALESCE(o.tip_cents, 0)) as total_charged,
  p.amount_cents as payment_amount,
  o.customer_selected_payment_cents IS NOT NULL as customer_customized_deposit
FROM orders o
JOIN payments p ON p.order_id = o.id AND p.type = 'deposit'
WHERE o.status = 'confirmed'
AND o.created_at > NOW() - INTERVAL '7 days'
ORDER BY o.created_at DESC
LIMIT 20;

-- Expected:
-- - actual_deposit_charged should equal customer_selected if not null, else deposit_due_cents
-- - total_charged should equal payment_amount
-- - customer_customized_deposit = TRUE when customer chose custom amount


-- ============================================================================
-- Full Accounting Reconciliation (All Three Tables)
-- ============================================================================
-- Master validation query checking orders, payments, invoices, and receipts all align

SELECT
  o.id as order_id,
  o.deposit_due_cents,
  o.customer_selected_payment_cents,
  o.tip_cents,

  -- What should have been charged
  (COALESCE(o.customer_selected_payment_cents, o.deposit_due_cents) + COALESCE(o.tip_cents, 0)) as expected_charge,

  -- What was actually charged (from payment)
  p.amount_cents as actual_payment,

  -- What invoice says was paid
  i.paid_amount_cents as invoice_paid,

  -- What receipts sum to
  COALESCE(SUM(tr.amount_cents), 0) as receipt_total,

  -- Validation flags
  (COALESCE(o.customer_selected_payment_cents, o.deposit_due_cents) + COALESCE(o.tip_cents, 0)) = p.amount_cents as payment_matches_expected,
  p.amount_cents = i.paid_amount_cents as payment_matches_invoice,
  p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) as payment_matches_receipts,

  -- All aligned?
  (
    (COALESCE(o.customer_selected_payment_cents, o.deposit_due_cents) + COALESCE(o.tip_cents, 0)) = p.amount_cents AND
    p.amount_cents = i.paid_amount_cents AND
    p.amount_cents = COALESCE(SUM(tr.amount_cents), 0)
  ) as fully_aligned,

  p.created_at
FROM orders o
JOIN payments p ON p.order_id = o.id AND p.type = 'deposit'
JOIN invoices i ON i.order_id = o.id
LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE o.status = 'confirmed'
AND o.created_at > NOW() - INTERVAL '7 days'
GROUP BY o.id, o.deposit_due_cents, o.customer_selected_payment_cents, o.tip_cents,
         p.amount_cents, i.paid_amount_cents, p.created_at
ORDER BY p.created_at DESC
LIMIT 20;

-- Expected: fully_aligned should be TRUE for all rows after this fix
-- If FALSE, accounting is mismatched somewhere
```

---

## Impact

### Before Fix
**Scenario:** Customer approves order with custom deposit ($300 instead of default $400), tip $50
- ❌ Stripe charged: $350 (correct)
- ❌ Deposit receipt: $400 (WRONG - showed default instead of actual)
- ❌ Tip receipt: $50 (correct)
- ❌ Invoice paid_amount: $450 (WRONG - $400 + $50)
- ❌ Payment record: $350 (correct)
- ❌ **MISMATCH:** Payment ($350) ≠ Invoice ($450) ≠ Receipt total ($450)

### After Fix
**Scenario:** Customer approves order with custom deposit ($300 instead of default $400), tip $50
- ✅ Stripe charged: $350 (correct)
- ✅ Deposit receipt: $300 (CORRECT - uses customer_selected_payment_cents)
- ✅ Tip receipt: $50 (correct)
- ✅ Invoice paid_amount: $350 (CORRECT - $300 + $50)
- ✅ Payment record: $350 (correct)
- ✅ **ALIGNED:** Payment ($350) = Invoice ($350) = Receipt total ($350)

---

## Testing Checklist

**Test Case 1: Default Deposit (No Custom Amount)**
- [ ] Create order with default deposit, approve
- [ ] Verify: payment.amount_cents = invoice.paid_amount_cents
- [ ] Verify: receipt deposit + tip = payment amount

**Test Case 2: Customer Selected Custom Deposit**
- [ ] Create order, customer selects custom deposit amount in approval modal
- [ ] Admin approves
- [ ] Verify: payment.amount_cents uses customer_selected_payment_cents (not deposit_due_cents)
- [ ] Verify: receipt deposit shows customer_selected amount
- [ ] Verify: invoice.paid_amount_cents matches payment.amount_cents

**Test Case 3: With Tip**
- [ ] Create order with tip > 0
- [ ] Approve with custom deposit
- [ ] Verify: TWO receipts created (deposit + tip)
- [ ] Verify: deposit receipt = customer_selected_payment_cents
- [ ] Verify: tip receipt = tip_cents
- [ ] Verify: payment.amount_cents = deposit + tip
- [ ] Verify: invoice.paid_amount_cents = deposit + tip

---

## Rollback (If Needed)

```bash
# Revert orderApprovalService.ts
git checkout HEAD~1 src/lib/orderApprovalService.ts

# Rebuild
npm run build
```

---

## Summary

✅ Fixed accounting mismatch between Stripe charge, receipts, and invoices
✅ Now uses `customer_selected_payment_cents ?? deposit_due_cents` (matches charge-deposit)
✅ Deposit receipt shows ACTUAL charged amount (not default)
✅ Invoice paid_amount matches ACTUAL payment amount
✅ Build succeeded with no errors
✅ No workflow changes (Stripe mode, edge functions, status flow all unchanged)
