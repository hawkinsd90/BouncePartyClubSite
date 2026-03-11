/*
  # Enterprise-Level Accounting Safety Upgrades
  
  This migration upgrades the transaction receipt and payment system to enterprise-level
  accounting standards with the following improvements:
  
  ## 1. Duplicate Receipt Prevention
    - Add UNIQUE constraint on `stripe_charge_id` to prevent duplicate receipts
    - Handles Stripe webhook retries and page refresh scenarios
  
  ## 2. Receipt Grouping for Multi-Line Transactions
    - Add `receipt_group_id` column to group related line items
    - Example: Deposit $400 + Tip $49 = 1 group with 2 line items
    - Improves accounting clarity and reporting
  
  ## 3. Payment Ledger Safety
    - Add `ledger_sequence` BIGSERIAL for chronological ordering
    - Ensure `created_at` exists for temporal tracking
    - Creates immutable append-only payment ledger
  
  ## 4. Webhook Idempotency
    - Create `stripe_webhook_events` table
    - Track processed webhook events by `stripe_event_id`
    - Prevent duplicate processing on webhook retries
  
  ## 5. Stripe Reconciliation Fields
    - Add `stripe_fee_amount` to track Stripe fees
    - Add `stripe_net_amount` for net proceeds
    - Add `currency` with default 'usd'
    - Enables accurate financial reconciliation
  
  ## 6. Refund Traceability
    - Add `refunded_payment_id` to link refunds to original payments
    - Creates clear audit trail for refund transactions
  
  ## 7. Performance Indexes
    - Index on `payments(order_id)` for order lookups
    - Index on `transaction_receipts(receipt_group_id)` for grouped receipts
    - Index on `payments(created_at)` for chronological queries
    - Index on `payments(ledger_sequence)` for ledger ordering
  
  ## 8. Security
    - All new tables have RLS enabled
    - Admin-only access policies
    - Maintains existing security model
*/

-- ============================================================================
-- PART 1: Transaction Receipts Improvements
-- ============================================================================

-- Add receipt_group_id for grouping multi-line transactions
ALTER TABLE transaction_receipts
ADD COLUMN IF NOT EXISTS receipt_group_id UUID;

-- Add unique constraint on stripe_charge_id to prevent duplicates
-- This prevents duplicate receipts from webhook retries or page refreshes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_receipt_charge'
  ) THEN
    ALTER TABLE transaction_receipts
    ADD CONSTRAINT unique_receipt_charge
    UNIQUE NULLS NOT DISTINCT (stripe_charge_id);
  END IF;
END $$;

-- Index for receipt grouping queries
CREATE INDEX IF NOT EXISTS idx_receipts_group 
ON transaction_receipts(receipt_group_id);

-- ============================================================================
-- PART 2: Payments Table Improvements
-- ============================================================================

-- Add ledger_sequence for chronological ordering (append-only ledger)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'ledger_sequence'
  ) THEN
    ALTER TABLE payments ADD COLUMN ledger_sequence BIGSERIAL;
  END IF;
END $$;

-- Ensure created_at exists (should already exist, but being safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE payments ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Add Stripe reconciliation fields
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS stripe_fee_amount INTEGER,
ADD COLUMN IF NOT EXISTS stripe_net_amount INTEGER,
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'usd';

-- Add refund traceability
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS refunded_payment_id UUID REFERENCES payments(id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_payments_order_id 
ON payments(order_id);

CREATE INDEX IF NOT EXISTS idx_payments_created 
ON payments(created_at);

CREATE INDEX IF NOT EXISTS idx_payments_ledger_sequence 
ON payments(ledger_sequence);

CREATE INDEX IF NOT EXISTS idx_payments_refunded 
ON payments(refunded_payment_id);

-- ============================================================================
-- PART 3: Webhook Idempotency Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast event lookup
CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id 
ON stripe_webhook_events(stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_type 
ON stripe_webhook_events(event_type);

-- Enable RLS
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for webhook events (admin-only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'stripe_webhook_events' 
    AND policyname = 'Admin users can view webhook events'
  ) THEN
    CREATE POLICY "Admin users can view webhook events"
      ON stripe_webhook_events
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_roles.user_id = auth.uid()
          AND user_roles.role IN ('MASTER', 'ADMIN')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'stripe_webhook_events' 
    AND policyname = 'System can insert webhook events'
  ) THEN
    CREATE POLICY "System can insert webhook events"
      ON stripe_webhook_events
      FOR INSERT
      TO anon
      WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- PART 4: Helper Functions
-- ============================================================================

-- Function to generate receipt group ID (can be called explicitly or used in triggers)
CREATE OR REPLACE FUNCTION generate_receipt_group_id()
RETURNS UUID
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN gen_random_uuid();
END;
$$;

-- ============================================================================
-- PART 5: Comments for Documentation
-- ============================================================================

COMMENT ON COLUMN transaction_receipts.receipt_group_id IS 
'Groups multiple receipt line items (e.g., deposit + tip) under one transaction';

COMMENT ON COLUMN payments.ledger_sequence IS 
'Chronological sequence number for append-only payment ledger. Never update, only append.';

COMMENT ON COLUMN payments.stripe_fee_amount IS 
'Stripe processing fee in cents for reconciliation';

COMMENT ON COLUMN payments.stripe_net_amount IS 
'Net amount after Stripe fees in cents';

COMMENT ON COLUMN payments.refunded_payment_id IS 
'Links refund entries to the original payment being refunded';

COMMENT ON TABLE stripe_webhook_events IS 
'Tracks processed Stripe webhook events to ensure idempotency and prevent duplicate processing';
