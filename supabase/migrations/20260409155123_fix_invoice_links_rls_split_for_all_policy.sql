/*
  # Fix invoice_links RLS: split FOR ALL admin policy into separate policies

  ## Problem
  The "Admins can manage invoice links" policy uses FOR ALL with both USING and WITH CHECK.
  In PostgreSQL RLS, FOR ALL policies apply the USING clause as a row filter on SELECT/UPDATE/DELETE
  AND as an additional check on INSERT (alongside WITH CHECK). This causes INSERT to fail
  when the USING clause can't find a matching row (because the row doesn't exist yet).

  ## Fix
  Drop the FOR ALL policy and replace it with separate SELECT, INSERT, UPDATE, DELETE policies
  for admins. INSERT only needs WITH CHECK. SELECT/UPDATE/DELETE need USING.
*/

DROP POLICY IF EXISTS "Admins can manage invoice links" ON invoice_links;

CREATE POLICY "Admins can select invoice links"
  ON invoice_links
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can insert invoice links"
  ON invoice_links
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can update invoice links"
  ON invoice_links
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role IN ('admin', 'master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can delete invoice links"
  ON invoice_links
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role IN ('admin', 'master')
    )
  );
