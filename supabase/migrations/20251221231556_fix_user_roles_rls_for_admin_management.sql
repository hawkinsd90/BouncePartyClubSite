/*
  # Fix User Roles RLS for Admin Management

  1. Changes
    - Add policies to allow master users to manage all user roles
    - Add policies to allow admin users to manage crew roles
    - Ensure proper UPDATE, INSERT, and DELETE permissions

  2. Security
    - Master role: Can manage all roles (create, update, delete)
    - Admin role: Can only manage crew roles
    - Regular users: Can only read their own role
*/

-- Drop existing restrictive policies if any
DROP POLICY IF EXISTS "Master can manage all user roles" ON user_roles;
DROP POLICY IF EXISTS "Admin can manage crew roles" ON user_roles;
DROP POLICY IF EXISTS "Master can insert user roles" ON user_roles;
DROP POLICY IF EXISTS "Admin can insert crew roles" ON user_roles;
DROP POLICY IF EXISTS "Master can update user roles" ON user_roles;
DROP POLICY IF EXISTS "Admin can update crew roles" ON user_roles;
DROP POLICY IF EXISTS "Master can delete user roles" ON user_roles;
DROP POLICY IF EXISTS "Admin can delete crew roles" ON user_roles;

-- SELECT: Users can read all roles to see who has access (needed for admin UI)
DROP POLICY IF EXISTS "Admins and masters can read all roles" ON user_roles;
CREATE POLICY "Admins and masters can read all roles"
  ON user_roles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('master', 'admin')
    )
  );

-- INSERT: Allow masters to create any role, admins to create crew only
CREATE POLICY "Master can insert user roles"
  ON user_roles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'master'
    )
  );

CREATE POLICY "Admin can insert crew roles"
  ON user_roles FOR INSERT
  TO authenticated
  WITH CHECK (
    role = 'crew'
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'admin'
    )
  );

-- UPDATE: Allow masters to update any role, admins to update crew only
CREATE POLICY "Master can update user roles"
  ON user_roles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'master'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'master'
    )
  );

CREATE POLICY "Admin can update crew roles"
  ON user_roles FOR UPDATE
  TO authenticated
  USING (
    role = 'crew'
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'admin'
    )
  )
  WITH CHECK (
    role = 'crew'
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'admin'
    )
  );

-- DELETE: Allow masters to delete any role, admins to delete crew only
CREATE POLICY "Master can delete user roles"
  ON user_roles FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'master'
    )
  );

CREATE POLICY "Admin can delete crew roles"
  ON user_roles FOR DELETE
  TO authenticated
  USING (
    role = 'crew'
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role = 'admin'
    )
  );