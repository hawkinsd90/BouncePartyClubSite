/*
  # Fix get_all_role_users to only return staff roles

  The function was returning all user_roles rows including "customer" role,
  which displayed as "No Role" in the UI since it's not a recognized staff role.
  Now filtered to only return master, admin, and crew roles.
*/

CREATE OR REPLACE FUNCTION public.get_all_role_users()
RETURNS TABLE(user_id uuid, email text, user_role text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur2
    WHERE ur2.user_id = auth.uid()
    AND LOWER(ur2.role) IN ('admin', 'master')
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
  WHERE LOWER(ur.role) IN ('master', 'admin', 'crew')
  ORDER BY ur.created_at DESC;
END;
$function$;
