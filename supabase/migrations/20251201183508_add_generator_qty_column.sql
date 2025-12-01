/*
  # Add Generator Quantity Column to Orders

  1. Changes
    - Add `generator_qty` column to `orders` table to track how many generators are ordered
    - Default value is 0 (no generators)
    - This allows tracking generator count separately from the fee calculation

  2. Notes
    - Generator quantity is used to calculate generator_fee_cents
    - Each generator costs generator_price_cents (configured in pricing_rules)
*/

-- Add generator quantity to orders table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'generator_qty'
  ) THEN
    ALTER TABLE orders ADD COLUMN generator_qty integer DEFAULT 0;
  END IF;
END $$;
