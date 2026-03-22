/*
  # Fix crew_location_history INSERT policy for authenticated users

  ## Problem
  The INSERT policy on crew_location_history only allows `anon` role.
  When an authenticated MASTER/ADMIN marks a task as En Route, the insert
  fails with 400 because the authenticated role has no INSERT policy.

  ## Fix
  Add an INSERT policy for authenticated MASTER/ADMIN/CREW users.
*/

CREATE POLICY "Authenticated crew and admins can log location"
  ON crew_location_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN', 'CREW')
    )
  );
