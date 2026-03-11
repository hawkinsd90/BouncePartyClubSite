/*
  ============================================================================
  RECONCILIATION QUERIES FOR TRANSACTION RECEIPTS
  ============================================================================
  
  These queries verify that:
  1. payments.amount_cents == SUM(transaction_receipts.amount_cents) per payment_intent_id
  2. No constraint violations exist
  3. All backfilled receipts are properly grouped
  
  ============================================================================
*/

-- ============================================================================
-- QUERY 1: Payment-to-Receipt Reconciliation (All Payments)
-- ============================================================================

SELECT
  'ALL PAYMENTS RECONCILIATION' as report_section,
  COUNT(*) as total_payments,
  COUNT(*) FILTER (WHERE payment_matches_receipts = true) as fully_reconciled,
  COUNT(*) FILTER (WHERE payment_matches_receipts = false) as mismatched,
  SUM(payment_amount_cents) as total_paid_cents,
  SUM(receipts_total) as total_receipts_cents,
  SUM(payment_amount_cents) - SUM(receipts_total) as discrepancy_cents,
  CASE 
    WHEN SUM(payment_amount_cents) = SUM(receipts_total) THEN '✅ PERFECT MATCH'
    ELSE '❌ MISMATCH DETECTED'
  END as status
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
-- QUERY 2: Payment-to-Receipt Reconciliation (Detailed Breakdown)
-- ============================================================================

SELECT
  p.stripe_payment_intent_id,
  o.id as order_id,
  p.amount_cents as payment_amount,
  
  -- Receipts breakdown
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'deposit'), 0) as receipt_deposit,
  COALESCE(SUM(tr.amount_cents) FILTER (WHERE tr.transaction_type = 'tip'), 0) as receipt_tip,
  COALESCE(SUM(tr.amount_cents), 0) as receipts_total,
  
  -- Discrepancy
  p.amount_cents - COALESCE(SUM(tr.amount_cents), 0) as discrepancy,
  
  -- Verification
  CASE 
    WHEN p.amount_cents = COALESCE(SUM(tr.amount_cents), 0) THEN '✅ MATCH'
    ELSE '❌ MISMATCH'
  END as status,
  
  -- Receipt details
  array_agg(tr.receipt_number ORDER BY tr.transaction_type) FILTER (WHERE tr.receipt_number IS NOT NULL) as receipt_numbers,
  array_agg(DISTINCT tr.stripe_charge_id) FILTER (WHERE tr.stripe_charge_id IS NOT NULL) as charge_ids,
  
  p.created_at

FROM orders o
JOIN payments p ON p.order_id = o.id
LEFT JOIN transaction_receipts tr ON tr.stripe_payment_intent_id = p.stripe_payment_intent_id
WHERE 
  p.type = 'deposit'
  AND p.status = 'succeeded'
  AND o.created_at > NOW() - INTERVAL '90 days'
GROUP BY p.id, p.stripe_payment_intent_id, p.amount_cents, o.id, p.created_at
ORDER BY p.created_at DESC;


-- ============================================================================
-- QUERY 3: Backfilled Receipts Reconciliation
-- ============================================================================

SELECT
  'BACKFILLED RECEIPTS ONLY' as report_section,
  COUNT(DISTINCT stripe_payment_intent_id) as total_payment_intents,
  COUNT(*) as total_receipts,
  COUNT(*) FILTER (WHERE transaction_type = 'deposit') as deposit_receipts,
  COUNT(*) FILTER (WHERE transaction_type = 'tip') as tip_receipts,
  SUM(amount_cents) as total_amount_cents,
  COUNT(DISTINCT receipt_group_id) as unique_groups
FROM transaction_receipts
WHERE stripe_charge_id LIKE 'bf_pi_%';


-- ============================================================================
-- QUERY 4: Backfilled Receipts Grouped by Payment Intent
-- ============================================================================

SELECT
  stripe_payment_intent_id,
  stripe_charge_id,
  array_agg(transaction_type ORDER BY transaction_type) as transaction_types,
  array_agg(receipt_number ORDER BY transaction_type) as receipt_numbers,
  array_agg(amount_cents ORDER BY transaction_type) as amounts,
  SUM(amount_cents) as total_amount,
  COUNT(*) as receipt_count,
  COUNT(DISTINCT receipt_group_id) as group_count,
  
  -- Verify single group per payment intent
  CASE 
    WHEN COUNT(DISTINCT receipt_group_id) = 1 THEN '✅ SINGLE GROUP'
    ELSE '❌ MULTIPLE GROUPS'
  END as group_status

