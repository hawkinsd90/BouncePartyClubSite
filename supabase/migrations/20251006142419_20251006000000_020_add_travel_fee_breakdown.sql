/*
  # Add Travel Fee Breakdown Columns

  1. New Columns
    - `travel_total_miles` (numeric) - Total distance from home base to event
    - `travel_base_radius_miles` (numeric) - Free radius (e.g., 25 miles)
    - `travel_chargeable_miles` (numeric) - Miles beyond base radius that are charged
    - `travel_per_mile_cents` (integer) - Rate per mile in cents
    - `travel_is_flat_fee` (boolean) - Whether fee is flat zone override vs per-mile
  
  2. Purpose
    - Provide transparency in travel fee calculations
    - Show "our work" for travel charges
    - Help customers understand pricing
*/

DO $$
BEGIN
  -- Add total miles traveled
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_total_miles'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_total_miles numeric(8,2);
  END IF;

  -- Add base radius (free zone)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_base_radius_miles'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_base_radius_miles numeric(8,2);
  END IF;

  -- Add chargeable miles (miles beyond base)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_chargeable_miles'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_chargeable_miles numeric(8,2);
  END IF;

  -- Add per-mile rate
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_per_mile_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_per_mile_cents integer;
  END IF;

  -- Add flag for flat fee vs per-mile
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_is_flat_fee'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_is_flat_fee boolean DEFAULT false;
  END IF;
END $$;