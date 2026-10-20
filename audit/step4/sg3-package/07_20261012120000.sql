-- BPC-DEV-EXECUTOR step 7/28; version 20261012120000; file 20261012120000_core_database_access_lockdown.sql; sha256_lf d00654ed27a25d004578859916077161c6447f9dee6440112a8fba6b0ea830dc; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261012120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261012120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261011120000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261012120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 6 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
  SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(version, E'\n' ORDER BY version), ''), 'UTF8')), 'hex') INTO v_n, v_h FROM supabase_migrations.schema_migrations WHERE version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]);
  IF v_n <> 305 OR v_h <> '76025b5b681008ec5b0239c57be1f54fd7bbed3a3f70fa1384698afcc6476c59' THEN RAISE EXCEPTION 'BPC-EXECUTOR: ledger outside the package differs from the approved export (% rows, hash %)', v_n, v_h; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: schema containment is not in force'; END IF;

  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (SELECT k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rel', n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relpersistence::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public') AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'col', c.relname||'.'||a.attname||'|'||format_type(a.atttypid, a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin, d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||
  coalesce((SELECT string_agg(x.privilege_type||':'||CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY x.privilege_type, CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) FROM aclexplode(a.attacl) x), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con', conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
UNION ALL
SELECT 'idx', schemaname||'.'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
UNION ALL
SELECT 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_policies WHERE schemaname IN ('public','storage')
UNION ALL
SELECT 'nsp', nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a), '')
FROM pg_namespace WHERE nspname IN ('public','storage')
UNION ALL
SELECT 'dacl', pg_get_userbyid(defaclrole)||'|'||coalesce(defaclnamespace::regnamespace::text,'global')||'|'||defaclobjtype::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(defaclacl) a), '') FROM pg_default_acl WHERE defaclnamespace = 0 OR defaclnamespace = 'public'::regnamespace
UNION ALL
SELECT 'bkt', id||'|'||public||'|'||coalesce(file_size_limit::text,'null')||'|'||coalesce(allowed_mime_types::text,'null') FROM storage.buckets
UNION ALL
SELECT 'pub', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables
UNION ALL
SELECT 'ext', extname||'|'||extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'supabase_vault'
) f GROUP BY k ORDER BY k) z;
  PERFORM set_config('search_path', old_sp, true);

  IF fp_all IS DISTINCT FROM '939547e453fec0779f3a619b9567ff13' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261012120000 (expected 939547e453fec0779f3a619b9567ff13, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261012120000_core_database_access_lockdown.sql
/*
  # Core database access lockdown

  NOT APPLIED BY THIS CHANGE. Review, then apply manually (Dev first).

  Why
    The original core schema created `"Service role full access to <table>" FOR ALL USING (true) WITH CHECK (true)`
    policies WITHOUT a `TO service_role` clause. A policy with no TO clause applies to PUBLIC, i.e. to `anon`. The service
    role bypasses RLS and never needed them; their only effect was to give every holder of the public anon key full
    read/write access to customers, addresses, orders, order_items, payments, documents, messages, route_stops,
    pricing_rules, units and unit_media. Admin, Crew and signed-in customers were working through those same open
    policies. Other tables carry anon INSERT/SELECT policies and `authenticated USING (true)` policies that predate the
    server-owned boundaries that now exist: secure portal links, the Customer Portal API and secure public booking.

  What this migration does (policy / privilege / function-grant changes ONLY — no data is read, written or backfilled)
    1. Adds the helper functions is_crew_or_admin() and current_customer_ids(), and two identity-bound read functions for
       the signed-in customer: get_my_orders() (the "My Orders" dashboard) and get_my_last_order_address().
    2. Resets the policy set of the private tables listed below (drops every existing policy, whatever its name, then
       creates the explicit set) so the end state is deterministic even if a database drifted from the migration history.
    3. Creates narrow replacement policies (actor model: anon -> nothing private; signed-in customer -> NO direct access
       to orders, order items, discounts, fees, payments or units, only their own customers row, their own addresses and
       the two read functions above; crew -> the operational rows the Crew screens use; admin/master -> existing staff
       access; service_role bypasses RLS).
    4. Revokes anon table privileges on every private table (defence in depth under RLS) and TRUNCATE/TRIGGER/REFERENCES
       from anon and authenticated (RLS does not govern TRUNCATE).
    5. Restricts EXECUTE on legacy SECURITY DEFINER RPCs that touch orders / links: service-role only for the token-based
       order RPCs that nothing in the app calls any more; signed-in only for the admin-style RPCs.

  Intentionally NOT changed
    - FORCE ROW LEVEL SECURITY (service_role and the SECURITY DEFINER owner must keep bypassing RLS).
    - Public catalog tables (products, bundles, categories, pricing for products, hero images, reviews, menu groups).
    - Storage bucket policies, auth schema, user_roles (already restricted earlier), the booking proof table (already locked).
    - create_booking_request and every previously service-role-only function stay service-role-only.
    - No table or column is dropped; no money or business value is touched.

  Retained anonymous access (each is deliberate)
    - SELECT on units (active ones), unit_media, pricing_rules: the public quote and catalog read them.
    - INSERT on site_events (anonymous analytics) is untouched by this migration.
    - EXECUTE on check_date_blackout / check_product_availability / get_public_* (public availability and settings).
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------------------------------------------------

-- Crew, admin or master (case-insensitive, like the existing is_admin()).
CREATE OR REPLACE FUNCTION public.is_crew_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) IN ('admin', 'master', 'crew')
  );
$$;

-- The customers.id values that belong to the signed-in user. Ownership is the authenticated identity, never an email,
-- phone or name match, and never a caller-supplied id. Two identity-bound relationships count:
--   1. customers.user_id = auth.uid()                                  (accounts created by the current sign-up trigger)
--   2. customer_profiles.user_id = auth.uid()
--        -> customer_profiles.contact_id -> contacts.customer_id        (historical accounts whose customers.user_id was
--                                                                         never populated)
-- SECURITY DEFINER so it can read contacts / customer_profiles (the customer has no direct access to the CRM) and so
-- policies on other tables can use it without recursing into their own policies. It exposes only the resulting ids.
CREATE OR REPLACE FUNCTION public.current_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.user_id = auth.uid()
  UNION
  SELECT ct.customer_id
  FROM public.customer_profiles cp
  JOIN public.contacts ct ON ct.id = cp.contact_id
  WHERE cp.user_id = auth.uid()
    AND ct.customer_id IS NOT NULL;
$$;

-- The signed-in customer's own orders for the "My Orders" dashboard. Identity comes ONLY from auth.uid(); no customer,
-- contact, email or order id is accepted (p_limit only bounds the page). The result is an explicit allowlist of the
-- fields that screen shows or needs to build its receipt and "duplicate order" flows. Processor ids (Stripe customer /
-- payment method / intent / charge), payment_lock, admin_message, waiver signature data, waive reasons, notification
-- flags and every other internal column are NOT returned, and neither are link credentials or booking proofs.
-- The order's own delivery unit (orders.event_address_line2, '' = none) wins over the shared address row's line2.
CREATE OR REPLACE FUNCTION public.get_my_orders(p_limit integer DEFAULT 50)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'workflow_status', o.workflow_status,
    'event_date', o.event_date,
    'event_end_date', o.event_end_date,
    'start_window', o.start_window,
    'end_window', o.end_window,
    'event_start_time', o.event_start_time,
    'event_end_time', o.event_end_time,
    'location_type', o.location_type,
    'pickup_preference', o.pickup_preference,
    'surface', o.surface,
    'can_use_stakes', o.can_use_stakes,
    'has_pets', o.has_pets,
    'special_details', o.special_details,
    'generator_qty', o.generator_qty,
    'subtotal_cents', o.subtotal_cents,
    'travel_fee_cents', o.travel_fee_cents,
    'travel_total_miles', o.travel_total_miles,
    'travel_per_mile_cents', o.travel_per_mile_cents,
    'surface_fee_cents', o.surface_fee_cents,
    'same_day_pickup_fee_cents', o.same_day_pickup_fee_cents,
    'same_day_weekday_delivery_fee_cents', o.same_day_weekday_delivery_fee_cents,
    'generator_fee_cents', o.generator_fee_cents,
    'setup_fee_cents', o.setup_fee_cents,
    'tax_cents', o.tax_cents,
    'tip_cents', o.tip_cents,
    'travel_fee_waived', o.travel_fee_waived,
    'surface_fee_waived', o.surface_fee_waived,
    'same_day_pickup_fee_waived', o.same_day_pickup_fee_waived,
    'same_day_weekday_delivery_fee_waived', o.same_day_weekday_delivery_fee_waived,
    'generator_fee_waived', o.generator_fee_waived,
    'tax_waived', o.tax_waived,
    'deposit_due_cents', o.deposit_due_cents,
    'deposit_paid_cents', o.deposit_paid_cents,
    'balance_due_cents', o.balance_due_cents,
    'balance_paid_cents', o.balance_paid_cents,
    'custom_deposit_cents', o.custom_deposit_cents,
    'waiver_signed_at', o.waiver_signed_at,
    'signed_waiver_url', o.signed_waiver_url,
    'customers', (
      SELECT jsonb_build_object(
               'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email,
               'phone', c.phone, 'business_name', c.business_name)
      FROM public.customers c WHERE c.id = o.customer_id
    ),
    'addresses', (
      SELECT jsonb_build_object(
               'id', a.id, 'line1', a.line1,
               'line2', CASE WHEN o.event_address_line2 IS NOT NULL THEN btrim(o.event_address_line2) ELSE COALESCE(btrim(a.line2), '') END,
               'city', a.city, 'state', a.state, 'zip', a.zip, 'lat', a.lat, 'lng', a.lng)
      FROM public.addresses a WHERE a.id = o.address_id
    ),
    'order_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', oi.id, 'unit_id', oi.unit_id, 'product_id', oi.product_id, 'bundle_id', oi.bundle_id,
               'item_name', oi.item_name, 'pricing_context', oi.pricing_context, 'component_snapshot', oi.component_snapshot,
               'qty', oi.qty, 'wet_or_dry', oi.wet_or_dry, 'unit_price_cents', oi.unit_price_cents,
               'units', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
                          'id', u.id, 'name', u.name, 'active', u.active, 'types', to_jsonb(u.types), 'is_combo', u.is_combo,
                          'price_dry_cents', u.price_dry_cents, 'price_water_cents', u.price_water_cents) END))
      FROM public.order_items oi LEFT JOIN public.units u ON u.id = oi.unit_id
      WHERE oi.order_id = o.id
    ), '[]'::jsonb),
    'order_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'amount_cents', d.amount_cents, 'percentage', d.percentage))
      FROM public.order_discounts d WHERE d.order_id = o.id
    ), '[]'::jsonb),
    'order_custom_fees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'amount_cents', f.amount_cents))
      FROM public.order_custom_fees f WHERE f.order_id = o.id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'order_id', p.order_id, 'amount_cents', p.amount_cents, 'type', p.type, 'status', p.status,
               'payment_method', p.payment_method, 'payment_last4', p.payment_last4, 'payment_brand', p.payment_brand,
               'created_at', p.created_at, 'paid_at', p.paid_at))
      FROM public.payments p WHERE p.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM public.orders o
  WHERE o.customer_id IN (SELECT public.current_customer_ids())
  ORDER BY o.event_date DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

-- The event address of the signed-in customer's most recently created order, used to prefill their default address.
CREATE OR REPLACE FUNCTION public.get_my_last_order_address()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id', a.id, 'line1', a.line1,
           'line2', CASE WHEN o.event_address_line2 IS NOT NULL THEN btrim(o.event_address_line2) ELSE COALESCE(btrim(a.line2), '') END,
           'city', a.city, 'state', a.state, 'zip', a.zip)
  FROM public.orders o
  JOIN public.addresses a ON a.id = o.address_id
  WHERE o.customer_id IN (SELECT public.current_customer_ids())
  ORDER BY o.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.is_crew_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_crew_or_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_customer_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_customer_ids() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_orders(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_orders(integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_last_order_address() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_last_order_address() TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Reset every policy on the tables this migration owns, then enable RLS on each
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  r record;
  owned text[] := ARRAY[
    'customers', 'addresses', 'orders', 'order_items', 'order_discounts', 'order_custom_fees',
    'payments', 'invoice_links', 'consent_records', 'contacts', 'booking_setup_proofs',
    'order_changelog', 'order_lot_pictures', 'order_pictures', 'task_status', 'documents', 'messages', 'route_stops',
    'order_signatures', 'transaction_receipts', 'order_portal_links',
    'crew_location_history', 'notification_failures', 'notification_system_status', 'sms_message_templates',
    'pricing_rules', 'units', 'unit_media'
  ];
BEGIN
  FOREACH t IN ARRAY owned LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'core database access: table public.% does not exist, skipped', t;
      CONTINUE;
    END IF;
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Policies
-- ---------------------------------------------------------------------------------------------------------------------

-- customers -----------------------------------------------------------------------------------------------------------
CREATE POLICY "Admin and master manage customers" ON public.customers
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read customers" ON public.customers
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create customers" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Customers read their own customer record" ON public.customers
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- addresses -----------------------------------------------------------------------------------------------------------
CREATE POLICY "Admin and master manage addresses" ON public.addresses
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read addresses" ON public.addresses
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create addresses" ON public.addresses
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));
-- The canonical address upsert (ON CONFLICT DO UPDATE) used by the Crew invoice builder needs UPDATE.
CREATE POLICY "Crew update addresses" ON public.addresses
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_crew_or_admin())) WITH CHECK ((SELECT public.is_crew_or_admin()));
-- A signed-in customer reads only their own address rows (the sign-up / profile screens): rows owned by their customer id and
-- the row their customer record names as its default address (a shared canonical row can belong to another customer id).
CREATE POLICY "Customers read their own addresses" ON public.addresses
  FOR SELECT TO authenticated
  USING (
    customer_id IN (SELECT public.current_customer_ids())
    OR id IN (
      SELECT c.default_address_id FROM public.customers c
      WHERE c.user_id = (SELECT auth.uid()) AND c.default_address_id IS NOT NULL
    )
  );

-- orders --------------------------------------------------------------------------------------------------------------
CREATE POLICY "Admin and master manage orders" ON public.orders
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read orders" ON public.orders
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
-- Crew creates DRAFT invoice orders only (Crew invoice builder).
CREATE POLICY "Crew create draft orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()) AND status = 'draft');
-- Crew workflow updates (en route / arrived / completed). RLS cannot restrict columns; see the report for the residual.
CREATE POLICY "Crew update orders" ON public.orders
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_crew_or_admin())) WITH CHECK ((SELECT public.is_crew_or_admin()));
-- (No ordinary-customer policy on orders: customers read their orders only through get_my_orders().)

-- order_items / order_discounts / order_custom_fees ---------------------------------------------------------------------
CREATE POLICY "Admin and master manage order items" ON public.order_items
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read order items" ON public.order_items
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create order items" ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Admin and master manage order discounts" ON public.order_discounts
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read order discounts" ON public.order_discounts
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create order discounts" ON public.order_discounts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Admin and master manage order custom fees" ON public.order_custom_fees
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read order custom fees" ON public.order_custom_fees
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create order custom fees" ON public.order_custom_fees
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));

-- payments: staff only (same three admin policies as before). Customers see their payment history inside get_my_orders(). ----
CREATE POLICY "Admins can view all payments" ON public.payments
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins can insert payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- invoice_links: staff only. Portal / invoice tokens are validated server-side with the service role. --------------------
CREATE POLICY "Admin and master manage invoice links" ON public.invoice_links
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- consent_records: staff read only (rows are written by the booking RPC / Edge Functions as service role). --------------
CREATE POLICY "Admin and master read consent records" ON public.consent_records
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- contacts: staff only. -----------------------------------------------------------------------------------------------
CREATE POLICY "Admin and master manage contacts" ON public.contacts
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- booking_setup_proofs: no policy at all (service role only). -------------------------------------------------------------

-- order_changelog: an append-only audit trail, staff only. -----------------------------------------------------------------
CREATE POLICY "Admin and master read order changelog" ON public.order_changelog
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admin and master append order changelog" ON public.order_changelog
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

-- order_lot_pictures / order_pictures / documents / messages / route_stops -----------------------------------------------
CREATE POLICY "Admin and master manage lot pictures" ON public.order_lot_pictures
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admin and master manage order pictures" ON public.order_pictures
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read order pictures" ON public.order_pictures
  FOR SELECT TO authenticated USING ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Admin and master manage documents" ON public.documents
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admin and master manage messages" ON public.messages
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admin and master manage route stops" ON public.route_stops
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- task_status: crew works the schedule (read + update); admin manages. -----------------------------------------------------
CREATE POLICY "Admin and master manage task status" ON public.task_status
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read task status" ON public.task_status
  FOR SELECT TO authenticated USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew update task status" ON public.task_status
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_crew_or_admin())) WITH CHECK ((SELECT public.is_crew_or_admin()));

-- order_signatures / transaction_receipts / order_portal_links ----------------------------------------------------------
-- (signatures and receipts are written by Edge Functions with the service role)
CREATE POLICY "Admin and master read signatures" ON public.order_signatures
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admin and master update signatures" ON public.order_signatures
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admin and master read transaction receipts" ON public.transaction_receipts
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admin and master insert transaction receipts" ON public.transaction_receipts
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admin and master manage legacy portal links" ON public.order_portal_links
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- crew location / notification bookkeeping / SMS templates ---------------------------------------------------------------
CREATE POLICY "Crew and admin log location" ON public.crew_location_history
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Admin and master read location history" ON public.crew_location_history
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY "Admin and master read notification failures" ON public.notification_failures
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admin and master update notification failures" ON public.notification_failures
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew and admin log notification failures" ON public.notification_failures
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Admin and master read notification system status" ON public.notification_system_status
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY "Admin and master manage SMS templates" ON public.sms_message_templates
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- pricing_rules / units / unit_media: public READ stays (the public quote and catalog), every WRITE is staff only. ---------
CREATE POLICY "Public read pricing rules" ON public.pricing_rules
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin and master manage pricing rules" ON public.pricing_rules
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Public read active units" ON public.units
  FOR SELECT TO anon, authenticated USING (active = true);
CREATE POLICY "Admin and master manage units" ON public.units
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read all units" ON public.units
  FOR SELECT TO authenticated USING ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Public read unit media" ON public.unit_media
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin and master manage unit media" ON public.unit_media
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Table privileges (defence in depth under RLS)
-- ---------------------------------------------------------------------------------------------------------------------
-- Private tables: the anon role gets nothing at all.
REVOKE ALL ON TABLE
  public.customers, public.addresses, public.orders, public.order_items, public.order_discounts, public.order_custom_fees,
  public.payments, public.invoice_links, public.consent_records, public.contacts, public.booking_setup_proofs,
  public.order_changelog, public.order_lot_pictures, public.order_pictures, public.task_status, public.documents,
  public.messages, public.route_stops, public.order_signatures, public.transaction_receipts, public.order_portal_links,
  public.crew_location_history, public.notification_failures, public.notification_system_status,
  public.sms_message_templates
FROM anon;

-- Public-read tables: anon keeps SELECT only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pricing_rules, public.units, public.unit_media FROM anon;

-- RLS does not govern TRUNCATE (and TRIGGER/REFERENCES are never needed by an app role): remove them everywhere here.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE
  public.customers, public.addresses, public.orders, public.order_items, public.order_discounts, public.order_custom_fees,
  public.payments, public.invoice_links, public.consent_records, public.contacts, public.booking_setup_proofs,
  public.order_changelog, public.order_lot_pictures, public.order_pictures, public.task_status, public.documents,
  public.messages, public.route_stops, public.order_signatures, public.transaction_receipts, public.order_portal_links,
  public.crew_location_history, public.notification_failures, public.notification_system_status,
  public.sms_message_templates, public.pricing_rules, public.units, public.unit_media
FROM authenticated;

-- The proof table is service-role only: authenticated gets nothing either.
REVOKE ALL ON TABLE public.booking_setup_proofs FROM authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. RPC EXECUTE grants for order / link RPCs (looked up by name so signature drift cannot make this fail)
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  -- Token-based order RPCs and the legacy short-link RPCs: nothing in the app calls them any more (portal access is the
  -- customer-portal-data / customer-portal-action / resolve-link Edge Functions, which use the service role).
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_order_by_token', 'get_order_with_relations_by_token', 'approve_order_changes',
                        'create_portal_short_link', 'resolve_portal_short_link')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  -- Signed-in only (these are called from the Admin / checkout screens, and they act on auth.uid()).
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('archive_old_orders', 'save_lot_picture_to_address', 'get_user_order_prefill')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
;
DO $bpcpost$
DECLARE fp jsonb; fp_all text; old_sp text;
BEGIN

  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (SELECT k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rel', n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relpersistence::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public') AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'col', c.relname||'.'||a.attname||'|'||format_type(a.atttypid, a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin, d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||
  coalesce((SELECT string_agg(x.privilege_type||':'||CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY x.privilege_type, CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) FROM aclexplode(a.attacl) x), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con', conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
UNION ALL
SELECT 'idx', schemaname||'.'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
UNION ALL
SELECT 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_policies WHERE schemaname IN ('public','storage')
UNION ALL
SELECT 'nsp', nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a), '')
FROM pg_namespace WHERE nspname IN ('public','storage')
UNION ALL
SELECT 'dacl', pg_get_userbyid(defaclrole)||'|'||coalesce(defaclnamespace::regnamespace::text,'global')||'|'||defaclobjtype::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(defaclacl) a), '') FROM pg_default_acl WHERE defaclnamespace = 0 OR defaclnamespace = 'public'::regnamespace
UNION ALL
SELECT 'bkt', id||'|'||public||'|'||coalesce(file_size_limit::text,'null')||'|'||coalesce(allowed_mime_types::text,'null') FROM storage.buckets
UNION ALL
SELECT 'pub', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables
UNION ALL
SELECT 'ext', extname||'|'||extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'supabase_vault'
) f GROUP BY k ORDER BY k) z;
  PERFORM set_config('search_path', old_sp, true);

  IF fp_all IS DISTINCT FROM '45a937c7786943e768b63870aa9c86ca' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261012120000 (expected 45a937c7786943e768b63870aa9c86ca, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261012120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261012120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261012120000', 'core_database_access_lockdown', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=7/28; version=20261012120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=d00654ed27a25d004578859916077161c6447f9dee6440112a8fba6b0ea830dc', $bpcsql$/*
  # Core database access lockdown

  NOT APPLIED BY THIS CHANGE. Review, then apply manually (Dev first).

  Why
    The original core schema created `"Service role full access to <table>" FOR ALL USING (true) WITH CHECK (true)`
    policies WITHOUT a `TO service_role` clause. A policy with no TO clause applies to PUBLIC, i.e. to `anon`. The service
    role bypasses RLS and never needed them; their only effect was to give every holder of the public anon key full
    read/write access to customers, addresses, orders, order_items, payments, documents, messages, route_stops,
    pricing_rules, units and unit_media. Admin, Crew and signed-in customers were working through those same open
    policies. Other tables carry anon INSERT/SELECT policies and `authenticated USING (true)` policies that predate the
    server-owned boundaries that now exist: secure portal links, the Customer Portal API and secure public booking.

  What this migration does (policy / privilege / function-grant changes ONLY — no data is read, written or backfilled)
    1. Adds the helper functions is_crew_or_admin() and current_customer_ids(), and two identity-bound read functions for
       the signed-in customer: get_my_orders() (the "My Orders" dashboard) and get_my_last_order_address().
    2. Resets the policy set of the private tables listed below (drops every existing policy, whatever its name, then
       creates the explicit set) so the end state is deterministic even if a database drifted from the migration history.
    3. Creates narrow replacement policies (actor model: anon -> nothing private; signed-in customer -> NO direct access
       to orders, order items, discounts, fees, payments or units, only their own customers row, their own addresses and
       the two read functions above; crew -> the operational rows the Crew screens use; admin/master -> existing staff
       access; service_role bypasses RLS).
    4. Revokes anon table privileges on every private table (defence in depth under RLS) and TRUNCATE/TRIGGER/REFERENCES
       from anon and authenticated (RLS does not govern TRUNCATE).
    5. Restricts EXECUTE on legacy SECURITY DEFINER RPCs that touch orders / links: service-role only for the token-based
       order RPCs that nothing in the app calls any more; signed-in only for the admin-style RPCs.

  Intentionally NOT changed
    - FORCE ROW LEVEL SECURITY (service_role and the SECURITY DEFINER owner must keep bypassing RLS).
    - Public catalog tables (products, bundles, categories, pricing for products, hero images, reviews, menu groups).
    - Storage bucket policies, auth schema, user_roles (already restricted earlier), the booking proof table (already locked).
    - create_booking_request and every previously service-role-only function stay service-role-only.
    - No table or column is dropped; no money or business value is touched.

  Retained anonymous access (each is deliberate)
    - SELECT on units (active ones), unit_media, pricing_rules: the public quote and catalog read them.
    - INSERT on site_events (anonymous analytics) is untouched by this migration.
    - EXECUTE on check_date_blackout / check_product_availability / get_public_* (public availability and settings).
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------------------------------------------------

-- Crew, admin or master (case-insensitive, like the existing is_admin()).
CREATE OR REPLACE FUNCTION public.is_crew_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) IN ('admin', 'master', 'crew')
  );
$$;

-- The customers.id values that belong to the signed-in user. Ownership is the authenticated identity, never an email,
-- phone or name match, and never a caller-supplied id. Two identity-bound relationships count:
--   1. customers.user_id = auth.uid()                                  (accounts created by the current sign-up trigger)
--   2. customer_profiles.user_id = auth.uid()
--        -> customer_profiles.contact_id -> contacts.customer_id        (historical accounts whose customers.user_id was
--                                                                         never populated)
-- SECURITY DEFINER so it can read contacts / customer_profiles (the customer has no direct access to the CRM) and so
-- policies on other tables can use it without recursing into their own policies. It exposes only the resulting ids.
CREATE OR REPLACE FUNCTION public.current_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.user_id = auth.uid()
  UNION
  SELECT ct.customer_id
  FROM public.customer_profiles cp
  JOIN public.contacts ct ON ct.id = cp.contact_id
  WHERE cp.user_id = auth.uid()
    AND ct.customer_id IS NOT NULL;
$$;

-- The signed-in customer's own orders for the "My Orders" dashboard. Identity comes ONLY from auth.uid(); no customer,
-- contact, email or order id is accepted (p_limit only bounds the page). The result is an explicit allowlist of the
-- fields that screen shows or needs to build its receipt and "duplicate order" flows. Processor ids (Stripe customer /
-- payment method / intent / charge), payment_lock, admin_message, waiver signature data, waive reasons, notification
-- flags and every other internal column are NOT returned, and neither are link credentials or booking proofs.
-- The order's own delivery unit (orders.event_address_line2, '' = none) wins over the shared address row's line2.
CREATE OR REPLACE FUNCTION public.get_my_orders(p_limit integer DEFAULT 50)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'workflow_status', o.workflow_status,
    'event_date', o.event_date,
    'event_end_date', o.event_end_date,
    'start_window', o.start_window,
    'end_window', o.end_window,
    'event_start_time', o.event_start_time,
    'event_end_time', o.event_end_time,
    'location_type', o.location_type,
    'pickup_preference', o.pickup_preference,
    'surface', o.surface,
    'can_use_stakes', o.can_use_stakes,
    'has_pets', o.has_pets,
    'special_details', o.special_details,
    'generator_qty', o.generator_qty,
    'subtotal_cents', o.subtotal_cents,
    'travel_fee_cents', o.travel_fee_cents,
    'travel_total_miles', o.travel_total_miles,
    'travel_per_mile_cents', o.travel_per_mile_cents,
    'surface_fee_cents', o.surface_fee_cents,
    'same_day_pickup_fee_cents', o.same_day_pickup_fee_cents,
    'same_day_weekday_delivery_fee_cents', o.same_day_weekday_delivery_fee_cents,
    'generator_fee_cents', o.generator_fee_cents,
    'setup_fee_cents', o.setup_fee_cents,
    'tax_cents', o.tax_cents,
    'tip_cents', o.tip_cents,
    'travel_fee_waived', o.travel_fee_waived,
    'surface_fee_waived', o.surface_fee_waived,
    'same_day_pickup_fee_waived', o.same_day_pickup_fee_waived,
    'same_day_weekday_delivery_fee_waived', o.same_day_weekday_delivery_fee_waived,
    'generator_fee_waived', o.generator_fee_waived,
    'tax_waived', o.tax_waived,
    'deposit_due_cents', o.deposit_due_cents,
    'deposit_paid_cents', o.deposit_paid_cents,
    'balance_due_cents', o.balance_due_cents,
    'balance_paid_cents', o.balance_paid_cents,
    'custom_deposit_cents', o.custom_deposit_cents,
    'waiver_signed_at', o.waiver_signed_at,
    'signed_waiver_url', o.signed_waiver_url,
    'customers', (
      SELECT jsonb_build_object(
               'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email,
               'phone', c.phone, 'business_name', c.business_name)
      FROM public.customers c WHERE c.id = o.customer_id
    ),
    'addresses', (
      SELECT jsonb_build_object(
               'id', a.id, 'line1', a.line1,
               'line2', CASE WHEN o.event_address_line2 IS NOT NULL THEN btrim(o.event_address_line2) ELSE COALESCE(btrim(a.line2), '') END,
               'city', a.city, 'state', a.state, 'zip', a.zip, 'lat', a.lat, 'lng', a.lng)
      FROM public.addresses a WHERE a.id = o.address_id
    ),
    'order_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', oi.id, 'unit_id', oi.unit_id, 'product_id', oi.product_id, 'bundle_id', oi.bundle_id,
               'item_name', oi.item_name, 'pricing_context', oi.pricing_context, 'component_snapshot', oi.component_snapshot,
               'qty', oi.qty, 'wet_or_dry', oi.wet_or_dry, 'unit_price_cents', oi.unit_price_cents,
               'units', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
                          'id', u.id, 'name', u.name, 'active', u.active, 'types', to_jsonb(u.types), 'is_combo', u.is_combo,
                          'price_dry_cents', u.price_dry_cents, 'price_water_cents', u.price_water_cents) END))
      FROM public.order_items oi LEFT JOIN public.units u ON u.id = oi.unit_id
      WHERE oi.order_id = o.id
    ), '[]'::jsonb),
    'order_discounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'amount_cents', d.amount_cents, 'percentage', d.percentage))
      FROM public.order_discounts d WHERE d.order_id = o.id
    ), '[]'::jsonb),
    'order_custom_fees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'amount_cents', f.amount_cents))
      FROM public.order_custom_fees f WHERE f.order_id = o.id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'order_id', p.order_id, 'amount_cents', p.amount_cents, 'type', p.type, 'status', p.status,
               'payment_method', p.payment_method, 'payment_last4', p.payment_last4, 'payment_brand', p.payment_brand,
               'created_at', p.created_at, 'paid_at', p.paid_at))
      FROM public.payments p WHERE p.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM public.orders o
  WHERE o.customer_id IN (SELECT public.current_customer_ids())
  ORDER BY o.event_date DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

-- The event address of the signed-in customer's most recently created order, used to prefill their default address.
CREATE OR REPLACE FUNCTION public.get_my_last_order_address()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id', a.id, 'line1', a.line1,
           'line2', CASE WHEN o.event_address_line2 IS NOT NULL THEN btrim(o.event_address_line2) ELSE COALESCE(btrim(a.line2), '') END,
           'city', a.city, 'state', a.state, 'zip', a.zip)
  FROM public.orders o
  JOIN public.addresses a ON a.id = o.address_id
  WHERE o.customer_id IN (SELECT public.current_customer_ids())
  ORDER BY o.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.is_crew_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_crew_or_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_customer_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_customer_ids() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_orders(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_orders(integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_last_order_address() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_last_order_address() TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Reset every policy on the tables this migration owns, then enable RLS on each
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  r record;
  owned text[] := ARRAY[
    'customers', 'addresses', 'orders', 'order_items', 'order_discounts', 'order_custom_fees',
    'payments', 'invoice_links', 'consent_records', 'contacts', 'booking_setup_proofs',
    'order_changelog', 'order_lot_pictures', 'order_pictures', 'task_status', 'documents', 'messages', 'route_stops',
    'order_signatures', 'transaction_receipts', 'order_portal_links',
    'crew_location_history', 'notification_failures', 'notification_system_status', 'sms_message_templates',
    'pricing_rules', 'units', 'unit_media'
  ];
BEGIN
  FOREACH t IN ARRAY owned LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'core database access: table public.% does not exist, skipped', t;
      CONTINUE;
    END IF;
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Policies
-- ---------------------------------------------------------------------------------------------------------------------

-- customers -----------------------------------------------------------------------------------------------------------
CREATE POLICY "Admin and master manage customers" ON public.customers
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read customers" ON public.customers
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create customers" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Customers read their own customer record" ON public.customers
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- addresses -----------------------------------------------------------------------------------------------------------
CREATE POLICY "Admin and master manage addresses" ON public.addresses
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read addresses" ON public.addresses
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create addresses" ON public.addresses
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));
-- The canonical address upsert (ON CONFLICT DO UPDATE) used by the Crew invoice builder needs UPDATE.
CREATE POLICY "Crew update addresses" ON public.addresses
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_crew_or_admin())) WITH CHECK ((SELECT public.is_crew_or_admin()));
-- A signed-in customer reads only their own address rows (the sign-up / profile screens): rows owned by their customer id and
-- the row their customer record names as its default address (a shared canonical row can belong to another customer id).
CREATE POLICY "Customers read their own addresses" ON public.addresses
  FOR SELECT TO authenticated
  USING (
    customer_id IN (SELECT public.current_customer_ids())
    OR id IN (
      SELECT c.default_address_id FROM public.customers c
      WHERE c.user_id = (SELECT auth.uid()) AND c.default_address_id IS NOT NULL
    )
  );

-- orders --------------------------------------------------------------------------------------------------------------
CREATE POLICY "Admin and master manage orders" ON public.orders
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read orders" ON public.orders
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
-- Crew creates DRAFT invoice orders only (Crew invoice builder).
CREATE POLICY "Crew create draft orders" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()) AND status = 'draft');
-- Crew workflow updates (en route / arrived / completed). RLS cannot restrict columns; see the report for the residual.
CREATE POLICY "Crew update orders" ON public.orders
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_crew_or_admin())) WITH CHECK ((SELECT public.is_crew_or_admin()));
-- (No ordinary-customer policy on orders: customers read their orders only through get_my_orders().)

-- order_items / order_discounts / order_custom_fees ---------------------------------------------------------------------
CREATE POLICY "Admin and master manage order items" ON public.order_items
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read order items" ON public.order_items
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create order items" ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Admin and master manage order discounts" ON public.order_discounts
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read order discounts" ON public.order_discounts
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create order discounts" ON public.order_discounts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Admin and master manage order custom fees" ON public.order_custom_fees
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read order custom fees" ON public.order_custom_fees
  FOR SELECT TO authenticated
  USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew create order custom fees" ON public.order_custom_fees
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_crew_or_admin()));

-- payments: staff only (same three admin policies as before). Customers see their payment history inside get_my_orders(). ----
CREATE POLICY "Admins can view all payments" ON public.payments
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins can insert payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- invoice_links: staff only. Portal / invoice tokens are validated server-side with the service role. --------------------
CREATE POLICY "Admin and master manage invoice links" ON public.invoice_links
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- consent_records: staff read only (rows are written by the booking RPC / Edge Functions as service role). --------------
CREATE POLICY "Admin and master read consent records" ON public.consent_records
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- contacts: staff only. -----------------------------------------------------------------------------------------------
CREATE POLICY "Admin and master manage contacts" ON public.contacts
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- booking_setup_proofs: no policy at all (service role only). -------------------------------------------------------------

-- order_changelog: an append-only audit trail, staff only. -----------------------------------------------------------------
CREATE POLICY "Admin and master read order changelog" ON public.order_changelog
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admin and master append order changelog" ON public.order_changelog
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

-- order_lot_pictures / order_pictures / documents / messages / route_stops -----------------------------------------------
CREATE POLICY "Admin and master manage lot pictures" ON public.order_lot_pictures
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admin and master manage order pictures" ON public.order_pictures
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read order pictures" ON public.order_pictures
  FOR SELECT TO authenticated USING ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Admin and master manage documents" ON public.documents
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admin and master manage messages" ON public.messages
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admin and master manage route stops" ON public.route_stops
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- task_status: crew works the schedule (read + update); admin manages. -----------------------------------------------------
CREATE POLICY "Admin and master manage task status" ON public.task_status
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read task status" ON public.task_status
  FOR SELECT TO authenticated USING ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Crew update task status" ON public.task_status
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_crew_or_admin())) WITH CHECK ((SELECT public.is_crew_or_admin()));

-- order_signatures / transaction_receipts / order_portal_links ----------------------------------------------------------
-- (signatures and receipts are written by Edge Functions with the service role)
CREATE POLICY "Admin and master read signatures" ON public.order_signatures
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admin and master update signatures" ON public.order_signatures
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admin and master read transaction receipts" ON public.transaction_receipts
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admin and master insert transaction receipts" ON public.transaction_receipts
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admin and master manage legacy portal links" ON public.order_portal_links
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- crew location / notification bookkeeping / SMS templates ---------------------------------------------------------------
CREATE POLICY "Crew and admin log location" ON public.crew_location_history
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_crew_or_admin()));
CREATE POLICY "Admin and master read location history" ON public.crew_location_history
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY "Admin and master read notification failures" ON public.notification_failures
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admin and master update notification failures" ON public.notification_failures
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew and admin log notification failures" ON public.notification_failures
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Admin and master read notification system status" ON public.notification_system_status
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY "Admin and master manage SMS templates" ON public.sms_message_templates
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- pricing_rules / units / unit_media: public READ stays (the public quote and catalog), every WRITE is staff only. ---------
CREATE POLICY "Public read pricing rules" ON public.pricing_rules
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin and master manage pricing rules" ON public.pricing_rules
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Public read active units" ON public.units
  FOR SELECT TO anon, authenticated USING (active = true);
CREATE POLICY "Admin and master manage units" ON public.units
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Crew read all units" ON public.units
  FOR SELECT TO authenticated USING ((SELECT public.is_crew_or_admin()));

CREATE POLICY "Public read unit media" ON public.unit_media
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin and master manage unit media" ON public.unit_media
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Table privileges (defence in depth under RLS)
-- ---------------------------------------------------------------------------------------------------------------------
-- Private tables: the anon role gets nothing at all.
REVOKE ALL ON TABLE
  public.customers, public.addresses, public.orders, public.order_items, public.order_discounts, public.order_custom_fees,
  public.payments, public.invoice_links, public.consent_records, public.contacts, public.booking_setup_proofs,
  public.order_changelog, public.order_lot_pictures, public.order_pictures, public.task_status, public.documents,
  public.messages, public.route_stops, public.order_signatures, public.transaction_receipts, public.order_portal_links,
  public.crew_location_history, public.notification_failures, public.notification_system_status,
  public.sms_message_templates
FROM anon;

-- Public-read tables: anon keeps SELECT only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pricing_rules, public.units, public.unit_media FROM anon;

-- RLS does not govern TRUNCATE (and TRIGGER/REFERENCES are never needed by an app role): remove them everywhere here.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE
  public.customers, public.addresses, public.orders, public.order_items, public.order_discounts, public.order_custom_fees,
  public.payments, public.invoice_links, public.consent_records, public.contacts, public.booking_setup_proofs,
  public.order_changelog, public.order_lot_pictures, public.order_pictures, public.task_status, public.documents,
  public.messages, public.route_stops, public.order_signatures, public.transaction_receipts, public.order_portal_links,
  public.crew_location_history, public.notification_failures, public.notification_system_status,
  public.sms_message_templates, public.pricing_rules, public.units, public.unit_media
FROM authenticated;

-- The proof table is service-role only: authenticated gets nothing either.
REVOKE ALL ON TABLE public.booking_setup_proofs FROM authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. RPC EXECUTE grants for order / link RPCs (looked up by name so signature drift cannot make this fail)
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  -- Token-based order RPCs and the legacy short-link RPCs: nothing in the app calls them any more (portal access is the
  -- customer-portal-data / customer-portal-action / resolve-link Edge Functions, which use the service role).
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_order_by_token', 'get_order_with_relations_by_token', 'approve_order_changes',
                        'create_portal_short_link', 'resolve_portal_short_link')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  -- Signed-in only (these are called from the Admin / checkout screens, and they act on auth.uid()).
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('archive_old_orders', 'save_lot_picture_to_address', 'get_user_order_prefill')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 312 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261012120000'; END IF;
END $bpcend$;
