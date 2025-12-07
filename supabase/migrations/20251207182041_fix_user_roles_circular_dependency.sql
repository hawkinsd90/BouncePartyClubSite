/*
  # Fix circular dependency in user_roles RLS policies

  ## Problem
  The `is_admin()` function queries `user_roles` table, and the "Admins can view all roles" 
  policy uses `is_admin()`, creating an infinite recursion loop that prevents users from 
  logging in.

  ## Solution
  Replace the problematic policy with a direct inline check that doesn't cause recursion.
  This allows users to read their own roles, and admins to read all roles without 
  circular dependencies.

  ## Changes
  1. Drop the existing "Admins can view all roles" policy that uses is_admin()
  2. Create a new policy that directly checks user_roles inline without function calls
*/

-- Drop the problematic policy that causes circular dependency
DROP POLICY IF EXISTS "Admins can view all roles" ON user_roles;

-- Create a new policy that allows admins to view all roles
-- This uses a direct inline subquery instead of the is_admin() function
-- to avoid the circular dependency
CREATE POLICY "Admins and masters can view all roles"
  ON user_roles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles AS ur_check
      WHERE ur_check.user_id = auth.uid() 
      AND ur_check.role IN ('ADMIN', 'MASTER')
    )
  );
