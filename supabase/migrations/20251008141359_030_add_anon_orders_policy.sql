/*
  # Add anonymous access to orders table for payment polling

  1. Changes
    - Add policy allowing anonymous users to SELECT from orders table
    - This is needed for the checkout page to poll order status while waiting for payment
    - Security: Only SELECT access, no INSERT/UPDATE/DELETE for anonymous users
  
  2. Security
    - Anonymous users can only read orders, not modify them
    - This allows the payment polling to work without authentication
*/

CREATE POLICY "Anonymous users can read orders"
  ON orders
  FOR SELECT
  TO anon
  USING (true);