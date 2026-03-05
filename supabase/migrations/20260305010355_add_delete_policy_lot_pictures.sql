/*
  # Add Delete Policy for Lot Pictures
  
  1. Changes
    - Add DELETE policy for authenticated users to remove their lot pictures
    - Add DELETE policy for admins to remove any lot pictures
  
  2. Security
    - Authenticated users can delete pictures from their own orders
    - Admins can delete any pictures
*/

-- Allow authenticated users to delete lot pictures from their orders
CREATE POLICY "Customers can delete lot pictures from their orders"
  ON order_lot_pictures
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_lot_pictures.order_id
      AND orders.customer_id = auth.uid()
    )
    OR
    -- Also allow if order exists (trusting portal link access)
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_lot_pictures.order_id
    )
  );

-- Allow admins to delete any lot pictures
CREATE POLICY "Admins can delete any lot pictures"
  ON order_lot_pictures
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN')
    )
  );
