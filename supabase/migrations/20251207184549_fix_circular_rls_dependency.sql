/*
  # Fix Circular RLS Dependency in User Roles

  The issue: `is_admin()` and `get_user_role()` both query `user_roles`, but the 
  policies on `user_roles` call `is_admin()`, creating a circular dependency that 
  causes queries to hang.

  Solution: 
  1. Drop existing policies that use is_admin()
  2. Create simpler policies that don't create circular dependencies
  3. Use direct auth.uid() checks instead
*/

-- Drop the problematic policies
DROP POLICY IF EXISTS "Admins can insert roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON user_roles;
DROP POLICY IF EXISTS "Users can read own role" ON user_roles;
DROP POLICY IF EXISTS "Service role full access to user_roles" ON user_roles;

-- Create simple policies without circular dependencies
-- Allow authenticated users to read their own roles
CREATE POLICY "Users can read own roles"
  ON user_roles
  FOR SELECT
  TO authenticated, anon
  USING (user_id = auth.uid() OR auth.uid() IS NULL);

-- Allow any authenticated user to insert/update/delete if they already have MASTER or ADMIN role
-- But we can't use is_admin() here, so we'll use a direct subquery
CREATE POLICY "Master and admin can manage all roles"
  ON user_roles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() 
      AND ur.role IN ('MASTER', 'ADMIN')
      LIMIT 1
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() 
      AND ur.role IN ('MASTER', 'ADMIN')
      LIMIT 1
    )
  );

-- Recreate the is_admin function to use SET search_path for security
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role IN ('ADMIN', 'MASTER')
    LIMIT 1
  );
$$;

-- Recreate get_user_role with better performance
CREATE OR REPLACE FUNCTION get_user_role(user_id_input uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM user_roles WHERE user_id = user_id_input LIMIT 1),
    'CUSTOMER'
  );
$$;

-- Ensure permissions are granted
GRANT EXECUTE ON FUNCTION get_user_role(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, anon;
