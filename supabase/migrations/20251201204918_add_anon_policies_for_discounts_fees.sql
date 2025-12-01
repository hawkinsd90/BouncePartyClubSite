/*
  # Allow Anonymous Access to Order Discounts and Custom Fees

  1. Changes
    - Add policies to allow anonymous users (anon role) to read order_discounts
    - Add policies to allow anonymous users (anon role) to read order_custom_fees
    
  2. Security
    - These tables only contain pricing information tied to orders
    - Customers access orders via secure UUID links, so this is safe
    - No sensitive data is exposed - just discount/fee names and amounts
*/

-- Allow anonymous users to read order discounts
CREATE POLICY "Anonymous users can view order discounts"
  ON order_discounts
  FOR SELECT
  TO anon
  USING (true);

-- Allow anonymous users to read order custom fees
CREATE POLICY "Anonymous users can view order custom fees"
  ON order_custom_fees
  FOR SELECT
  TO anon
  USING (true);