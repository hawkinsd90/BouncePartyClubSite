/*
  # Add assign_role_by_email RPC and get_all_role_users RPC

  ## Problem 1: assign_user_role takes a UUID, not an email
  PermissionsTab needs to look up a user by email and assign a role.
  The existing assign_user_role(target_user_id uuid, target_role text) requires
  knowing the UUID in advance, which the admin UI cannot easily obtain.

  ## Fix
  Add assign_role_by_email(target_email text, new_role text) RETURNS boolean
  that looks up auth.users by email, then calls the same insert logic.
  Returns true if found and assigned, false if no user with that email exists.

  ## Problem 2: get_admin_users only returns admin/master users
  crew users have a row in user_roles but are not returned by get_admin_users,
  so their email cannot be resolved — they show raw UUIDs in PermissionsTab.

  ## Fix
  Add get_all_role_users() that returns id, email for ALL users in user_roles,
  regardless of role. This is SECURITY DEFINER so it can join auth.users.
*/

CREATE OR REPLACE FUNCTION public.assign_role_by_email(
  p_email text,
  p_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_target_id uuid;
BEGIN
  SELECT LOWER(role) INTO v_caller_role
  FROM user_roles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'master') THEN
    RAISE EXCEPTION 'Only admin or master users can assign roles';
  END IF;

  IF p_role = 'master' AND v_caller_role != 'master' THEN
    RAISE EXCEPTION 'Only master users can assign the master role';
  END IF;

  IF p_role = 'admin' AND v_caller_role != 'master' THEN
    RAISE EXCEPTION 'Only master users can assign the admin role';
  END IF;

  SELECT id INTO v_target_id
  FROM auth.users
  WHERE LOWER(email) = LOWER(p_email)
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO user_roles (user_id, role)
  VALUES (v_target_id, p_role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_role_by_email(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_role_by_email(text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_all_role_users()
RETURNS TABLE(id uuid, email text, role text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND LOWER(role) IN ('admin', 'master')
  ) THEN
    RAISE EXCEPTION 'Only admin or master users can list role users';
  END IF;

  RETURN QUERY
  SELECT
    ur.user_id,
    au.email::text,
    ur.role::text,
    ur.created_at
  FROM public.user_roles ur
  JOIN auth.users au ON au.id = ur.user_id
  ORDER BY ur.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_all_role_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_role_users() TO authenticated;
