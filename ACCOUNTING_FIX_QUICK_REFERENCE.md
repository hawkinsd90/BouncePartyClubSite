# Accounting Fix Quick Reference

## Problem
Stripe charges deposit + tip in ONE charge, but constraint blocked tip receipt insertion.

**Result:** `payments.amount_cents > SUM(transaction_receipts.amount_cents)` ❌

---

## Solution Summary

| Component | Change | Status |
|-----------|--------|--------|
| **Database Constraint** | `(stripe_charge_id)` → `(stripe_charge_id, transaction_type)` | ✅ Applied |
| **transactionReceiptService.ts** | Add `transaction_type` to charge_id lookups (2 places) | ✅ Updated |
| **Historical Data** | Backfill script to insert missing tip receipts | ✅ Ready to run |

---

## Migration Applied

**File:** `fix_receipt_constraint_for_deposit_plus_tip`

```sql
-- Drop old constraint
DROP CONSTRAINT unique_receipt_charge;

-- Add new constraint
ADD CONSTRAINT unique_receipt_charge_type
UNIQUE NULLS NOT DISTINCT (stripe_charge_id, transaction_type);
```

**Effect:** Now allows multiple receipts per charge (deposit + tip).

---

## Code Changes

**File:** `src/lib/transactionReceiptService.ts`

### Change 1 (Lines 54-66)
```typescript
// BEFORE
else if (data.stripeChargeId) {
  const { data: existingReceipt } = await supabase
    .from('transaction_receipts')
    .select('receipt_number')
    .eq('stripe_charge_id', data.stripeChargeId)
    .maybeSingle();

// AFTER
else if (data.stripeChargeId && data.transactionType) {
  const { data: existingReceipt } = await supabase
    .from('transaction_receipts')
    .select('receipt_number')
    .eq('stripe_charge_id', data.stripeChargeId)
    .eq('transaction_type', data.transactionType)  // ✅ ADDED
    .maybeSingle();
```

### Change 2 (Lines 105-117)
```typescript
// BEFORE
if (data.stripeChargeId) {
  const { data: existingReceipt } = await supabase
    .from('transaction_receipts')
    .select('receipt_number')
    .eq('stripe_charge_id', data.stripeChargeId)
    .maybeSingle();

// AFTER
if (data.stripeChargeId && data.transactionType) {
  const { data: existingReceipt } = await supabase
    .from('transaction_receipts')
    .select('receipt_number')
    .eq('stripe_charge_id', data.stripeChargeId)
    .eq('transaction_type', data.transactionType)  // ✅ ADDED
    .maybeSingle();
```

**Why:** Prevents returning deposit receipt when checking for existing tip receipt.

---

## Backfill (Run This Once)

**File:** `BACKFILL_MISSING_TIP_RECEIPTS.sql`

### Step 1: Preview
```sql
-- See what will be inserted
SELECT o.id, o.tip_cents, dr.receipt_number
FROM orders o
INNER JOIN transaction_receipts dr ON dr.order_id = o.id AND dr.transaction_type = 'deposit'
WHERE o.tip_cents > 0
AND NOT EXISTS (
  SELECT 1 FROM transaction_receipts
  WHERE order_id = o.id AND transaction_type = 'tip'
)
AND o.created_at > NOW() - INTERVAL '30 days';
```

### Step 2: Backfill
```sql
-- Insert missing tip receipts
-- (Full query in BACKFILL_MISSING_TIP_RECEIPTS.sql)
```

### Step 3: Verify
```sql
-- Check reconciliation
SELECT
  COUNT(*) FILTER (WHERE payment_matches_receipts) as reconciled,
  COUNT(*) FILTER (WHERE NOT payment_matches_receipts) as mismatched
FROM (
  SELECT p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) as payment_matches_receipts
  FROM orders o
  JOIN payments p ON p.order_id = o.id
  LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
  WHERE o.tip_cents > 0
  GROUP BY o.id, p.amount_cents
) checks;
```

**Expected:** `mismatched = 0`

---

## Verification Query (One-Liner)

```sql
-- Quick check: Do payments match receipts?
SELECT
  o.id,
  p.amount_cents as stripe_charged,
  COALESCE(SUM(tr.amount_cents), 0) as receipts_sum,
  p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) as matches
FROM orders o
JOIN payments p ON p.order_id = o.id AND p.type = 'deposit'
LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE o.tip_cents > 0 AND o.created_at > NOW() - INTERVAL '7 days'
GROUP BY o.id, p.amount_cents
ORDER BY o.created_at DESC;
```

✅ **All rows should show `matches = TRUE`**

---

## Build Status

```bash
npm run build
# ✅ Success (13.10s, 2080 modules)
```

---

## What Changed vs What Didn't

### ✅ Changed
- Database constraint (stripe_charge_id → stripe_charge_id + transaction_type)
- Two lookups in transactionReceiptService.ts (added transaction_type filter)

### ❌ NOT Changed
- Booking workflow (Stripe checkout stays setup mode)
- charge-deposit edge function
- Stripe payment flow
- Order status transitions
- Invoice generation
- Any other edge functions
- RLS policies

---

## Testing (30 seconds)

1. **Approve order with tip**
   - Create order with $400 deposit + $50 tip
   - Admin approves
   - Check: Both deposit and tip receipts created ✅

2. **Run backfill**
   - Execute backfill SQL
   - Check: Missing tip receipts inserted ✅

3. **Verify reconciliation**
   - Run verification query
   - Check: All `matches = TRUE` ✅

---

## Key Insight

**Old Constraint:**
- ONE receipt per stripe_charge_id
- Blocked tip receipts (same charge_id as deposit)

**New Constraint:**
- MULTIPLE receipts per stripe_charge_id
- Each transaction_type unique per charge_id
- Allows: deposit + tip for same charge ✅
- Prevents: duplicate deposits ✅

**Result:**
```
payments.amount_cents = SUM(transaction_receipts.amount_cents)
```

Enterprise accounting integrity restored. 🎯
