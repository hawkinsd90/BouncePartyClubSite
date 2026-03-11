-- ============================================================================
-- ENTERPRISE ACCOUNTING RECONCILIATION QUERIES
-- ============================================================================

-- ============================================================================
-- 1. VERIFY CONSTRAINTS
-- ============================================================================

SELECT 
  conname, 
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'transaction_receipts'::regclass
AND conname LIKE 'unique_receipt%'
ORDER BY conname;

-- Expected Result:
-- unique_receipt_charge_type | UNIQUE NULLS NOT DISTINCT (stripe_charge_id, transaction_type)
-- unique_receipt_pi_type     | UNIQUE NULLS NOT DISTINCT (stripe_payment_intent_id, transaction_type)


-- ============================================================================
-- 2. PREVIEW MISSING TIP RECEIPTS
-- ============================================================================

SELECT
  o.id as order_id,
  o.tip_cents,
  o.created_at,
  dr.receipt_number as deposit_receipt,
  dr.stripe_charge_id,
  dr.stripe_payment_intent_id,
  
  -- Check if tip receipt exists
  (
    SELECT receipt_number
    FROM transaction_receipts
    WHERE order_id = o.id
    AND transaction_type = 'tip'
    LIMIT 1
  ) as existing_tip_receipt

FROM orders o
INNER JOIN transaction_receipts dr
  ON dr.order_id = o.id
  AND dr.transaction_type = 'deposit'
WHERE
  o.tip_cents > 0
  AND NOT EXISTS (
    SELECT 1
    FROM transaction_receipts tr
    WHERE tr.order_id = o.id
    AND tr.transaction_type = 'tip'
  )
  AND o.created_at > NOW() - INTERVAL '30 days'
ORDER BY o.created_at DESC;


-- ============================================================================
-- 3. BACKFILL MISSING TIP RECEIPTS
-- ============================================================================

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
  INNER JOIN transaction_receipts dr
    ON dr.order_id = o.id
    AND dr.transaction_type = 'deposit'
  WHERE
    o.tip_cents > 0
    AND NOT EXISTS (
      SELECT 1 FROM transaction_receipts tr
      WHERE tr.order_id = o.id AND tr.transaction_type = 'tip'
    )
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
  deposit_created_at as created_at
FROM missing_tips
RETURNING receipt_number, transaction_type, amount_cents, stripe_charge_id;


-- ============================================================================
-- 4. DETAILED RECONCILIATION CHECK
-- ============================================================================

SELECT
  o.id as order_id,
  o.deposit_due_cents,
  o.tip_cents,
  
  -- What Stripe charged
  p.amount_cents as stripe_charged_amount,
  
  -- What receipts sum to
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'deposit'), 0) as receipt_deposit,
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'tip'), 0) as receipt_tip,
  COALESCE(SUM(tr.amount_cents), 0) as receipts_total,
  
  -- VALIDATION
  p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) as payment_matches_receipts,
  
  -- Receipt details
  array_agg(tr.receipt_number ORDER BY tr.transaction_type) FILTER (WHERE tr.receipt_number IS NOT NULL) as receipt_numbers,
  array_agg(tr.transaction_type ORDER BY tr.transaction_type) FILTER (WHERE tr.transaction_type IS NOT NULL) as receipt_types,
  
  p.created_at as payment_date

FROM orders o
JOIN payments p ON p.order_id = o.id AND p.type = 'deposit'
LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE
  o.status IN ('confirmed', 'in_progress', 'completed')
  AND o.created_at > NOW() - INTERVAL '30 days'
  AND o.tip_cents > 0
  AND EXISTS (
    SELECT 1 FROM transaction_receipts 
    WHERE order_id = o.id AND transaction_type = 'deposit'
  )
GROUP BY o.id, o.deposit_due_cents, o.tip_cents, p.amount_cents, p.created_at
ORDER BY p.created_at DESC;

-- Expected: payment_matches_receipts = TRUE for all rows


-- ============================================================================
-- 5. SUMMARY RECONCILIATION REPORT
-- ============================================================================

SELECT
  '✅ RECONCILED ORDERS' as status,
  COUNT(*) as total_orders,
  COUNT(*) FILTER (WHERE payment_matches_receipts = true) as fully_reconciled,
  COUNT(*) FILTER (WHERE payment_matches_receipts = false) as still_mismatched,
  SUM(stripe_charged_amount) as total_stripe_charged_cents,
  SUM(receipts_total) as total_receipts_cents,
  SUM(stripe_charged_amount) - SUM(receipts_total) as discrepancy_cents
FROM (
  SELECT
    p.amount_cents as stripe_charged_amount,
    COALESCE(SUM(tr.amount_cents), 0) as receipts_total,
    p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) as payment_matches_receipts
  FROM orders o
  JOIN payments p ON p.order_id = o.id AND p.type = 'deposit'
  LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
  WHERE 
    o.created_at > NOW() - INTERVAL '30 days'
    AND o.tip_cents > 0
    AND EXISTS (
      SELECT 1 FROM transaction_receipts 
      WHERE order_id = o.id AND transaction_type = 'deposit'
    )
  GROUP BY o.id, p.amount_cents
) reconciliation;

-- Expected: still_mismatched = 0, discrepancy_cents = 0


-- ============================================================================
-- 6. VERIFY SAME CHARGE ID FOR DEPOSIT + TIP
-- ============================================================================

SELECT
  o.id as order_id,
  tr.transaction_type,
  tr.receipt_number,
  tr.amount_cents,
  tr.stripe_charge_id,
  tr.receipt_group_id
FROM orders o
JOIN transaction_receipts tr ON tr.order_id = o.id
WHERE o.tip_cents > 0
  AND o.created_at > NOW() - INTERVAL '30 days'
ORDER BY o.id, tr.transaction_type;

-- Expected: Same stripe_charge_id for deposit and tip receipts of each order
