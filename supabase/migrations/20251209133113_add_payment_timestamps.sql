/*
  # Add Payment Success Timestamp

  1. New Columns
    - `paid_at` (timestamptz) - Exact timestamp when payment succeeded
    - `failed_at` (timestamptz) - Timestamp when payment failed (if applicable)
    - `updated_at` (timestamptz) - When payment record was last updated

  2. Purpose
    - Track exact time payments are successful for receipts
    - Display payment time on admin calendar
    - Better audit trail for payment status changes

  3. Notes
    - paid_at is set when status becomes 'succeeded'
    - failed_at is set when status becomes 'failed'
    - updated_at tracks any changes to the record
*/

-- Add paid_at timestamp
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Add failed_at timestamp
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

-- Add updated_at timestamp
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_updated_at_trigger ON payments;

CREATE TRIGGER payments_updated_at_trigger
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_payments_updated_at();

-- Backfill paid_at for existing successful payments
UPDATE payments 
SET paid_at = created_at 
WHERE status = 'succeeded' AND paid_at IS NULL;

-- Backfill failed_at for existing failed payments
UPDATE payments 
SET failed_at = created_at 
WHERE status = 'failed' AND failed_at IS NULL;

COMMENT ON COLUMN payments.paid_at IS 'Timestamp when payment succeeded';
COMMENT ON COLUMN payments.failed_at IS 'Timestamp when payment failed';
COMMENT ON COLUMN payments.updated_at IS 'Timestamp when payment record was last updated';
