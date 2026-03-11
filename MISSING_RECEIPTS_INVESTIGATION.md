# Investigation: Orders with Payments but NO Transaction Receipts

## Executive Summary

Found **6 orders** in last 90 days with successful deposit payments but ZERO transaction_receipts rows.

**Root Cause:** Transaction receipts system was implemented on 2026-03-11 10:52:10 AM. Any payments before that date were never logged to the receipts table.

**Solution:** Backfill script to create deposit + tip receipts for all missing cases.

---

## Step 1: Identified Orders

### Query Used:
```sql
SELECT
  o.id as order_id,
  p.id as payment_id,
  p.stripe_payment_intent_id,
  p.amount_cents,
  o.tip_cents,
  o.deposit_due_cents,
  o.customer_id,
  p.created_at
FROM orders o
JOIN payments p ON p.order_id = o.id
WHERE
  p.type = 'deposit'
  AND p.status = 'succeeded'
  AND o.created_at > NOW() - INTERVAL '90 days'
  AND NOT EXISTS (
    SELECT 1 FROM transaction_receipts tr
    WHERE tr.stripe_payment_intent_id = p.stripe_payment_intent_id
  )
ORDER BY p.created_at DESC;
```

### Results: 6 Orders Missing ALL Receipts

| Order ID (abbreviated) | Payment Amount | Tip | Deposit | Payment Date | Customer ID |
|------------------------|----------------|-----|---------|--------------|-------------|
| dd31e1d8... | $449.00 | $49.00 | $400.00 | 2026-03-11 10:49 | 85cdef61... |
| d025f7f1... | $260.00 | $10.00 | $250.00 | 2026-03-10 22:57 | 85cdef61... |
| f5fc3aef... | $110.00 | $10.00 | $100.00 | 2026-03-10 18:09 | 85cdef61... |
| 33af0c3f... | $130.00 | $30.00 | $100.00 | 2026-03-10 16:56 | 85cdef61... |
| d7cd17e8... | $100.00 | $0.00  | $100.00 | 2025-12-13 23:15 | 85cdef61... |
| e98c7074... | $100.00 | $0.00  | $100.00 | 2025-12-13 22:47 | 85cdef61... |

**All payments:** Same customer, all succeeded, all have payment_method='card', payment_brand='visa'

---

## Step 2: Root Cause Analysis

### Timeline:
- **2025-12-13 22:47:** Oldest payment missing receipts
- **2026-03-11 10:52:** Transaction receipts table created (migration `20260311105210_create_transaction_receipts.sql`)
- **2026-03-11 10:49:** Last payment BEFORE receipt logging was implemented
- **2026-03-11 12:00+:** First payments WITH receipt logging

### Why are receipts missing?

**Answer:** Receipt logging was NOT implemented at the time of these payments.

Evidence:
1. Transaction_receipts table created: 2026-03-11 10:52:10
2. All missing-receipt payments occurred BEFORE this timestamp
3. No constraint violations found (constraints would have logged errors)
4. No error logs found in notification_failures table for these payments

**Conclusion:** This is a historical data gap, not a system failure.

---

## Step 3: Backfill Strategy

### Requirements:
1. Insert DEPOSIT receipt: `amount = payment.amount_cents - tip_cents`
2. Insert TIP receipt (if tip > 0): `amount = orders.tip_cents`
3. Both receipts must have:
   - Same `stripe_payment_intent_id` (from payments table)
   - Same `receipt_group_id` (new UUID per order)
   - Same `order_id`, `customer_id`, `payment_id`
   - `stripe_charge_id = NULL` (not available for old payments)
   - `payment_method` and `payment_brand` from payments table

### Constraints to Respect:
- ✅ `unique_receipt_pi_type (stripe_payment_intent_id, transaction_type)` - Different types allowed
- ✅ `unique_receipt_charge_type (stripe_charge_id, transaction_type)` - NULL values allowed (NULLS NOT DISTINCT)

### Math Verification:

| Order | Payment Amount | Tip | Calculated Deposit | Deposit Matches | Total Receipts |
|-------|---------------|-----|-------------------|-----------------|----------------|
| dd31e1d8... | 44900 | 4900 | 40000 | ✅ TRUE | 44900 |
| d025f7f1... | 26000 | 1000 | 25000 | ✅ TRUE | 26000 |
| f5fc3aef... | 11000 | 1000 | 10000 | ✅ TRUE | 11000 |
| 33af0c3f... | 13000 | 3000 | 10000 | ✅ TRUE | 13000 |
| d7cd17e8... | 10000 | 0 | 10000 | ✅ TRUE | 10000 |
| e98c7074... | 10000 | 0 | 10000 | ✅ TRUE | 10000 |

✅ **All calculations match:** `payment.amount_cents = deposit_receipt + tip_receipt`

---

## Step 4: Reconciliation Proof

### Before Backfill:
```sql
-- 6 payments with NO receipts
payments.amount_cents: $1,149.00
SUM(receipts): $0.00
Discrepancy: $1,149.00
```

### After Backfill (Expected):
```sql
-- 6 payments with FULL receipts
payments.amount_cents: $1,149.00
SUM(receipts): $1,149.00
Discrepancy: $0.00

Breakdown:
- Deposit receipts: 6 (total: $1,050.00)
- Tip receipts: 4 (total: $99.00)
- Total receipts: 10 (total: $1,149.00)
```

### Reconciliation Query:
```sql
SELECT
  p.stripe_payment_intent_id,
  p.amount_cents as payment_amount,
  COALESCE(SUM(tr.amount_cents), 0) as receipts_total,
  p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) as payment_matches_receipts
FROM orders o
JOIN payments p ON p.order_id = o.id
LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE 
  p.type = 'deposit'
  AND p.status = 'succeeded'
  AND o.created_at > NOW() - INTERVAL '90 days'
GROUP BY p.id, p.stripe_payment_intent_id, p.amount_cents
ORDER BY p.created_at DESC;
```

**Expected result:** `payment_matches_receipts = TRUE` for all 6 orders

---

## Files Created

1. **`BACKFILL_MISSING_RECEIPTS_ALL.sql`** - Complete backfill script with:
   - Step 1: Preview query
   - Step 2: Backfill inserts (deposit + tip)
   - Step 3: Verification query
   - Step 4: Detailed reconciliation

2. **`MISSING_RECEIPTS_INVESTIGATION.md`** - This document

---

## Safety Features

✅ **Idempotent:** Uses `NOT EXISTS` checks - safe to run multiple times
✅ **Constraint-safe:** NULL stripe_charge_id allowed, different transaction_types allowed per payment_intent
✅ **Math-verified:** All deposit + tip amounts equal payment amounts
✅ **No code changes:** SQL backfill only, no workflow modifications
✅ **Grouped receipts:** Uses receipt_group_id to link deposit + tip receipts

---

## Next Steps

1. Review `BACKFILL_MISSING_RECEIPTS_ALL.sql` preview query (Step 1)
2. Run backfill inserts (Step 2) - inserts 10 receipt rows total
3. Verify reconciliation (Steps 3 & 4) - expect $0.00 discrepancy
4. Confirm idempotency by re-running (should insert 0 rows)

**No code changes required. This is historical data cleanup only.**