FROM transaction_receipts
WHERE stripe_charge_id LIKE 'bf_pi_%'
GROUP BY stripe_payment_intent_id, stripe_charge_id
ORDER BY stripe_payment_intent_id;


-- ============================================================================
-- QUERY 5: Constraint Verification (unique_receipt_pi_type)
-- ============================================================================

SELECT
  '🔒 CONSTRAINT: unique_receipt_pi_type' as constraint_name,
  COUNT(*) as total_receipts,
  COUNT(DISTINCT (stripe_payment_intent_id, transaction_type)) as unique_combinations,
  COUNT(*) = COUNT(DISTINCT (stripe_payment_intent_id, transaction_type)) as constraint_satisfied,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT (stripe_payment_intent_id, transaction_type)) THEN '✅ NO VIOLATIONS'
    ELSE '❌ DUPLICATES FOUND'
  END as status
FROM transaction_receipts
WHERE stripe_payment_intent_id LIKE 'pi_%';


-- ============================================================================
-- QUERY 6: Constraint Verification (unique_receipt_charge_type)
-- ============================================================================

SELECT
  '🔒 CONSTRAINT: unique_receipt_charge_type' as constraint_name,
  COUNT(*) as total_receipts,
  COUNT(DISTINCT (stripe_charge_id, transaction_type)) as unique_combinations,
  COUNT(*) = COUNT(DISTINCT (stripe_charge_id, transaction_type)) as constraint_satisfied,
  COUNT(*) FILTER (WHERE stripe_charge_id IS NULL) as null_charge_ids,
  COUNT(*) FILTER (WHERE stripe_charge_id LIKE 'bf_pi_%') as backfilled_charge_ids,
  COUNT(*) FILTER (WHERE stripe_charge_id LIKE 'ch_%') as stripe_charge_ids,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT (stripe_charge_id, transaction_type)) THEN '✅ NO VIOLATIONS'
    ELSE '❌ DUPLICATES FOUND'
  END as status
FROM transaction_receipts;


-- ============================================================================
-- QUERY 7: Find Duplicate Receipts (if any)
-- ============================================================================

-- Check for duplicate (payment_intent, transaction_type) combinations
SELECT
  'DUPLICATE PI+TYPE CHECK' as check_type,
  stripe_payment_intent_id,
  transaction_type,
  COUNT(*) as duplicate_count,
  array_agg(receipt_number) as receipt_numbers
FROM transaction_receipts
WHERE stripe_payment_intent_id LIKE 'pi_%'
GROUP BY stripe_payment_intent_id, transaction_type
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Check for duplicate (charge_id, transaction_type) combinations
SELECT
  'DUPLICATE CHARGE+TYPE CHECK' as check_type,
  stripe_charge_id,
  transaction_type,
  COUNT(*) as duplicate_count,
  array_agg(receipt_number) as receipt_numbers
FROM transaction_receipts
WHERE stripe_charge_id IS NOT NULL
GROUP BY stripe_charge_id, transaction_type
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;


-- ============================================================================
-- QUERY 8: Payments Still Missing Receipts (if any)
-- ============================================================================

SELECT
  'PAYMENTS STILL MISSING RECEIPTS' as report_section,
  COUNT(*) as missing_count
FROM (
  SELECT
    o.id as order_id,
    p.stripe_payment_intent_id,
    p.amount_cents
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
) missing;


-- ============================================================================
-- QUERY 9: Summary Statistics
-- ============================================================================

SELECT
  '📊 SUMMARY STATISTICS' as section,
  (SELECT COUNT(*) FROM transaction_receipts) as total_all_receipts,
  (SELECT COUNT(*) FROM transaction_receipts WHERE stripe_charge_id LIKE 'bf_pi_%') as total_backfilled_receipts,
  (SELECT COUNT(*) FROM transaction_receipts WHERE stripe_charge_id LIKE 'ch_%') as total_stripe_receipts,
  (SELECT COUNT(*) FROM transaction_receipts WHERE stripe_charge_id IS NULL) as total_null_charge_receipts,
  (SELECT COUNT(DISTINCT receipt_group_id) FROM transaction_receipts) as total_receipt_groups,
  (SELECT SUM(amount_cents) FROM transaction_receipts) as total_receipts_amount_cents,
  (SELECT COUNT(*) FROM payments WHERE type = 'deposit' AND status = 'succeeded') as total_successful_payments;
