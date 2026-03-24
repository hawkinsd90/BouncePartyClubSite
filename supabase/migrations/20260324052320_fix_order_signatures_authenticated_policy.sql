/*
  # Fix order_signatures authenticated SELECT policy

  ## Problem
  The "Users can view own signatures" policy checks `customer_id = auth.uid()`.
  However, customer_id in order_signatures is from the customers table (a different UUID)
  — not the auth.users UUID. So authenticated users can never see their own signature
  via this policy, causing WaiverTab to always show "Waiver Required" even when signed.

  ## Fix
  Replace the broken authenticated SELECT policy with one that matches by email,
  consistent with how the orders table's "Customers can view own orders" policy works.
  Also keep the existing anon policy so unauthenticated portal access continues to work.
*/

DROP POLICY IF EXISTS "Users can view own signatures" ON order_signatures;

CREATE POLICY "Users can view own signatures"
  ON order_signatures
  FOR SELECT
  TO authenticated
  USING (
    signer_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );
