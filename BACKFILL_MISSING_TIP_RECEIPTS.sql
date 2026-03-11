/*
  ============================================================================
  BACKFILL MISSING TIP RECEIPTS
  ============================================================================

  This script inserts missing TIP receipts for orders where:
  - Order has tip_cents > 0
  - A DEPOSIT receipt exists for the order/payment_intent
  - NO TIP receipt exists yet
  - Reuses same stripe_charge_id and stripe_payment_intent_id from deposit receipt
  - Sets receipt_group_id to match deposit receipt (for grouped display)

  Purpose: Fix accounting reconciliation so that:
  payments.amount_cents = SUM(transaction_receipts.amount_cents)

  ============================================================================
  HOW TO USE
  ============================================================================

  1. Review the preview query first to see what would be inserted
  2. Run the backfill INSERT statement
  3. Run the verification query to confirm reconciliation

  ============================================================================
*/

-- ============================================================================
-- STEP 1: PREVIEW - See what tip receipts are missing
-- ============================================================================

SELECT
  o.id as order_id,
  o.tip_cents,
  dr.receipt_number as deposit_receipt,
  dr.stripe_charge_id,
  dr.stripe_payment_intent_id,
  dr.receipt_group_id,
  dr.payment_id,
  o.customer_id,

  -- Check if tip receipt already exists
  (
    SELECT receipt_number
    FROM transaction_receipts
    WHERE order_id = o.id
    AND transaction_type = 'tip'
    LIMIT 1
  ) as existing_tip_receipt,

  -- What we would insert
  o.tip_cents as tip_amount_to_insert

FROM orders o

-- Find the deposit receipt for this order
INNER JOIN transaction_receipts dr
  ON dr.order_id = o.id
  AND dr.transaction_type = 'deposit'

WHERE
  -- Order has a tip
  o.tip_cents > 0

  -- No tip receipt exists yet
  AND NOT EXISTS (
    SELECT 1
    FROM transaction_receipts tr
    WHERE tr.order_id = o.id
    AND tr.transaction_type = 'tip'
  )

  -- Only recent orders (adjust date range as needed)
  AND o.created_at > NOW() - INTERVAL '30 days'

ORDER BY o.created_at DESC;

-- ============================================================================
-- STEP 2: BACKFILL - Insert missing tip receipts
-- ============================================================================

-- Generate receipt numbers for tips (format: TIP-YYYYMMDD-NNNN)
-- Then insert the tip receipts with matching charge_id, payment_intent_id, and receipt_group_id

WITH missing_tips AS (
  SELECT
    o.id as order_id,
    o.customer_id,
    o.tip_cents,
    dr.payment_id,
    dr.payment_method,
    dr.payment_method_brand,
    dr.stripe_charge_id,
    dr.stripe_payment_intent_id,
    dr.receipt_group_id,
    dr.created_at as deposit_created_at
  FROM orders o

  -- Find the deposit receipt
  INNER JOIN transaction_receipts dr
    ON dr.order_id = o.id
    AND dr.transaction_type = 'deposit'

  WHERE
    -- Order has a tip
    o.tip_cents > 0

    -- No tip receipt exists yet
    AND NOT EXISTS (
      SELECT 1
      FROM transaction_receipts tr
      WHERE tr.order_id = o.id
      AND tr.transaction_type = 'tip'
    )

    -- Only recent orders (adjust date range as needed)
    AND o.created_at > NOW() - INTERVAL '30 days'
)

INSERT INTO transaction_receipts (
  transaction_type,
  order_id,
  customer_id,
  payment_id,
  amount_cents,
  payment_method,
  payment_method_brand,
  stripe_charge_id,
  stripe_payment_intent_id,
  receipt_group_id,
  notes,
  created_at
)
SELECT
  'tip' as transaction_type,
  order_id,
  customer_id,
  payment_id,
  tip_cents as amount_cents,
  payment_method,
  payment_method_brand,
  stripe_charge_id,
  stripe_payment_intent_id,
  receipt_group_id,
  'Crew tip for Order #' || LPAD(order_id::text, 6, '0') || ' (backfilled)' as notes,
  deposit_created_at as created_at  -- Use same timestamp as deposit for consistency
