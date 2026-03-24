/*
  # Fix order_signatures SELECT policy for authenticated users

  ## Problem
  The previous fix used `SELECT email FROM auth.users WHERE id = auth.uid()`
  but regular `authenticated` users don't have SELECT permission on `auth.users`.
  This causes a 403 "permission denied for table users" error.

  ## Fix
  Use the built-in `auth.email()` helper which is a SECURITY DEFINER function
  that returns the current user's email without requiring direct access to auth.users.
*/

DROP POLICY IF EXISTS "Users can view own signatures" ON order_signatures;

CREATE POLICY "Users can view own signatures"
  ON order_signatures
  FOR SELECT
  TO authenticated
  USING (
    signer_email = (SELECT auth.email())
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );
