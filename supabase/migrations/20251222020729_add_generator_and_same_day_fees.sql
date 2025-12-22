/*
  # Add Generator and Same Day Pickup Fees

  1. Changes
    - Add generator_fee_single_cents for single generator ($100)
    - Add generator_fee_multiple_cents for multiple generators ($75 each)
    - Add same_day_pickup_fee_cents for same day pickups
    - Set Detroit as default free travel city if not already set

  2. Security
    - No RLS changes needed
*/

-- Add new pricing fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'generator_fee_single_cents'
  ) THEN
    ALTER TABLE pricing_rules ADD COLUMN generator_fee_single_cents integer DEFAULT 10000;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'generator_fee_multiple_cents'
  ) THEN
    ALTER TABLE pricing_rules ADD COLUMN generator_fee_multiple_cents integer DEFAULT 7500;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'same_day_pickup_fee_cents'
  ) THEN
    ALTER TABLE pricing_rules ADD COLUMN same_day_pickup_fee_cents integer DEFAULT 0;
  END IF;
END $$;

-- Set Detroit as default free travel city if included_cities is null or empty
UPDATE pricing_rules
SET included_cities = ARRAY['Detroit']
WHERE included_cities IS NULL OR included_cities = '{}' OR array_length(included_cities, 1) IS NULL;
