/*
  # Add Generator Pricing Support

  1. Changes
    - Add `generator_price_cents` column to `pricing_rules` table
    - Set default generator price to $75 (7500 cents)
    - Add `generator_fee_cents` column to `orders` table to track generator charges
    - This allows itemized billing for generators

  2. Notes
    - Generator pricing can be configured in admin settings
    - Generators are charged per unit and appear as a line item
    - Generator fees are included in subtotal for tax calculation
*/

-- Add generator price to pricing rules
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pricing_rules' AND column_name = 'generator_price_cents'
  ) THEN
    ALTER TABLE pricing_rules ADD COLUMN generator_price_cents integer DEFAULT 7500;
  END IF;
END $$;

-- Add generator fee tracking to orders
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'generator_fee_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN generator_fee_cents integer DEFAULT 0;
  END IF;
END $$;

-- Update existing pricing rules with generator price if not set
UPDATE pricing_rules 
SET generator_price_cents = 7500 
WHERE generator_price_cents IS NULL;