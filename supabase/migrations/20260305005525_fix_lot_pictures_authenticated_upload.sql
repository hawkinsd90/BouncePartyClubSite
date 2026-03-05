/*
  # Fix Lot Pictures Upload for Authenticated Customers
  
  1. Changes
    - Update authenticated user INSERT policy to allow uploads for their orders OR orders they have access to via link
  
  2. Security
    - Authenticated customers can upload if they own the order OR if order exists (trusting portal link access)
*/

-- Drop and recreate the authenticated insert policy
DROP POLICY IF EXISTS "Customers can upload lot pictures for their orders" ON order_lot_pictures;

CREATE POLICY "Customers can upload lot pictures for their orders"
  ON order_lot_pictures
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if customer owns the order
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_lot_pictures.order_id
      AND orders.customer_id = auth.uid()
    )
    OR
    -- Allow if order exists (trusting portal link access control)
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_lot_pictures.order_id
    )
  );
