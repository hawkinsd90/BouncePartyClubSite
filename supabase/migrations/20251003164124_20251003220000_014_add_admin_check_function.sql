/*
  # Add function to check for admin users

  1. New Functions
    - `get_admin_users()` - Returns count of users with ADMIN role
    - Used by setup page to determine if initial setup is needed

  2. Security
    - Function is accessible to anonymous users (needed for setup page)
    - Only returns count, not sensitive user data
*/

CREATE OR REPLACE FUNCTION get_admin_users()
RETURNS TABLE (count bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT COUNT(*)::bigint
  FROM user_roles
  WHERE role = 'ADMIN';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
