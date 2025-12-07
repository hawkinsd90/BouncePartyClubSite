/*
  # Add get_user_role RPC function

  1. New Functions
    - `get_user_role` - Returns the user's role from user_roles table
    
  2. Purpose
    - Provides a simple RPC endpoint to fetch user role without hanging
    - Bypasses potential query issues with direct table access
*/

CREATE OR REPLACE FUNCTION get_user_role(user_id_input uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM user_roles
  WHERE user_id = user_id_input
  LIMIT 1;
  
  RETURN COALESCE(user_role, 'CUSTOMER');
END;
$$;
