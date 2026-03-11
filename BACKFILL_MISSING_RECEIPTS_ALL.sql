/*
  ============================================================================
  BACKFILL ALL MISSING RECEIPTS (DEPOSIT + TIP)
  ============================================================================

  This script creates transaction receipts for orders that have:
  - A successful deposit payment (payments.type='deposit', status='succeeded')
  - ZERO transaction_receipts rows for that payment_intent_id

  Root Cause: Transaction receipts system was implemented on 2026-03-11.
  Any payments before that date have no receipts.

  For each payment, this script inserts:
  1. DEPOSIT receipt: amount = payment.amount_cents - tip_cents
  2. TIP receipt (if tip > 0): amount = orders.tip_cents

  Both receipts share:
  - Same stripe_payment_intent_id (from payment)
  - Same stripe_charge_id (synthetic: 'bf_pi_' || payment_intent_id)
  - Same receipt_group_id (new UUID per order)
  - Same order_id, customer_id, payment_id

  CRITICAL: stripe_charge_id cannot be NULL due to NULLS NOT DISTINCT constraint.
  We use a deterministic synthetic ID: 'bf_pi_' + payment_intent_id

  Constraints respected:
  - unique_receipt_pi_type (stripe_payment_intent_id, transaction_type)
  - unique_receipt_charge_type (stripe_charge_id, transaction_type) NULLS NOT DISTINCT

  IDEMPOTENT: Safe to run multiple times. Will NOT insert duplicates.

  ============================================================================
*/

-- ============================================================================
-- STEP 1: PREVIEW - What will be inserted
-- ============================================================================

WITH missing_receipt_payments AS (
  SELECT
    o.id as order_id,
    p.id as payment_id,
    p.stripe_payment_intent_id,
    p.amount_cents as payment_amount_cents,
    o.tip_cents,
    o.deposit_due_cents,
    o.customer_id,
    p.payment_method,
    p.payment_brand,
    p.created_at,

    -- Synthetic charge_id to avoid NULL constraint issues
    'bf_pi_' || p.stripe_payment_intent_id as synthetic_charge_id
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
)
SELECT
  order_id,
  payment_id,
  stripe_payment_intent_id,
  synthetic_charge_id,
  customer_id,
  payment_amount_cents,
  tip_cents,
  deposit_due_cents,

  -- Deposit receipt amount
  GREATEST(payment_amount_cents - COALESCE(tip_cents, 0), 0) as deposit_receipt_amount,

  -- Tip receipt amount (NULL if no tip)
  CASE WHEN COALESCE(tip_cents, 0) > 0 THEN tip_cents ELSE NULL END as tip_receipt_amount,

  -- Total should equal payment
  GREATEST(payment_amount_cents - COALESCE(tip_cents, 0), 0) + COALESCE(tip_cents, 0) as total_receipts,

  -- Verification
  payment_amount_cents = (GREATEST(payment_amount_cents - COALESCE(tip_cents, 0), 0) + COALESCE(tip_cents, 0)) as amounts_match,

  payment_method,
  payment_brand,
  created_at

FROM missing_receipt_payments
ORDER BY created_at DESC;


-- ============================================================================
-- STEP 2: BACKFILL - Insert missing receipts
-- ============================================================================

