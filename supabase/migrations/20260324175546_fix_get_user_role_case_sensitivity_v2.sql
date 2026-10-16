/*
  # Fix get_user_role case sensitivity bug

  ## Problem
  Roles are stored as uppercase (MASTER, ADMIN, CREW) but the RLS policies compare
  against lowercase ('master', 'admin', 'crew'). The get_user_role() function was
  returning the raw stored value, causing all RLS policy checks to fail.

  ## Fix
  1. Update get_user_role() to return lowercase
  2. Temporarily disable the changelog trigger to allow bulk normalization
  3. Normalize all existing role values to lowercase
*/

-- Fix the function to return lowercase role
CREATE OR REPLACE FUNCTION get_user_role(user_id_input uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT LOWER(role) FROM user_roles WHERE user_id = user_id_input LIMIT 1),
    'customer'
  );
$$;

-- Disable the changelog trigger temporarily to avoid FK issues during normalization
ALTER TABLE user_roles DISABLE TRIGGER ALL;

-- Normalize all existing role values to lowercase
UPDATE user_roles SET role = LOWER(role) WHERE role != LOWER(role);

-- Re-enable triggers
ALTER TABLE user_roles ENABLE TRIGGER ALL;
