/*
  # Properly fix user_roles RLS policies

  ## Problem
  Any policy that queries user_roles while evaluating user_roles access creates 
  infinite recursion.

  ## Solution
  Keep only the simple "Users can read own role" policy for SELECT operations.
  Remove the admin policy that causes recursion. Admins can still read their own 
  roles which is sufficient for authentication.

  ## Changes
  1. Drop the newly created policy that still has recursion
  2. Keep only the simple user_id check policy
  3. Remove duplicate "Users can view own roles" policy
*/

-- Drop the policy that still causes recursion
DROP POLICY IF EXISTS "Admins and masters can view all roles" ON user_roles;

-- Drop duplicate policy
DROP POLICY IF EXISTS "Users can view own roles" ON user_roles;

-- The "Users can read own role" policy should be sufficient
-- It allows: SELECT WHERE auth.uid() = user_id
-- This is simple and has no circular dependencies
