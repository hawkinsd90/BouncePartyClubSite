/*
  # Fix Receipt Constraint for Deposit + Tip Transactions

  ## Problem

  When admin approves an order with deposit + tip, Stripe creates ONE charge for both amounts.
  Current unique constraint on stripe_charge_id prevents inserting separate receipts for deposit and tip,
  causing accounting reconciliation failures:

  - payments.amount_cents = deposit + tip (correct)
  - transaction_receipts only has deposit receipt (missing tip receipt)
  - SUM(transaction_receipts.amount_cents) < payments.amount_cents ❌

  ## Solution

  Replace unique constraint on (stripe_charge_id) with (stripe_charge_id, transaction_type).
  This allows multiple receipt line items (deposit, tip) for the same Stripe charge.

  ## Changes

  1. Drop existing unique_receipt_charge constraint on (stripe_charge_id)
  2. Add new constraint on (stripe_charge_id, transaction_type)
  3. Keep existing unique_receipt_pi_type on (payment_intent_id, transaction_type) unchanged

  ## Result

  After this migration:
  - One Stripe charge can have multiple receipts (deposit + tip)
  - Each receipt type is unique per charge (no duplicate deposit receipts)
  - payments.amount_cents = SUM(transaction_receipts.amount_cents) ✅

  ## Security

  No RLS changes required - maintains existing security model.
*/

-- ============================================================================
-- PART 1: Drop Old Constraint (stripe_charge_id only)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_receipt_charge'
  ) THEN
    ALTER TABLE transaction_receipts
    DROP CONSTRAINT unique_receipt_charge;

    RAISE NOTICE 'Dropped unique_receipt_charge constraint on (stripe_charge_id)';
  END IF;
END $$;

-- ============================================================================
-- PART 2: Add New Constraint (stripe_charge_id, transaction_type)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_receipt_charge_type'
  ) THEN
    ALTER TABLE transaction_receipts
    ADD CONSTRAINT unique_receipt_charge_type
    UNIQUE NULLS NOT DISTINCT (stripe_charge_id, transaction_type);

    RAISE NOTICE 'Added unique_receipt_charge_type constraint on (stripe_charge_id, transaction_type)';
  END IF;
END $$;

-- ============================================================================
-- PART 3: Comments for Documentation
-- ============================================================================

COMMENT ON CONSTRAINT unique_receipt_charge_type ON transaction_receipts IS
'Allows multiple receipt line items (deposit, tip, etc) for the same Stripe charge. Each transaction_type is unique per charge_id.';
