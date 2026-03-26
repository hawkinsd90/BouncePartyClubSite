/*
  # Fix get_all_role_users ambiguous column reference

  Drop and recreate the function with explicit table-qualified column references
  to resolve the "column reference role is ambiguous" 42702 error. The return
  table column "id" is renamed to "user_id" and "role" to "user_role" to
  prevent shadowing conflicts with the query body.
*/

DROP FUNCTION IF EXISTS public.get_all_role_users();

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
  ORDER BY ur.created_at DESC;
END;
$function$;
