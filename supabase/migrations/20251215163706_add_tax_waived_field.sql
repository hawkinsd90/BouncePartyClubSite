/*
  # Add Tax Waiver Support
  
  1. Changes
    - Add `tax_waived` boolean column to `orders` table to track when taxes are waived by admin
    - Defaults to `false` (taxes not waived)
    - When true, tax_cents should be treated as 0 in total calculations
  
  2. Notes
    - This allows master/admin users to waive taxes on specific orders
    - Changes will be logged in order_changelog table using existing changelog system
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'tax_waived'
  ) THEN
    ALTER TABLE orders ADD COLUMN tax_waived boolean DEFAULT false;
  END IF;
END $$;
