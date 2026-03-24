/*
  # Fix order_pictures SELECT policies

  ## Problem
  The existing "Customers can view own order pictures" policy uses:
    SELECT email FROM auth.users WHERE id = auth.uid()
  which the authenticated role cannot query, causing 403 Forbidden.

  Also, the customer portal is accessed without authentication (anon role),
  so there is no anon SELECT policy at all.

  ## Changes
  1. Drop the broken authenticated SELECT policy for customers
  2. Add a fixed authenticated SELECT policy using auth.email() helper
  3. Add an anon SELECT policy so unauthenticated customer portal visitors can view pictures for their order
*/

-- Drop the broken policy
DROP POLICY IF EXISTS "Customers can view own order pictures" ON order_pictures;

-- Re-create with auth.email() which works for authenticated role
CREATE POLICY "Customers can view own order pictures"
  ON order_pictures
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      JOIN contacts c ON o.customer_id = c.customer_id
      WHERE o.id = order_pictures.order_id
        AND c.email = auth.email()
    )
  );

-- Add anon SELECT policy (customer portal uses anon key, order_id is in the URL)
CREATE POLICY "Anon can view order pictures by order id"
  ON order_pictures
  FOR SELECT
  TO anon
  USING (true);
