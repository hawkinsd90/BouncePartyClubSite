/*
  # Add Fee Waiver Reasons System

  1. Changes
    - Add `tax_waive_reason` text column to `orders` table to track why tax was waived
    - Add `travel_fee_waived` boolean column to `orders` table
    - Add `travel_fee_waive_reason` text column to `orders` table
    - Add `same_day_pickup_fee_waived` boolean column to `orders` table
    - Add `same_day_pickup_fee_waive_reason` text column to `orders` table

  2. Notes
    - All waive reason fields are nullable (optional)
    - Waived boolean fields default to false
    - When a fee is waived, the corresponding fee amount should be treated as 0 in calculations
    - Reasons are logged in order_changelog for audit trail
    - Provides transparency and accountability for fee waivers
*/

-- Add tax waive reason to existing tax_waived functionality
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'tax_waive_reason'
  ) THEN
    ALTER TABLE orders ADD COLUMN tax_waive_reason text;
  END IF;
END $$;

-- Add travel fee waiver columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_fee_waived'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_fee_waived boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_fee_waive_reason'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_fee_waive_reason text;
  END IF;
END $$;

-- Add same day pickup fee waiver columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'same_day_pickup_fee_waived'
  ) THEN
    ALTER TABLE orders ADD COLUMN same_day_pickup_fee_waived boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'same_day_pickup_fee_waive_reason'
  ) THEN
    ALTER TABLE orders ADD COLUMN same_day_pickup_fee_waive_reason text;
  END IF;
END $$;
