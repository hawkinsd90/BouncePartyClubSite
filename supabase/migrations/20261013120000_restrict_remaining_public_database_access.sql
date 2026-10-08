/*
  # Restrict remaining public database access

  NOT APPLIED BY THIS CHANGE. Review, then apply manually (Dev first), after the core database access lockdown.

  Why
    After the payment RPC authorization, administrative exposure, portal link, public booking and core database access
    migrations, a live audit of the Dev database still found anonymous access that no active caller needs:

    1. Tables
       - public.stripe_webhook_events had an anonymous INSERT policy. Only the Stripe webhook Edge Function writes it, through
         the service role (supabase/functions/_shared/webhook-idempotency.ts). Because that function skips any event id whose
         row already says "succeeded" or "processing", an anonymous caller who could insert a row for a real event id could
         suppress that Stripe event. Anonymous and signed-in write access is removed; the service role (which bypasses RLS)
         and the Admin read policy are unchanged.
       - public.billing_addresses exists only on the live database (no tracked migration, no application code reads or writes
         it). It had anonymous and authenticated INSERT policies with `true`. Those are removed and the Admin read policy is
         kept. The block is skipped when the table does not exist, so a clean replay is unaffected.

    2. Functions. The privilege model describes both the EXECUTE grant and the authorization inside the function:
       - Trigger functions never need EXECUTE for a trigger to fire (PostgreSQL checks it only when the trigger is created), so
         PUBLIC / anon / authenticated EXECUTE is removed from every trigger function in the public schema.
       - SERVICE ROLE ONLY (called only by Edge Functions through the service role, or by nobody): PUBLIC, anon and authenticated
         EXECUTE is removed; service_role keeps it.
           check_rate_limit, record_notification_failure, record_notification_success, user_has_role, get_user_highest_role,
           assign_user_role, remove_user_role, generate_receipt_group_id
         check_rate_limit and record_notification_failure/success accept caller-chosen values and perform writes with no
         caller check, so an anonymous caller could block other callers' rate-limit keys or flood and flip the notification
         system status. user_has_role / get_user_highest_role answer for any caller-supplied user id.
         generate_receipt_group_id has no caller at all (the browser uses crypto.randomUUID()).
       - AUTHENTICATED SESSION HELPERS (get_user_role, is_admin): every signed-in session needs them (RLS policies call them).
         PUBLIC and anon EXECUTE is removed; authenticated and service_role keep it.
       - AUTHENTICATED ENTRYPOINT - INTERNAL ADMIN CHECK: granted to authenticated and service_role, but the function itself
         rejects anyone who is not Admin / Master (or staff where noted) before reading privileged data or changing anything.
         PUBLIC and anon EXECUTE is removed. Every function in this group was read and checked; two did not have a check and get
         one here (section 2): generate_invoice_number and generate_receipt_number. The sequence behind receipt numbers is no
         longer consumable by ordinary customers.
       - AUTHENTICATED ENTRYPOINT - CALLER SCOPED: get_unresolved_failures_count had no caller check. It becomes SECURITY INVOKER so
         the notification_failures Admin-only read policy decides what the caller can count (a non-admin gets zeros) instead of
         any signed-in user seeing the counts.
       - PUBLIC API (an anonymous visitor really calls them: availability checks and the public site settings / menu): PUBLIC
         EXECUTE is replaced by explicit anon, authenticated and service_role EXECUTE.

    3. Table privileges
       - TRUNCATE, TRIGGER and REFERENCES are removed from anon and authenticated on every public table, and anon INSERT /
         UPDATE / DELETE is removed on every public table that has no anon / PUBLIC write policy. Row level security already denied
         those writes, so this only removes unused privileges (TRUNCATE ignores row level security).

  Not changed here: Crew order access, Storage, default privileges for future functions, schema drift.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.stripe_webhook_events') IS NULL THEN
    RAISE NOTICE 'public.stripe_webhook_events does not exist, skipped';
  ELSE
    FOR r IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'stripe_webhook_events' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.stripe_webhook_events', r.policyname);
    END LOOP;
    REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.stripe_webhook_events FROM authenticated;
  END IF;

  IF to_regclass('public.billing_addresses') IS NULL THEN
    RAISE NOTICE 'public.billing_addresses does not exist, skipped';
  ELSE
    FOR r IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'billing_addresses' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY %I ON public.billing_addresses', r.policyname);
    END LOOP;
    REVOKE ALL ON TABLE public.billing_addresses FROM anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.billing_addresses FROM authenticated;
  END IF;
END $$;

-- Table privileges that no API caller can use. TRUNCATE, TRIGGER and REFERENCES are never needed by anon or authenticated (and
-- TRUNCATE ignores row level security). Write privileges for anon are kept only on tables that have an anon / PUBLIC write
-- policy (site_events and pending_signups_consent today); everywhere else row level security already denied them, so this
-- changes no behaviour. SELECT grants (public catalog reads) are untouched.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated', t.relname);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.relname AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        AND (p.roles && ARRAY['anon', 'public']::name[])
    ) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon', t.relname);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Number generators: add the caller check they were missing (signature, return value, format and sequence unchanged)
--    Allowed callers: Admin / Master users (the Admin screens), the service role (Edge Functions) and the database superusers
--    (the SQL editor / migrations). Everyone else is rejected before anything is read or the sequence is touched.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  new_number text;
  year_prefix text;
  next_num integer;
BEGIN
  IF NOT (
    public.is_admin()
    OR COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    OR (COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = '' AND session_user IN ('postgres', 'supabase_admin'))
  ) THEN
    RAISE EXCEPTION 'Permission denied: only admin or master users can generate invoice numbers' USING ERRCODE = '42501';
  END IF;

  year_prefix := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-';

  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '\d+$') AS integer)), 0) + 1
  INTO next_num
  FROM public.invoices
  WHERE invoice_number LIKE year_prefix || '%';

  new_number := year_prefix || LPAD(next_num::text, 4, '0');

  RETURN new_number;
END;
$$;

-- transaction_receipts.receipt_number defaults to this function. Only Admin / Master users (browser receipts) and the service role
-- (Edge Functions) ever insert receipts, so only they may consume a receipt number.
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
  receipt_num text;
BEGIN
  IF NOT (
    public.is_admin()
    OR COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    OR (COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = '' AND session_user IN ('postgres', 'supabase_admin'))
  ) THEN
    RAISE EXCEPTION 'Permission denied: only admin or master users can generate receipt numbers' USING ERRCODE = '42501';
  END IF;

  next_num := nextval('receipt_number_seq');
  receipt_num := 'RCP-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(next_num::text, 5, '0');
  RETURN receipt_num;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Function EXECUTE grants (looked up by name so signature drift between environments cannot make this fail)
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  -- Backend only: the service role (Edge Functions) or nobody.
  server_only text[] := ARRAY[
    'check_rate_limit', 'record_notification_failure', 'record_notification_success',
    'user_has_role', 'get_user_highest_role', 'assign_user_role', 'remove_user_role', 'generate_receipt_group_id'
  ];
  -- Every signed-in session needs these (RLS policies and the Admin / Crew screens call them for the caller's own identity).
  session_helpers text[] := ARRAY['get_user_role', 'is_admin'];
  -- Granted to every signed-in session, but the function itself rejects anyone who is not Admin / Master (or staff where noted)
  -- before it reads privileged data or changes anything.
  internal_admin_check text[] := ARRAY[
    'get_all_role_users', 'assign_role_by_email',
    'get_booking_source_analytics', 'get_booking_sources_analytics', 'get_delivery_timing_analytics',
    'save_inventory_product', 'save_inventory_product_v2', 'save_product_bundle', 'save_product_bundle_v2', 'save_product_category',
    'save_menu_group', 'reorder_menu_group', 'reorder_product_categories',
    'generate_invoice_number', 'generate_receipt_number', 'find_order_id_by_prefix', 'create_order_short_link'
  ];
  -- Runs as the caller, so row level security decides what the caller can see (a non-admin gets zeros).
  caller_scoped text[] := ARRAY['get_unresolved_failures_count'];
  public_api text[] := ARRAY[
    'check_date_blackout', 'check_unit_availability', 'check_product_availability',
    'get_public_business_settings', 'get_public_nav_menu_groups'
  ];
BEGIN
  -- Trigger functions: nothing calls them directly.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (server_only)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (session_helpers || internal_admin_check || caller_scoped)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (public_api)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', r.sig);
  END LOOP;

  -- The unresolved-failure count runs as the caller so the Admin-only read policy on notification_failures applies.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'get_unresolved_failures_count'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', r.sig);
  END LOOP;
END $$;
