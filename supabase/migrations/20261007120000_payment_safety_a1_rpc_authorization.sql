/*
  # Payment Safety A1 — RPC authorization hardening

  Scope: function-level authorization only. This migration does NOT change table RLS policies or table grants
  (that is Safety A2): the open "Service role full access to ..." policies and anon table privileges are untouched.

  ## Why
  Internal money RPCs are SECURITY DEFINER and were executable by PUBLIC / anon / authenticated with no caller
  check inside the body. Anyone holding the public anon key could call them directly through PostgREST
  (/rest/v1/rpc/...), bypassing the Edge Functions that are supposed to be their only callers.

  ## Changes
  1. is_admin() recognises lowercase role values. Live roles are lowercase (master, customer, crew) while the
     function compared uppercase 'ADMIN'/'MASTER', so it returned false for every real admin. Dependents (verified
     in Dev and Production): payments policies "Admins can insert/update/view ... payments" and archive_old_orders().
     Crew and customer are NOT admin. Signature, SECURITY DEFINER and search_path are unchanged.
  2. Internal payment RPCs become service-role only (EXECUTE revoked from PUBLIC, anon, authenticated):
       record_cash_payment, record_check_payment           (callers: record-cash-payment / record-check-payment
                                                            Edge Functions, service-role client)
       apply_balance_payment_financials                    (callers: customer-balance-payment,
                                                            reconcile-balance-payment, stripe-webhook; service role)
       claim_balance_payment_financials                    (deprecated no-op stub; no callers)
       increment_order_refunded_cents                      (caller: stripe-refund, which now calls it with a
                                                            plain service-role client)
  3. update_pricing_rules (exists in Production only): no browser or function caller exists (admins edit pricing
     through the table). Service-role only. Guarded so the migration is a no-op where the function does not exist.
  4. find_order_id_by_prefix: its only caller is the admin UI (authenticated). It now returns NULL unless the
     caller is an admin/master, and EXECUTE is revoked from PUBLIC and anon.
  5. get_signature_status / order_has_valid_signature: no callers in the app, Edge Functions, policies or other
     functions. They returned signer name/email for any order UUID. Service-role only.

  ## Not changed (intentionally)
  - approve_order_changes: customer-scoped by invoice token; stays executable by anon/authenticated.
  - get_admin_users: its only browser caller is the anonymous /setup bootstrap page; deferred to Safety A2.
  - Table RLS and table grants: Safety A2.
*/

-- 1. is_admin(): lowercase-safe -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = auth.uid()
      AND lower(role) IN ('admin', 'master')
    LIMIT 1
  );
$$;

-- 2. Internal payment RPCs: service role only ------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.record_cash_payment(uuid, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_payment(uuid, integer, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_check_payment(uuid, integer, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_check_payment(uuid, integer, integer, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.apply_balance_payment_financials(text, uuid, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_balance_payment_financials(text, uuid, integer, integer, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.claim_balance_payment_financials(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_balance_payment_financials(text) TO service_role;

REVOKE ALL ON FUNCTION public.increment_order_refunded_cents(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_order_refunded_cents(uuid, integer) TO service_role;

-- 3. update_pricing_rules: service role only (function exists in Production only) --------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_pricing_rules(uuid,integer,integer,integer,integer,text[],integer,integer,integer,integer,boolean) TO service_role';
  END IF;
END
$$;

-- 4. find_order_id_by_prefix: admin/master only ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_order_id_by_prefix(p_prefix text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.id
  FROM orders o
  WHERE public.is_admin()
    AND o.id::text ILIKE (lower(p_prefix) || '%')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_order_id_by_prefix(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_order_id_by_prefix(text) TO authenticated, service_role;

-- 5. Signature helpers: service role only ------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_signature_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_signature_status(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.order_has_valid_signature(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_has_valid_signature(uuid) TO service_role;
