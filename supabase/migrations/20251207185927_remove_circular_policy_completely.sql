/*
  # Remove Circular RLS Policy

  The "Master and admin can manage all roles" policy still creates a circular
  dependency because it queries user_roles to check if the user is an admin.
  
  Solution: Remove it entirely. Admin operations should use SECURITY DEFINER 
  functions instead of relying on RLS.
*/

-- Drop the circular policy
DROP POLICY IF EXISTS "Master and admin can manage all roles" ON user_roles;

-- Keep only the simple read policy that doesn't create loops
-- (Already exists: "Users can read own roles")

-- Grant usage on the schema
GRANT USAGE ON SCHEMA public TO authenticated, anon;
