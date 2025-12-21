/*
  # Fix Infinite Recursion in user_roles RLS Policies

  1. Problem
    - Current RLS policies query user_roles table within user_roles policies
    - This creates infinite recursion when Postgres tries to apply RLS
    
  2. Solution
    - Use get_user_role() SECURITY DEFINER function instead
    - This function bypasses RLS and prevents circular dependencies
    
  3. Changes
    - Drop all existing problematic policies
    - Recreate them using get_user_role() function
    - Maintains same security model without recursion
*/

-- Drop all existing policies that cause recursion
DROP POLICY IF EXISTS "Users can read own roles" ON user_roles;
DROP POLICY IF EXISTS "Admins and masters can read all roles" ON user_roles;
DROP POLICY IF EXISTS "Master can insert user roles" ON user_roles;
DROP POLICY IF EXISTS "Master can update user roles" ON user_roles;
DROP POLICY IF EXISTS "Master can delete user roles" ON user_roles;
DROP POLICY IF EXISTS "Admin can insert crew roles" ON user_roles;
DROP POLICY IF EXISTS "Admin can update crew roles" ON user_roles;
DROP POLICY IF EXISTS "Admin can delete crew roles" ON user_roles;

-- Create new policies using get_user_role() to avoid recursion

-- Read policies
CREATE POLICY "Users can read own roles"
  ON user_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins and masters can read all roles"
  ON user_roles
  FOR SELECT
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('master', 'admin'));

-- Master can manage ALL roles
CREATE POLICY "Master can insert user roles"
  ON user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role(auth.uid()) = 'master');

CREATE POLICY "Master can update user roles"
  ON user_roles
  FOR UPDATE
  TO authenticated
  USING (get_user_role(auth.uid()) = 'master')
  WITH CHECK (get_user_role(auth.uid()) = 'master');

CREATE POLICY "Master can delete user roles"
  ON user_roles
  FOR DELETE
  TO authenticated
  USING (get_user_role(auth.uid()) = 'master');

-- Admin can manage ONLY crew roles
CREATE POLICY "Admin can insert crew roles"
  ON user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    role = 'crew' AND 
    get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "Admin can update crew roles"
  ON user_roles
  FOR UPDATE
  TO authenticated
  USING (
    role = 'crew' AND 
    get_user_role(auth.uid()) = 'admin'
  )
  WITH CHECK (
    role = 'crew' AND 
    get_user_role(auth.uid()) = 'admin'
  );

CREATE POLICY "Admin can delete crew roles"
  ON user_roles
  FOR DELETE
  TO authenticated
  USING (
    role = 'crew' AND 
    get_user_role(auth.uid()) = 'admin'
  );
