/*
  # Fix Deposit Amount and Add Free Travel Cities

  1. Changes
    - Update deposit_per_unit_cents from $100 (10000) to $50 (5000)
    - Ensure included_cities column exists in pricing_rules for free travel cities

  2. Security
    - No RLS changes needed
*/

-- Update deposit to $50 (5000 cents) where it's currently $100 (10000 cents)
UPDATE pricing_rules
SET deposit_per_unit_cents = 5000
WHERE deposit_per_unit_cents = 10000 OR deposit_per_unit_cents IS NULL;

-- Ensure included_cities column exists (should already exist but adding for safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'included_cities'
  ) THEN
    ALTER TABLE pricing_rules ADD COLUMN included_cities text[] DEFAULT NULL;
  END IF;
END $$;