FROM missing_tips;

-- Show how many were inserted
-- (This will show 0 if run again, confirming idempotency)

-- ============================================================================
-- STEP 3: VERIFICATION - Confirm reconciliation is correct
-- ============================================================================

-- This query verifies that payments match receipts after backfill
SELECT
  o.id as order_id,
  o.deposit_due_cents,
  o.customer_selected_payment_cents,
  o.tip_cents,

  -- What Stripe charged (from payment record)
  p.amount_cents as stripe_charged_amount,

  -- What receipts sum to
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'deposit'), 0) as receipt_deposit,
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'tip'), 0) as receipt_tip,
  COALESCE(SUM(tr.amount_cents), 0) as receipts_total,

  -- Validation checks
  p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) as payment_matches_receipts,

  -- Should equal Stripe amount
  (
    COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'deposit'), 0) +
    COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'tip'), 0)
  ) as computed_total,

  -- Receipt details
  array_agg(tr.receipt_number ORDER BY tr.transaction_type) FILTER (WHERE tr.receipt_number IS NOT NULL) as receipt_numbers,
  array_agg(tr.transaction_type ORDER BY tr.transaction_type) FILTER (WHERE tr.transaction_type IS NOT NULL) as receipt_types,

  p.created_at

FROM orders o
JOIN payments p ON p.order_id = o.id AND p.type = 'deposit'
LEFT JOIN transaction_receipts tr
  ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE
  o.status IN ('confirmed', 'in_progress', 'completed')
  AND o.created_at > NOW() - INTERVAL '30 days'
  AND o.tip_cents > 0  -- Only orders with tips
GROUP BY
  o.id, o.deposit_due_cents, o.customer_selected_payment_cents, o.tip_cents,
  p.amount_cents, p.created_at
ORDER BY p.created_at DESC
LIMIT 50;

-- ✅ Expected: payment_matches_receipts = TRUE for all rows
-- ✅ Expected: receipt_deposit + receipt_tip = stripe_charged_amount
-- ✅ Expected: Each order with tip has both 'deposit' and 'tip' in receipt_types array

-- ============================================================================
-- STEP 4: FULL RECONCILIATION CHECK
-- ============================================================================

-- Summary report showing reconciliation status
SELECT
  COUNT(*) as total_orders_with_tips,

  COUNT(*) FILTER (
    WHERE p.amount_cents = COALESCE(SUM(tr.amount_cents), 0)
  ) as fully_reconciled_orders,

  COUNT(*) FILTER (
    WHERE p.amount_cents != COALESCE(SUM(tr.amount_cents), 0)
  ) as mismatched_orders,

  SUM(p.amount_cents) as total_stripe_charged,
  SUM(COALESCE(SUM(tr.amount_cents), 0)) as total_receipts_sum,

  -- Should be $0.00
  SUM(p.amount_cents) - SUM(COALESCE(SUM(tr.amount_cents), 0)) as total_discrepancy_cents

FROM orders o
JOIN payments p ON p.order_id = o.id AND p.type = 'deposit'
LEFT JOIN transaction_receipts tr
  ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE
  o.status IN ('confirmed', 'in_progress', 'completed')
  AND o.created_at > NOW() - INTERVAL '30 days'
  AND o.tip_cents > 0
GROUP BY o.id, p.amount_cents;

-- ✅ Expected: mismatched_orders = 0
-- ✅ Expected: total_discrepancy_cents = 0

-- ============================================================================
-- NOTES
-- ============================================================================

/*
  This backfill script is IDEMPOTENT:
  - Running it multiple times won't create duplicates
  - unique_receipt_charge_type constraint prevents duplicate tip receipts
  - unique_receipt_pi_type constraint also prevents duplicates

  Date Range:
  - Default is last 30 days (INTERVAL '30 days')
  - Adjust as needed for your backfill window
  - Use 'ALL time' by removing the date filter for complete backfill

  After Backfill:
  - All future deposits + tips will have both receipts automatically
  - The transactionReceiptService.ts has been updated to support this
  - Accounting reconciliation will be correct going forward
*/
