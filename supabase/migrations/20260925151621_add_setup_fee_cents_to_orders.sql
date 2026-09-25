/*
# Add setup_fee_cents to orders

1. Purpose
   Adds a new financial column `setup_fee_cents` to the `orders` table to
   store the Event Essentials-only Setup Fee. This fee applies only when
   an order has zero inflatables and a pre-discount Event Essentials
   equipment subtotal below $150.00.

2. Schema Changes
   - `orders.setup_fee_cents`: integer, NOT NULL, DEFAULT 0, with a
     CHECK constraint ensuring non-negative values.

3. Historical Orders
   The DEFAULT 0 ensures all existing orders remain financially frozen.
   No historical backfill is performed. Existing orders keep
   setup_fee_cents = 0 regardless of their current Event Essentials contents.

4. Security
   No RLS policy changes. The column inherits existing order-level RLS.
*/

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS setup_fee_cents integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_setup_fee_cents_non_negative'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_setup_fee_cents_non_negative
      CHECK (setup_fee_cents >= 0);
  END IF;
END $$;
