/*
  # Tighten order_lot_pictures anon RLS

  ## Summary
  Replaces the overly permissive `WITH CHECK (true)` anonymous INSERT policy on
  `order_lot_pictures` with a check that requires the referenced order to actually
  exist. This prevents arbitrary rows from being inserted by unauthenticated callers
  that do not belong to a real order.

  ## Changes
  - Drops the existing `TO anon` INSERT policy that uses `WITH CHECK (true)`
  - Re-creates it with `WITH CHECK (EXISTS (SELECT 1 FROM orders WHERE id = order_id))`

  ## Security
  - Anonymous users can still upload lot pictures for real orders (required for the
    customer-facing lot-pictures flow that runs before auth is established)
  - Random / fabricated order IDs are rejected at the policy level
*/

DROP POLICY IF EXISTS "Anyone can insert lot pictures" ON order_lot_pictures;
DROP POLICY IF EXISTS "Anon can insert lot pictures" ON order_lot_pictures;
DROP POLICY IF EXISTS "anon can insert lot pictures" ON order_lot_pictures;

CREATE POLICY "Anon can insert lot pictures for existing orders"
  ON order_lot_pictures
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders WHERE id = order_lot_pictures.order_id
    )
  );