-- First, insert DEPOSIT receipts
WITH missing_receipt_payments AS (
  SELECT
    o.id as order_id,
    p.id as payment_id,
    p.stripe_payment_intent_id,
    p.amount_cents as payment_amount_cents,
    o.tip_cents,
    o.customer_id,
    p.payment_method,
    p.payment_brand,
    p.created_at,
    gen_random_uuid() as receipt_group_id,
    'bf_pi_' || p.stripe_payment_intent_id as synthetic_charge_id
  FROM orders o
  JOIN payments p ON p.order_id = o.id
  WHERE
    p.type = 'deposit'
    AND p.status = 'succeeded'
    AND o.created_at > NOW() - INTERVAL '90 days'

    -- Idempotency: No deposit receipt exists for this payment_intent
    AND NOT EXISTS (
      SELECT 1 FROM transaction_receipts tr
      WHERE tr.stripe_payment_intent_id = p.stripe_payment_intent_id
        AND tr.transaction_type = 'deposit'
    )
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
  'deposit' as transaction_type,
  order_id,
  customer_id,
  payment_id,
  GREATEST(payment_amount_cents - COALESCE(tip_cents, 0), 0) as amount_cents,
  payment_method,
  payment_brand as payment_method_brand,
  synthetic_charge_id as stripe_charge_id,
  stripe_payment_intent_id,
  receipt_group_id,
  'Backfilled deposit receipt for order ' || order_id::text as notes,
  created_at
FROM missing_receipt_payments
WHERE GREATEST(payment_amount_cents - COALESCE(tip_cents, 0), 0) > 0
RETURNING receipt_number, transaction_type, amount_cents, stripe_payment_intent_id, stripe_charge_id;


-- Second, insert TIP receipts (only for orders with tips)
WITH missing_receipt_payments AS (
  SELECT
    o.id as order_id,
    p.id as payment_id,
    p.stripe_payment_intent_id,
    o.tip_cents,
    o.customer_id,
    p.payment_method,
    p.payment_brand,
    p.created_at,
    'bf_pi_' || p.stripe_payment_intent_id as synthetic_charge_id,

    -- Get the receipt_group_id from the deposit receipt we just created
    (
      SELECT receipt_group_id
      FROM transaction_receipts
      WHERE stripe_payment_intent_id = p.stripe_payment_intent_id
        AND transaction_type = 'deposit'
      LIMIT 1
    ) as receipt_group_id

  FROM orders o
  JOIN payments p ON p.order_id = o.id
  WHERE
    p.type = 'deposit'
    AND p.status = 'succeeded'
    AND o.created_at > NOW() - INTERVAL '90 days'
    AND o.tip_cents > 0

    -- Has a deposit receipt
    AND EXISTS (
      SELECT 1 FROM transaction_receipts tr
      WHERE tr.stripe_payment_intent_id = p.stripe_payment_intent_id
        AND tr.transaction_type = 'deposit'
    )

    -- But NO tip receipt yet (idempotency)
    AND NOT EXISTS (
      SELECT 1 FROM transaction_receipts tr
      WHERE tr.stripe_payment_intent_id = p.stripe_payment_intent_id
        AND tr.transaction_type = 'tip'
    )
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
  payment_brand as payment_method_brand,
  synthetic_charge_id as stripe_charge_id,
  stripe_payment_intent_id,
  receipt_group_id,
  'Backfilled tip receipt for order ' || order_id::text as notes,
  created_at
FROM missing_receipt_payments
WHERE tip_cents > 0
  AND receipt_group_id IS NOT NULL
RETURNING receipt_number, transaction_type, amount_cents, stripe_payment_intent_id, stripe_charge_id;


-- ============================================================================
-- STEP 3: VERIFY - Check that receipts now match payments
-- ============================================================================

SELECT
  '✅ VERIFICATION: Receipts now match payments' as status,
  COUNT(*) as total_payments,
  COUNT(*) FILTER (WHERE payment_matches_receipts = true) as fully_reconciled,
  COUNT(*) FILTER (WHERE payment_matches_receipts = false) as still_mismatched,
  SUM(payment_amount_cents) as total_paid_cents,
  SUM(receipts_total) as total_receipts_cents,
  SUM(payment_amount_cents) - SUM(receipts_total) as discrepancy_cents
FROM (
  SELECT
    p.stripe_payment_intent_id,
    p.amount_cents as payment_amount_cents,
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
) verification;


-- ============================================================================
-- STEP 4: DETAILED RECONCILIATION
-- ============================================================================

SELECT
  o.id as order_id,
  p.stripe_payment_intent_id,
  p.amount_cents as payment_amount,

  -- Receipts breakdown
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'deposit'), 0) as receipt_deposit,
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'tip'), 0) as receipt_tip,
  COALESCE(SUM(tr.amount_cents), 0) as receipts_total,

  -- Match verification
  p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) as payment_matches_receipts,

  -- Receipt details
  array_agg(tr.receipt_number ORDER BY tr.transaction_type) FILTER (WHERE tr.receipt_number IS NOT NULL) as receipt_numbers,
  array_agg(DISTINCT tr.stripe_charge_id) FILTER (WHERE tr.stripe_charge_id IS NOT NULL) as stripe_charge_ids,
  array_agg(DISTINCT tr.receipt_group_id) FILTER (WHERE tr.receipt_group_id IS NOT NULL) as receipt_group_ids,

  p.created_at

FROM orders o
JOIN payments p ON p.order_id = o.id
LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE
  p.type = 'deposit'
  AND p.status = 'succeeded'
  AND o.created_at > NOW() - INTERVAL '90 days'
GROUP BY o.id, p.stripe_payment_intent_id, p.amount_cents, p.created_at
ORDER BY p.created_at DESC;


-- ============================================================================
-- STEP 5: CONSTRAINT VERIFICATION
-- ============================================================================

-- Verify unique_receipt_pi_type constraint (stripe_payment_intent_id, transaction_type)
SELECT
  '🔒 Constraint: unique_receipt_pi_type' as constraint_name,
  COUNT(*) as total_receipts,
  COUNT(DISTINCT (stripe_payment_intent_id, transaction_type)) as unique_combinations,
  COUNT(*) = COUNT(DISTINCT (stripe_payment_intent_id, transaction_type)) as constraint_satisfied
FROM transaction_receipts
WHERE stripe_payment_intent_id LIKE 'pi_%';

-- Verify unique_receipt_charge_type constraint (stripe_charge_id, transaction_type)
SELECT
  '🔒 Constraint: unique_receipt_charge_type' as constraint_name,
  COUNT(*) as total_receipts,
  COUNT(DISTINCT (stripe_charge_id, transaction_type)) as unique_combinations,
  COUNT(*) = COUNT(DISTINCT (stripe_charge_id, transaction_type)) as constraint_satisfied,
  COUNT(*) FILTER (WHERE stripe_charge_id IS NULL) as null_charge_ids,
  COUNT(*) FILTER (WHERE stripe_charge_id LIKE 'bf_pi_%') as backfilled_charge_ids
FROM transaction_receipts;

-- Show backfilled receipts grouped by payment_intent
SELECT
  stripe_payment_intent_id,
  stripe_charge_id,
  array_agg(transaction_type ORDER BY transaction_type) as transaction_types,
  array_agg(amount_cents ORDER BY transaction_type) as amounts,
  SUM(amount_cents) as total_amount,
  COUNT(*) as receipt_count,
  COUNT(DISTINCT receipt_group_id) as group_count
FROM transaction_receipts
WHERE stripe_charge_id LIKE 'bf_pi_%'
GROUP BY stripe_payment_intent_id, stripe_charge_id
ORDER BY stripe_payment_intent_id;
