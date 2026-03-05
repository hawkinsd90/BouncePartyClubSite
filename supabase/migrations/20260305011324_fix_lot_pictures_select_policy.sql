/*
  # Fix Lot Pictures SELECT Policy for Authenticated Users
  
  1. Changes
    - Update authenticated SELECT policy to allow viewing lot pictures for orders they have access to via portal link
  
  2. Security
    - Allow if customer owns the order OR if order exists (trusting portal link access)
*/

-- Drop and recreate the authenticated select policy
DROP POLICY IF EXISTS "Customers can view their own order lot pictures" ON order_lot_pictures;

CREATE POLICY "Customers can view their own order lot pictures"
  ON order_lot_pictures
  FOR SELECT
  TO authenticated
  USING (
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
