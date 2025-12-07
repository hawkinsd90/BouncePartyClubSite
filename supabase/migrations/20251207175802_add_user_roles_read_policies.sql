/*
  # Add Read Policies for User Roles

  ## Overview
  Adds RLS policies to allow authenticated users to read their own roles.
  This is required for the frontend to check user permissions.

  ## Changes
  - Adds SELECT policy for users to read their own roles
  - Adds SELECT policy for admins to read all roles

  ## Security
  - Users can only see their own roles
  - ADMIN and MASTER can see all user roles
  - No one can modify roles except via service role
*/

-- Allow users to view their own roles
CREATE POLICY "Users can view own roles"
  ON user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow admins to view all roles
CREATE POLICY "Admins can view all roles"
  ON user_roles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('ADMIN', 'MASTER')
    )
  );
