/*
  # Fix Infinite Recursion in Admin Check

  1. Changes
    - Drop and recreate all policies that use is_admin()
    - Recreate is_admin() function to use SQL instead of PL/pgSQL
    - Use direct EXISTS checks in policies to avoid recursion
  
  2. Security
    - Maintains admin-only access control
    - Prevents infinite recursion in policy checks
*/

DROP POLICY IF EXISTS "Users can read own role" ON user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON user_roles;
DROP POLICY IF EXISTS "Admin users can read settings" ON admin_settings;
DROP POLICY IF EXISTS "Admin users can insert settings" ON admin_settings;
DROP POLICY IF EXISTS "Admin users can update settings" ON admin_settings;

DROP FUNCTION IF EXISTS is_admin() CASCADE;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'ADMIN'
  );
$$;

CREATE POLICY "Users can read own role"
  ON user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can insert roles"
  ON user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update roles"
  ON user_roles
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete roles"
  ON user_roles
  FOR DELETE
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admin users can read settings"
  ON admin_settings
  FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admin users can insert settings"
  ON admin_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admin users can update settings"
  ON admin_settings
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());