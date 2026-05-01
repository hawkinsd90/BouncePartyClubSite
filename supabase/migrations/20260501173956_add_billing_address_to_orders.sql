/*
  # Add billing address fields to orders table

  ## Summary
  Adds separate billing address columns directly to the orders table so that
  when a customer enters a billing address different from their event/delivery
  address at checkout, both addresses are preserved independently.

  ## New Columns on `orders`
  - `billing_address_line1` (text, nullable) — street line 1 of billing address
  - `billing_address_line2` (text, nullable) — apt/suite of billing address
  - `billing_city` (text, nullable) — billing city
  - `billing_state` (text, nullable) — billing state
  - `billing_zip` (text, nullable) — billing ZIP code

  ## Notes
  - All columns are nullable so existing orders are unaffected
  - No RLS changes needed — these columns live on the existing `orders` table
    which already has RLS policies in place
  - The event/delivery address continues to be stored via `address_id` (unchanged)
  - Billing fields are populated only when the customer explicitly enters a
    different billing address; when "same as event" is checked they remain NULL
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'billing_address_line1'
  ) THEN
    ALTER TABLE orders ADD COLUMN billing_address_line1 text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'billing_address_line2'
  ) THEN
    ALTER TABLE orders ADD COLUMN billing_address_line2 text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'billing_city'
  ) THEN
    ALTER TABLE orders ADD COLUMN billing_city text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'billing_state'
  ) THEN
    ALTER TABLE orders ADD COLUMN billing_state text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'billing_zip'
  ) THEN
    ALTER TABLE orders ADD COLUMN billing_zip text;
  END IF;
END $$;
