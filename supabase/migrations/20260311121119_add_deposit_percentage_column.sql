/*
  # Add deposit_percentage column to pricing_rules

  1. Changes
    - Add `deposit_percentage` column to pricing_rules table
    - Default value: 0.25 (25% deposit)
    - This allows for percentage-based deposits as an alternative to fixed per-unit deposits

  2. Notes
    - The application code uses this to calculate deposit amounts dynamically
    - Can be used alongside or instead of deposit_per_unit_cents
*/

-- Add deposit_percentage column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'deposit_percentage'
  ) THEN
    ALTER TABLE pricing_rules 
    ADD COLUMN deposit_percentage DECIMAL(3, 2) DEFAULT 0.25;
  END IF;
END $$;

-- Update existing row to have the default value
UPDATE pricing_rules
SET deposit_percentage = 0.25
WHERE deposit_percentage IS NULL;
