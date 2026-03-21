/*
  # Add Customer Read Policy for Task Status (Delivery Photos)

  ## Summary
  Adds a SELECT policy on the task_status table that allows authenticated customers
  to read task_status rows for their own orders. This is required for the customer
  portal's new Delivery tab, which displays proof-of-delivery photos stored in
  the delivery_images JSONB column.

  ## Changes Made

  1. **New Policy on task_status**
     - `Customers can view task status for their own orders`
     - FOR SELECT only
     - TO authenticated
     - Checks that the task_status.order_id belongs to an order whose customer_id
       matches the calling user's customer record (linked via customers.user_id)

  2. **Security**
     - Only authenticated users can use this policy
     - Customers can only see rows for their own orders, verified by joining through
       the orders and customers tables using auth.uid()
     - Admin/CREW policies are unchanged
*/

CREATE POLICY "Customers can view task status for their own orders"
  ON task_status
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM orders
      JOIN customers ON customers.id = orders.customer_id
      WHERE orders.id = task_status.order_id
        AND customers.user_id = auth.uid()
    )
  );
