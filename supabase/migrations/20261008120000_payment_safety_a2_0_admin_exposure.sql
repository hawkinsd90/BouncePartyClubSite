/*
  # Payment Safety A2.0 — immediate role / administrative RPC exposure hotfixes

  Scope: small, independent fixes. This migration does NOT touch customer booking, the customer portal, invoice
  links, orders RLS, or any A1 object, and it does not depend on the A1 migration being applied first. It is safe
  to apply to BOTH Dev and Production (it was written against a read-only comparison of the two).

  ## 1. user_roles: remove the public "service role" policy and anonymous table access
  Dev carries `"Service role full access to user_roles" FOR ALL TO public USING (true) WITH CHECK (true)` (created by
  the original core schema; Production already lacks it). With it, anyone holding the public anon key could read,
  insert, update or delete role rows, i.e. grant themselves master. The policy is dropped idempotently, and the
  anon role loses all table privileges (no anonymous code path reads or writes user_roles).
  The restrictive policies already present in both environments are intentionally NOT recreated or changed:
    - own-row SELECT for authenticated users,
    - admin/master can read all roles,
    - master can insert/update/delete any role,
    - admin can insert/update/delete only role = 'crew' rows.
  service_role bypasses RLS and keeps its grants. Customers and crew have no INSERT/UPDATE/DELETE policy.

  ## 2. Administrative SECURITY DEFINER functions (before: executable by PUBLIC/anon in both environments)
    get_admin_users()            -> service_role only. Callers: the /setup page (removed in this batch) and the
                                    create-admin-user Edge Function (service role). No staff UI calls it.
    check_expiring_cards()       -> service_role only. No caller anywhere (it returns customer emails).
    get_user_creation_logs(text) -> service_role only. No caller anywhere.
    cleanup_old_rate_limits()    -> service_role only. No caller anywhere (it deletes rate-limit rows).
    get_admin_analytics(ts, ts)  -> admin/master (checked inside the function, lowercase-safe) and service_role.
                                    The only caller is the admin analytics screen. The existing body is preserved
                                    byte for byte by renaming it to get_admin_analytics_impl (service_role only) and
                                    putting an authorization wrapper under the old name and signature. Dev and
                                    Production bodies differ today, so the body is not re-stated here.
  EXECUTE is revoked from PUBLIC, anon and authenticated (not just anon), then granted to exactly the intended
  roles. search_path is pinned to "public, pg_temp" where the function relied on public (get_admin_users and
  get_user_creation_logs already use an empty search_path).

  ## Not changed
  Customer/booking/portal paths, orders and invoice_links RLS, the A1 objects, get_all_role_users and
  assign_role_by_email (they already check the caller), and the other analytics RPCs (deferred).
*/

-- 1. user_roles ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access to user_roles" ON public.user_roles;

REVOKE ALL ON TABLE public.user_roles FROM anon;

-- 2a. get_admin_users: service role only -------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_admin_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO service_role;

-- 2b. check_expiring_cards: service role only --------------------------------------------------------------
ALTER FUNCTION public.check_expiring_cards() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.check_expiring_cards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_expiring_cards() TO service_role;

-- 2c. get_user_creation_logs: service role only ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_user_creation_logs(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_creation_logs(text) TO service_role;

-- 2d. cleanup_old_rate_limits: service role only -----------------------------------------------------------
ALTER FUNCTION public.cleanup_old_rate_limits() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.cleanup_old_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_rate_limits() TO service_role;

-- 2e. get_admin_analytics: admin/master (checked inside) and service role ----------------------------------
-- Keep the existing body untouched by renaming it; only do so once (idempotent).
DO $$
BEGIN
  IF to_regprocedure('public.get_admin_analytics_impl(timestamptz,timestamptz)') IS NULL
     AND to_regprocedure('public.get_admin_analytics(timestamptz,timestamptz)') IS NOT NULL THEN
    ALTER FUNCTION public.get_admin_analytics(timestamptz, timestamptz) RENAME TO get_admin_analytics_impl;
  END IF;
END
$$;

ALTER FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_impl(timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_analytics(
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND lower(ur.role) IN ('admin', 'master')
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN public.get_admin_analytics_impl(p_start, p_end);
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_analytics(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics(timestamptz, timestamptz) TO authenticated, service_role;
