/*
  # Add Sandbag and Generator Fee Waiver Support

  1. Changes
    - Add `surface_fee_waived` boolean column to `orders` table to track when sandbag fees are waived
    - Add `surface_fee_waive_reason` text column to `orders` table
    - Add `generator_fee_waived` boolean column to `orders` table to track when generator fees are waived
    - Add `generator_fee_waive_reason` text column to `orders` table

  2. Notes
    - All waived boolean fields default to false
    - All waive reason fields are nullable (optional)
    - When a fee is waived, the corresponding fee amount should be treated as 0 in calculations
    - Reasons are logged in order_changelog for audit trail
    - Provides transparency and accountability for fee waivers
*/

-- Add surface fee (sandbags) waiver columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'surface_fee_waived'
  ) THEN
    ALTER TABLE orders ADD COLUMN surface_fee_waived boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'surface_fee_waive_reason'
  ) THEN
    ALTER TABLE orders ADD COLUMN surface_fee_waive_reason text;
  END IF;
END $$;

-- Add generator fee waiver columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'generator_fee_waived'
  ) THEN
    ALTER TABLE orders ADD COLUMN generator_fee_waived boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'generator_fee_waive_reason'
  ) THEN
    ALTER TABLE orders ADD COLUMN generator_fee_waive_reason text;
  END IF;
END $$;