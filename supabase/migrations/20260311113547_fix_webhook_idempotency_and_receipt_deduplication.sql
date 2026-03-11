/*
  # Fix Webhook Idempotency and Receipt Deduplication
  
  This migration fixes two critical issues:
  
  ## 1. Webhook Idempotency Status Tracking
  
  **Problem:** Current system marks webhooks as "processed" before actually processing.
  If processing crashes, retries are skipped forever, causing missing payments/receipts.
  
  **Solution:** Add status tracking to allow safe retries.
  
  ### Changes to stripe_webhook_events:
  - Add `status` column (processing, succeeded, failed)
  - Add `attempts` counter
  - Add `last_error` for debugging
  - Add `updated_at` for staleness detection
  - Add index for cleanup/retry queries
  
  ### Behavior:
  - Insert as 'processing' before work starts
  - If crash occurs, status stays 'processing'
  - Stripe retry will check:
    - If 'succeeded' → skip (already done)
    - If 'processing' and recent (<5 min) → skip (in progress)
    - If 'processing' and stale OR 'failed' → retry allowed
  - After success, update to 'succeeded'
  - After failure, update to 'failed' with error
  
  ## 2. Receipt Deduplication Improvement
  
  **Problem:** UNIQUE constraint on stripe_charge_id can fail because:
  - latest_charge can be NULL in some cases
  - NULLS NOT DISTINCT blocks multiple NULL rows incorrectly
  
  **Solution:** Add better deduplication using payment_intent_id + transaction_type.
  
  ### Changes to transaction_receipts:
  - Add UNIQUE constraint on (stripe_payment_intent_id, transaction_type)
  - This guarantees one deposit receipt per payment intent
  - This guarantees one balance receipt per payment intent
  - Keep existing charge_id constraint as secondary protection
  
  ## Security
  - Existing RLS policies remain unchanged
  - No breaking changes to existing data
*/

-- ============================================================================
-- PART 1: Upgrade Webhook Idempotency System
-- ============================================================================

-- Add status tracking columns to stripe_webhook_events
ALTER TABLE stripe_webhook_events
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing',
ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Add check constraint for valid status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'webhook_events_status_check'
  ) THEN
    ALTER TABLE stripe_webhook_events
    ADD CONSTRAINT webhook_events_status_check
    CHECK (status IN ('processing', 'succeeded', 'failed'));
  END IF;
END $$;

-- Add index for status-based queries (cleanup, retry scans)
CREATE INDEX IF NOT EXISTS idx_webhook_events_status_updated
ON stripe_webhook_events(status, updated_at);

-- Update existing rows to 'succeeded' status (they're already processed)
UPDATE stripe_webhook_events
SET status = 'succeeded', attempts = 1, updated_at = processed_at
WHERE status = 'processing';

-- Add trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_webhook_event_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_webhook_events_updated_at'
  ) THEN
    CREATE TRIGGER update_webhook_events_updated_at
      BEFORE UPDATE ON stripe_webhook_events
      FOR EACH ROW
      EXECUTE FUNCTION update_webhook_event_timestamp();
  END IF;
END $$;

-- ============================================================================
-- PART 2: Improve Receipt Deduplication
-- ============================================================================

-- Add unique constraint on (payment_intent_id, transaction_type)
-- This prevents duplicate receipts even when charge_id is NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_receipt_pi_type'
  ) THEN
    ALTER TABLE transaction_receipts
    ADD CONSTRAINT unique_receipt_pi_type
    UNIQUE NULLS NOT DISTINCT (stripe_payment_intent_id, transaction_type);
  END IF;
END $$;

-- ============================================================================
-- PART 3: Comments for Documentation
-- ============================================================================

COMMENT ON COLUMN stripe_webhook_events.status IS 
'Status of webhook processing: processing (in progress), succeeded (complete), failed (error occurred)';

COMMENT ON COLUMN stripe_webhook_events.attempts IS 
'Number of processing attempts. Increments on each retry.';

COMMENT ON COLUMN stripe_webhook_events.last_error IS 
'Error message from most recent failed attempt for debugging';

COMMENT ON COLUMN stripe_webhook_events.updated_at IS 
'Timestamp of last status update. Used to detect stale "processing" events that need retry.';

COMMENT ON CONSTRAINT unique_receipt_pi_type ON transaction_receipts IS 
'Prevents duplicate receipts for same payment intent and transaction type. Primary deduplication mechanism.';
