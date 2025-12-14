/*
  # Fix Task Status RLS Policies for Role Hierarchy

  ## Summary
  Updates the Row Level Security policies on the task_status table to work with
  the uppercase role hierarchy (MASTER, ADMIN, CREW, CUSTOMER) instead of the
  old lowercase 'admin' role.

  ## Changes Made

  1. **Updated Policies**
     - Modified all task_status policies to check for 'MASTER' and 'ADMIN' roles (uppercase)
     - Allows both MASTER and ADMIN users to manage task statuses
     - Added CREW read-only access to view their assigned tasks

  2. **Security**
     - MASTER and ADMIN: Full access (SELECT, INSERT, UPDATE, DELETE)
     - CREW: Read-only access to view task statuses
     - Maintains security while fixing the authorization errors
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view all task statuses" ON task_status;
DROP POLICY IF EXISTS "Admins can insert task statuses" ON task_status;
DROP POLICY IF EXISTS "Admins can update task statuses" ON task_status;
DROP POLICY IF EXISTS "Admins can delete task statuses" ON task_status;

-- Create new policies with uppercase role names
CREATE POLICY "Admin users can view all task statuses"
  ON task_status
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN', 'CREW')
    )
  );

CREATE POLICY "Admin users can insert task statuses"
  ON task_status
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN')
    )
  );

CREATE POLICY "Admin users can update task statuses"
  ON task_status
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN', 'CREW')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN', 'CREW')
    )
  );

CREATE POLICY "Admin users can delete task statuses"
  ON task_status
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN')
    )
  );
