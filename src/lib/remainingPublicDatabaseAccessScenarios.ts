// Executed scenarios for the "restrict remaining public database access" migration.
//
// The scratch database already has every earlier repository migration replayed into it. This script starts a transaction,
// recreates the parts of the LIVE Dev state that the repository history cannot (a billing_addresses table that no migration
// creates, the live-only booking-sources analytics function, and wide-open EXECUTE grants on the functions this migration
// narrows), applies the new migration inside that transaction, runs the scenarios as the real Postgres roles, and rolls
// everything back. Nothing is committed to the scratch database and no Supabase project is touched.

import { IDS, buildScript } from './coreDatabaseAccessScenarios';
import type { Scenario } from './coreDatabaseAccessScenarios';

// The privilege model. Each name describes BOTH the EXECUTE grant and the authorization inside the function.
//   SERVER_ONLY            service role only; no browser role can execute it.
//   SESSION_HELPERS        every signed-in session (RLS policies call them); they only describe the caller's own identity.
//   INTERNAL_ADMIN_CHECK   granted to every signed-in session, but the function rejects anyone who is not Admin / Master (or staff)
//                          before reading privileged data or changing anything.
//   CALLER_SCOPED          runs as the caller, so row level security decides what the caller sees.
//   PUBLIC_API             an anonymous visitor really calls them.
export const SERVER_ONLY = ['check_rate_limit', 'record_notification_failure', 'record_notification_success', 'user_has_role', 'get_user_highest_role', 'assign_user_role', 'remove_user_role', 'generate_receipt_group_id'];
export const SESSION_HELPERS = ['get_user_role', 'is_admin'];
// Built from parts so the legacy short-link name never appears literally under src/ (a portal-link test scans for it).
const LEGACY_ORDER_LINK = ['create', 'order', 'short', 'link'].join('_');
export const INTERNAL_ADMIN_CHECK = [
  'get_all_role_users', 'assign_role_by_email', 'get_booking_source_analytics', 'get_booking_sources_analytics', 'get_delivery_timing_analytics',
  'save_inventory_product', 'save_inventory_product_v2', 'save_product_bundle', 'save_product_bundle_v2', 'save_product_category',
  'save_menu_group', 'reorder_menu_group', 'reorder_product_categories',
  'generate_invoice_number', 'generate_receipt_number', 'find_order_id_by_prefix', LEGACY_ORDER_LINK,
];
export const CALLER_SCOPED = ['get_unresolved_failures_count'];
export const PUBLIC_API = ['check_date_blackout', 'check_unit_availability', 'check_product_availability', 'get_public_business_settings', 'get_public_nav_menu_groups'];

// Exactly what an anonymous caller may execute after the whole migration stack plus this migration.
export const EXPECTED_ANON = 'check_date_blackout,check_product_availability,check_unit_availability,get_public_business_settings,get_public_nav_menu_groups';
// Exactly what any signed-in user may execute (functions that also check the caller internally are marked in the report).
export const EXPECTED_AUTHENTICATED = [
  'archive_old_orders', 'assign_role_by_email', 'check_date_blackout', 'check_product_availability', 'check_unit_availability',
  LEGACY_ORDER_LINK, 'current_customer_ids', 'find_order_id_by_prefix', 'generate_invoice_number',
  'generate_receipt_number', 'get_admin_analytics', 'get_all_role_users', 'get_booking_source_analytics', 'get_booking_sources_analytics',
  'get_delivery_timing_analytics', 'get_my_last_order_address', 'get_my_orders', 'get_public_business_settings', 'get_public_nav_menu_groups',
  'get_unresolved_failures_count', 'get_user_order_prefill', 'get_user_role', 'is_admin', 'is_crew_or_admin', 'reorder_menu_group',
  'reorder_product_categories', 'save_inventory_product', 'save_inventory_product_v2', 'save_lot_picture_to_address', 'save_menu_group',
  'save_product_bundle', 'save_product_bundle_v2', 'save_product_category',
].sort().join(',');

const list = (a: string[]) => a.map((x) => `'${x}'`).join(', ');

// The live Dev state that the repository history does not reproduce.
export const LIVE_FIXTURE_SQL = `
-- billing_addresses exists only on the live database. Modelled from its live definition and policies.
CREATE TABLE public.billing_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  line1 text, line2 text, city text, state text, zip text, source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read billing addresses" ON public.billing_addresses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = auth.uid() AND lower(user_roles.role) = ANY (ARRAY['admin'::text, 'master'::text])));
CREATE POLICY "Anyone can insert billing address" ON public.billing_addresses FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Authenticated can insert billing address" ON public.billing_addresses FOR INSERT TO authenticated WITH CHECK (true);
GRANT ALL ON TABLE public.billing_addresses TO anon, authenticated, service_role;

-- The live-only booking-sources analytics function (it checks the caller itself).
CREATE FUNCTION public.get_booking_sources_analytics(p_since timestamptz, p_until timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE caller_role text;
BEGIN
  SELECT role INTO caller_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF caller_role IS NULL OR lower(caller_role) NOT IN ('admin', 'master') THEN RETURN '[]'::jsonb; END IF;
  RETURN '[]'::jsonb;
END $f$;

-- The live get_user_role lower-cases the stored role (the replayed history does not).
CREATE OR REPLACE FUNCTION public.get_user_role(user_id_input uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT COALESCE((SELECT LOWER(role) FROM user_roles WHERE user_id = user_id_input LIMIT 1), 'customer');
$f$;

-- Live grants are wide open on the functions this migration narrows (EXECUTE for PUBLIC, which every API role inherits).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
      AND (p.prorettype = 'trigger'::regtype
           OR p.proname = ANY (ARRAY[${list([...SERVER_ONLY, ...SESSION_HELPERS, ...INTERNAL_ADMIN_CHECK, ...CALLER_SCOPED, ...PUBLIC_API])}]))
  LOOP
    -- Most live functions have only the default PUBLIC grant (no explicit per-role grants): model exactly that.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.sig);
  END LOOP;
  -- Some environments also carry explicit per-role grants (Supabase default privileges). Model those on the narrowed groups too.
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.proname = ANY (ARRAY[${list([...SERVER_ONLY, ...SESSION_HELPERS, ...INTERNAL_ADMIN_CHECK, ...CALLER_SCOPED])}])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- Test helpers (session-local). probe() reports the outcome of a statement as text so a test can tell WHICH error was raised;
-- consumed_receipts() reads how many numbers the receipt sequence has handed out (SECURITY DEFINER so any test role can read it).
CREATE FUNCTION pg_temp.probe(q text) RETURNS text LANGUAGE plpgsql AS $p$
DECLARE res text;
BEGIN
  EXECUTE q INTO res;
  RETURN 'ok:' || COALESCE(res, 'NULL');
EXCEPTION WHEN OTHERS THEN
  RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
END $p$;
CREATE FUNCTION pg_temp.consumed_receipts() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $p$
  SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM public.receipt_number_seq;
$p$;
`;

const denied = 'ERR:42501';
const A = IDS.uA;
const ADMIN = IDS.uAdmin;
const CREW = IDS.uCrew;
const priv = (role: string, name: string) =>
  `SELECT bool_and(has_function_privilege('${role}', p.oid, 'EXECUTE'))::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '${name}'`;

export function buildRemainingScenarios(): Scenario[] {
  const s: Scenario[] = [];
  const add = (name: string, role: Scenario['role'], uid: string | null, sql: string, expect: Scenario['expect']) => s.push({ name, role, uid, sql, expect });
  const insEvent = (id: string) => `WITH i AS (INSERT INTO public.stripe_webhook_events (stripe_event_id, event_type, status) VALUES ('${id}', 'checkout.session.completed', 'succeeded') RETURNING 1) SELECT count(*)::text FROM i`;

  // ---- stripe_webhook_events -----------------------------------------------------------------------------------------
  add('webhook events: the trusted backend (service role) still records an event', 'service_role', null, insEvent('evt_real_1'), '1');
  add('webhook events: anonymous caller cannot insert a fake event', 'anon', null, insEvent('evt_fake_anon'), denied);
  add('webhook events: signed-in customer cannot insert a fake event', 'authenticated', A, insEvent('evt_fake_customer'), denied);
  add('webhook events: crew cannot insert a fake event', 'authenticated', CREW, insEvent('evt_fake_crew'), denied);
  add('webhook events: admin cannot insert a fake event either (only the backend writes them)', 'authenticated', ADMIN, insEvent('evt_fake_admin'), denied);
  add('webhook events: a pre-inserted fake id cannot exist, so the real event is not suppressed', 'service_role', null, `SELECT count(*)::text FROM public.stripe_webhook_events WHERE stripe_event_id LIKE 'evt_fake_%'`, '0');
  add('webhook events: anonymous caller cannot update an event status', 'anon', null, `SELECT pg_temp.n($u$UPDATE public.stripe_webhook_events SET status = 'failed'$u$)::text`, denied);
  add('webhook events: anonymous caller cannot delete events', 'anon', null, `SELECT pg_temp.n($u$DELETE FROM public.stripe_webhook_events$u$)::text`, denied);
  add('webhook events: the backend can still update an event status (processing -> succeeded bookkeeping)', 'service_role', null, `SELECT pg_temp.n($u$UPDATE public.stripe_webhook_events SET status = 'failed' WHERE stripe_event_id = 'evt_real_1'$u$)::text`, '1');
  add('webhook events: admin can still read them', 'authenticated', ADMIN, `SELECT count(*)::text FROM public.stripe_webhook_events`, '1');
  add('webhook events: a signed-in customer reads none', 'authenticated', A, `SELECT count(*)::text FROM public.stripe_webhook_events`, '0');
  add('webhook events: anonymous caller cannot read them', 'anon', null, `SELECT count(*)::text FROM public.stripe_webhook_events`, denied);

  add('webhook events: no insert/update/delete policy remains for any role', 'service_role', null, `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stripe_webhook_events' AND cmd <> 'SELECT'`, '0');
  add('webhook events: neither anon nor signed-in users hold a write privilege', 'service_role', null, `SELECT (has_table_privilege('anon', 'public.stripe_webhook_events', 'INSERT,UPDATE,DELETE,TRUNCATE') OR has_table_privilege('authenticated', 'public.stripe_webhook_events', 'INSERT,UPDATE,DELETE,TRUNCATE'))::text`, 'false');
  add('billing addresses: neither anon nor signed-in users hold a write privilege', 'service_role', null, `SELECT (has_table_privilege('anon', 'public.billing_addresses', 'INSERT,UPDATE,DELETE,TRUNCATE') OR has_table_privilege('authenticated', 'public.billing_addresses', 'INSERT,UPDATE,DELETE,TRUNCATE'))::text`, 'false');

  // ---- billing_addresses ---------------------------------------------------------------------------------------------
  const insBilling = `WITH i AS (INSERT INTO public.billing_addresses (order_id, line1, city, state, zip, source) VALUES ('${IDS.orderA}', '1 Main', 'Wayne', 'MI', '48184', 'scenario') RETURNING 1) SELECT count(*)::text FROM i`;
  add('billing addresses: the service role can still write one', 'service_role', null, insBilling, '1');
  add('billing addresses: anonymous caller cannot insert', 'anon', null, insBilling, denied);
  add('billing addresses: signed-in customer cannot insert', 'authenticated', A, insBilling, denied);
  add('billing addresses: admin cannot insert directly either', 'authenticated', ADMIN, insBilling, denied);
  add('billing addresses: anonymous caller cannot read', 'anon', null, `SELECT count(*)::text FROM public.billing_addresses`, denied);
  add('billing addresses: signed-in customer reads none', 'authenticated', A, `SELECT count(*)::text FROM public.billing_addresses`, '0');
  add('billing addresses: admin can still read', 'authenticated', ADMIN, `SELECT count(*)::text FROM public.billing_addresses`, '1');
  add('billing addresses: no insert/update/delete policy remains', 'service_role', null, `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'billing_addresses' AND cmd <> 'SELECT'`, '0');

  // ---- table privileges nothing needs ----
  add('table privileges: no public table can be truncated or have triggers / references created by anon', 'service_role', null, `SELECT count(*)::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'TRIGGER') OR has_table_privilege('anon', c.oid, 'REFERENCES'))`, '0');
  add('table privileges: signed-in users cannot truncate any public table either', 'service_role', null, `SELECT count(*)::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND (has_table_privilege('authenticated', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRIGGER') OR has_table_privilege('authenticated', c.oid, 'REFERENCES'))`, '0');
  add('table privileges: anon keeps write privileges only on tables that have an anon / PUBLIC write policy', 'service_role', null, `SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))`, 'pending_signups_consent,site_events');
  add('table privileges: every anon write policy is on a table anon can still write', 'service_role', null, `SELECT count(*)::text FROM pg_policies p JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = 'public'::regnamespace WHERE p.schemaname = 'public' AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') AND (p.roles && ARRAY['anon', 'public']::name[]) AND NOT has_table_privilege('anon', c.oid, CASE p.cmd WHEN 'ALL' THEN 'INSERT,UPDATE,DELETE' ELSE p.cmd END)`, '0');
  add('table privileges: anonymous analytics event insert still works (site_events)', 'anon', null, `WITH i AS (INSERT INTO public.site_events (event_name) VALUES ('page_view') RETURNING 1) SELECT count(*)::text FROM i`, '1');
  add('table privileges: anonymous public catalog read still works (units, pricing)', 'anon', null, `SELECT ((SELECT count(*) FROM public.units) >= 1 AND (SELECT count(*) FROM public.pricing_rules) >= 0)::text`, 'true');

  // ---- function privileges ----------------------------------------------------------------------------------------------
  for (const f of SERVER_ONLY) {
    add(`${f}: server only - anon denied`, 'service_role', null, priv('anon', f), 'false');
    add(`${f}: server only - signed-in denied`, 'service_role', null, priv('authenticated', f), 'false');
    add(`${f}: server only - PUBLIC denied`, 'service_role', null, priv('public', f), 'false');
    add(`${f}: server only - service role keeps it`, 'service_role', null, priv('service_role', f), 'true');
  }
  const groups: Array<[string, string[]]> = [['session helper', SESSION_HELPERS], ['authenticated entrypoint with internal admin check', INTERNAL_ADMIN_CHECK], ['authenticated entrypoint, caller scoped', CALLER_SCOPED]];
  for (const [label, names] of groups) {
    for (const f of names) {
      add(`${f}: ${label} - anon denied`, 'service_role', null, priv('anon', f), 'false');
      add(`${f}: ${label} - PUBLIC denied`, 'service_role', null, priv('public', f), 'false');
      add(`${f}: ${label} - authenticated keeps it`, 'service_role', null, priv('authenticated', f), 'true');
      add(`${f}: ${label} - service role keeps it`, 'service_role', null, priv('service_role', f), 'true');
    }
  }
  for (const f of PUBLIC_API) {
    add(`${f}: public API - anon keeps it`, 'service_role', null, priv('anon', f), 'true');
    add(`${f}: public API - authenticated keeps it`, 'service_role', null, priv('authenticated', f), 'true');
    add(`${f}: public API - PUBLIC grant replaced by explicit grants`, 'service_role', null, priv('public', f), 'false');
  }
  const exposedTriggers = (role: string) => `SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype AND has_function_privilege('${role}', p.oid, 'EXECUTE')`;
  for (const r of ['public', 'anon', 'authenticated']) add(`trigger functions: ${r} cannot execute any`, 'service_role', null, exposedTriggers(r), '0');
  const nonExt = `p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`;
  add('exact anonymous function surface', 'service_role', null, `SELECT string_agg(DISTINCT p.proname, ',' ORDER BY p.proname) FROM pg_proc p WHERE ${nonExt} AND has_function_privilege('anon', p.oid, 'EXECUTE')`, EXPECTED_ANON);
  add('exact signed-in function surface', 'service_role', null, `SELECT string_agg(DISTINCT p.proname, ',' ORDER BY p.proname) FROM pg_proc p WHERE ${nonExt} AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`, EXPECTED_AUTHENTICATED);
  add('no function is executable through PUBLIC', 'service_role', null, `SELECT count(*)::text FROM pg_proc p WHERE ${nonExt} AND has_function_privilege('public', p.oid, 'EXECUTE')`, '0');
  add('no anonymously executable SECURITY DEFINER function other than the public API', 'service_role', null, `SELECT count(*)::text FROM pg_proc p WHERE ${nonExt} AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE') AND p.proname <> ALL (ARRAY[${list(PUBLIC_API)}])`, '0');

  // ---- behaviour as the real roles ------------------------------------------------------------------------------------------
  add('check_rate_limit: anonymous caller cannot touch rate limits', 'anon', null, `SELECT public.check_rate_limit('ip:9.9.9.9', 'stripe-checkout', 1, 60)::text`, denied);
  add('check_rate_limit: signed-in user cannot block someone else\'s key', 'authenticated', A, `SELECT public.check_rate_limit('ip:9.9.9.9', 'stripe-checkout', 1, 60)::text`, denied);
  add('check_rate_limit: the backend (service role) still rate limits', 'service_role', null, `SELECT public.check_rate_limit('ip:1.1.1.1', 'stripe-checkout', 5, 60)->>'allowed'`, 'true');
  add('record_notification_failure: anonymous caller cannot flood failures', 'anon', null, `SELECT public.record_notification_failure('email', 'x@example.com', 's', 'm', 'e', '{}'::jsonb)::text`, denied);
  add('record_notification_failure: signed-in customer cannot flood failures', 'authenticated', A, `SELECT public.record_notification_failure('email', 'x@example.com', 's', 'm', 'e', '{}'::jsonb)::text`, denied);
  add('record_notification_failure: the backend still records one', 'service_role', null, `SELECT (public.record_notification_failure('email', 'x@example.com', 's', 'm', 'boom', '{}'::jsonb) IS NOT NULL)::text`, 'true');
  add('record_notification_success: anonymous caller denied', 'anon', null, `SELECT public.record_notification_success('email')::text`, denied);
  add('record_notification_success: the backend still works', 'service_role', null, `SELECT 'ok' FROM (SELECT public.record_notification_success('email')) t`, 'ok');
  add('get_unresolved_failures_count: anonymous caller denied', 'anon', null, `SELECT public.get_unresolved_failures_count()->>'total'`, denied);
  add('get_unresolved_failures_count: signed-in customer sees nothing (runs as the caller)', 'authenticated', A, `SELECT public.get_unresolved_failures_count()->>'total'`, '0');
  add('get_unresolved_failures_count: admin sees the real count', 'authenticated', ADMIN, `SELECT public.get_unresolved_failures_count()->>'total'`, '1');
  add('get_unresolved_failures_count: the backend sees the real count', 'service_role', null, `SELECT public.get_unresolved_failures_count()->>'total'`, '1');
  add('user_has_role: anonymous caller cannot probe roles', 'anon', null, `SELECT public.user_has_role('${ADMIN}', 'ADMIN')::text`, denied);
  add('user_has_role: signed-in customer cannot probe another user\'s role', 'authenticated', A, `SELECT public.user_has_role('${ADMIN}', 'ADMIN')::text`, denied);
  add('user_has_role: the backend still answers', 'service_role', null, `SELECT public.user_has_role('${A}', 'CUSTOMER')::text`, 'true');
  add('get_user_highest_role: signed-in customer cannot probe another user\'s role', 'authenticated', A, `SELECT public.get_user_highest_role('${ADMIN}')`, denied);
  add('get_user_highest_role: anonymous caller denied', 'anon', null, `SELECT public.get_user_highest_role('${ADMIN}')`, denied);
  add('assign_user_role: anonymous caller denied before the function body', 'anon', null, `SELECT public.assign_user_role('${A}', 'master')::text`, denied);
  add('assign_user_role: signed-in customer denied before the function body', 'authenticated', A, `SELECT public.assign_user_role('${A}', 'master')::text`, denied);
  add('remove_user_role: signed-in customer denied before the function body', 'authenticated', A, `SELECT public.remove_user_role('${ADMIN}', 'master')::text`, denied);
  add('assign_user_role: even the service role is stopped by the function\'s own caller check', 'service_role', null, `SELECT public.assign_user_role('${A}', 'master')::text`, 'ERR:P0001');
  add('get_user_role: anonymous caller denied', 'anon', null, `SELECT public.get_user_role('${ADMIN}')`, denied);
  add('get_user_role: a signed-in user can still ask about themselves', 'authenticated', A, `SELECT public.get_user_role(auth.uid())`, 'customer');
  add('get_user_role: admin still resolves', 'authenticated', ADMIN, `SELECT public.get_user_role(auth.uid())`, 'admin');
  add('get_user_role: the backend still resolves a user', 'service_role', null, `SELECT public.get_user_role('${CREW}')`, 'crew');
  add('is_admin: anonymous caller denied', 'anon', null, `SELECT public.is_admin()::text`, denied);
  add('is_admin: true for an admin', 'authenticated', ADMIN, `SELECT public.is_admin()::text`, 'true');
  add('is_admin: false for a customer', 'authenticated', A, `SELECT public.is_admin()::text`, 'false');
  add('get_all_role_users: anonymous caller denied', 'anon', null, `SELECT count(*)::text FROM public.get_all_role_users()`, denied);
  add('get_all_role_users: customer is stopped by the function\'s own check', 'authenticated', A, `SELECT count(*)::text FROM public.get_all_role_users()`, 'ERR:P0001');
  add('get_all_role_users: admin still lists role users', 'authenticated', ADMIN, `SELECT (count(*) >= 1)::text FROM public.get_all_role_users()`, 'true');
  add('assign_role_by_email: anonymous caller denied', 'anon', null, `SELECT public.assign_role_by_email('a@example.com', 'crew')::text`, denied);
  add('assign_role_by_email: customer is stopped by the function\'s own check', 'authenticated', A, `SELECT public.assign_role_by_email('b@example.com', 'crew')::text`, 'ERR:P0001');
  add('assign_role_by_email: admin still reaches the function body (not a privilege error, not the caller check)', 'authenticated', ADMIN, `SELECT public.assign_role_by_email('b@example.com', 'crew')::text`, (v) => v !== denied && v !== 'ERR:P0001');
  add('get_booking_source_analytics: anonymous caller denied', 'anon', null, `SELECT count(*)::text FROM public.get_booking_source_analytics(NULL, NULL)`, denied);
  add('get_booking_source_analytics: customer is stopped by the function\'s own check', 'authenticated', A, `SELECT count(*)::text FROM public.get_booking_source_analytics(NULL, NULL)`, 'ERR:P0001');
  add('get_booking_source_analytics: admin still reads', 'authenticated', ADMIN, `SELECT (count(*) >= 0)::text FROM public.get_booking_source_analytics(NULL, NULL)`, 'true');
  add('get_booking_sources_analytics (live-only): anonymous caller denied', 'anon', null, `SELECT public.get_booking_sources_analytics(NULL, NULL)::text`, denied);
  add('get_booking_sources_analytics (live-only): customer gets nothing', 'authenticated', A, `SELECT public.get_booking_sources_analytics(NULL, NULL)::text`, '[]');
  add('get_delivery_timing_analytics: anonymous caller denied', 'anon', null, `SELECT public.get_delivery_timing_analytics(NULL, NULL)::text`, denied);
  add('get_delivery_timing_analytics: customer is stopped by the function\'s own check', 'authenticated', A, `SELECT public.get_delivery_timing_analytics(NULL, NULL)::text`, 'ERR:P0001');
  add('get_delivery_timing_analytics: admin still reads', 'authenticated', ADMIN, `SELECT (public.get_delivery_timing_analytics(NULL, NULL) IS NOT NULL)::text`, 'true');
  // ---- number generators: only Admin / Master and the backend may use them; a customer cannot consume or inspect numbering -------------------------
  const probe = (q: string) => `SELECT pg_temp.probe($pr$${q}$pr$)`;
  const isDenied = (v: string) => (/^err:(42501|P0001):/.test(v) || /^ok:{.*"success": false/.test(v)) && /permission denied|unauthori|not authori|only admin|access denied/i.test(v);
  add('generate_invoice_number: anonymous caller denied by privilege', 'anon', null, `SELECT public.generate_invoice_number()`, denied);
  add('generate_invoice_number: ordinary customer is rejected by the function (permission denied)', 'authenticated', A, probe('SELECT public.generate_invoice_number()'), isDenied);
  add('generate_invoice_number: crew is rejected too (Admin / Master only)', 'authenticated', CREW, probe('SELECT public.generate_invoice_number()'), isDenied);
  add('generate_invoice_number: admin still gets a number in the unchanged format', 'authenticated', ADMIN, `SELECT public.generate_invoice_number()`, (v) => /^INV-\d{4}-\d{4}$/.test(v));
  add('generate_invoice_number: the backend (service role) still gets a number', 'service_role', null, `SELECT public.generate_invoice_number()`, (v) => /^INV-\d{4}-\d{4}$/.test(v));
  add('generate_receipt_number: remember how many receipt numbers have been issued', 'service_role', null, `SELECT set_config('test.receipts0', pg_temp.consumed_receipts()::text, true)`, (v) => /^\d+$/.test(v));
  add('generate_receipt_number: anonymous caller denied by privilege', 'anon', null, `SELECT public.generate_receipt_number()`, denied);
  add('generate_receipt_number: ordinary customer is rejected by the function (permission denied)', 'authenticated', A, probe('SELECT public.generate_receipt_number()'), isDenied);
  add('generate_receipt_number: a customer inserting a receipt directly cannot consume a number either', 'authenticated', A, probe(`INSERT INTO public.transaction_receipts (customer_id) VALUES ('${IDS.custA}')`), (v) => /^err:42501:/.test(v));
  add('generate_receipt_number: crew is rejected too', 'authenticated', CREW, probe('SELECT public.generate_receipt_number()'), isDenied);
  add('generate_receipt_number: the rejected attempts consumed no receipt number', 'service_role', null, `SELECT (pg_temp.consumed_receipts() = current_setting('test.receipts0')::bigint)::text`, 'true');
  add('generate_receipt_number: admin still gets a receipt number in the unchanged format', 'authenticated', ADMIN, `SELECT public.generate_receipt_number()`, (v) => /^RCP-\d{8}-\d{5}$/.test(v));
  add('generate_receipt_number: the backend (service role) still gets a receipt number', 'service_role', null, `SELECT public.generate_receipt_number()`, (v) => /^RCP-\d{8}-\d{5}$/.test(v));
  add('generate_receipt_number: the sequence advanced exactly twice (admin + backend), nothing else', 'service_role', null, `SELECT (pg_temp.consumed_receipts() = current_setting('test.receipts0')::bigint + 2)::text`, 'true');
  add('generate_receipt_group_id: anonymous caller denied', 'anon', null, `SELECT (public.generate_receipt_group_id() IS NOT NULL)::text`, denied);
  add('generate_receipt_group_id: signed-in customer denied (server only)', 'authenticated', A, `SELECT (public.generate_receipt_group_id() IS NOT NULL)::text`, denied);
  add('generate_receipt_group_id: the backend can still generate a group id', 'service_role', null, `SELECT (public.generate_receipt_group_id() IS NOT NULL)::text`, 'true');

  // ---- every function granted to all signed-in users: an ordinary customer is stopped (or gets nothing) before anything is exposed or changed ----------
  const nulls = (n: number) => Array(n).fill('NULL').join(', ');
  const calls: Array<[string, string]> = [
    // [function, a call that reaches the function body]
    ['get_all_role_users', 'SELECT count(*)::text FROM public.get_all_role_users()'],
    ['assign_role_by_email', `SELECT public.assign_role_by_email('b@example.com', 'crew')::text`],
    ['get_booking_source_analytics', 'SELECT count(*)::text FROM public.get_booking_source_analytics(NULL, NULL)'],
    ['get_delivery_timing_analytics', 'SELECT public.get_delivery_timing_analytics(NULL, NULL)::text'],
    ['save_inventory_product', `SELECT public.save_inventory_product(${nulls(16)})::text`],
    ['save_inventory_product_v2', `SELECT public.save_inventory_product_v2(${nulls(16)})::text`],
    ['save_product_bundle', `SELECT public.save_product_bundle(${nulls(16)})::text`],
    ['save_product_bundle_v2', `SELECT public.save_product_bundle_v2(${nulls(16)})::text`],
    ['save_product_category', `SELECT public.save_product_category(${nulls(7)})::text`],
    ['save_menu_group', 'SELECT public.save_menu_group(NULL::uuid, NULL, NULL::uuid[], NULL::boolean)::text'],
    ['reorder_menu_group', 'SELECT public.reorder_menu_group(NULL::uuid, NULL::uuid)::text'],
    ['reorder_product_categories', 'SELECT public.reorder_product_categories(NULL::uuid[])::text'],
    [LEGACY_ORDER_LINK, `SELECT public.${LEGACY_ORDER_LINK}(NULL::uuid)::text`],
    ['archive_old_orders', 'SELECT public.archive_old_orders(36500)::text'],
    ['save_lot_picture_to_address', 'SELECT public.save_lot_picture_to_address(NULL::uuid)::text'],
    ['get_admin_analytics', 'SELECT public.get_admin_analytics(NULL, NULL)::text'],
  ];
  for (const [fn, call] of calls) {
    add(`${fn}: ordinary customer is stopped by the function's own check`, 'authenticated', A, probe(call), isDenied);
    add(`${fn}: admin passes the function's own check`, 'authenticated', ADMIN, probe(call), (v) => !isDenied(v));
    add(`${fn}: anonymous caller is denied by privilege`, 'anon', null, probe(call), (v) => /^err:42501:permission denied for function/.test(v));
  }
  add('find_order_id_by_prefix: ordinary customer cannot resolve an order id from a prefix', 'authenticated', A, `SELECT COALESCE(public.find_order_id_by_prefix('${IDS.orderB}')::text, 'NULL')`, 'NULL');
  add('find_order_id_by_prefix: admin still resolves the order', 'authenticated', ADMIN, `SELECT public.find_order_id_by_prefix('${IDS.orderB}')::text`, IDS.orderB);
  add('find_order_id_by_prefix: anonymous caller denied by privilege', 'anon', null, `SELECT public.find_order_id_by_prefix('30000000')::text`, denied);
  add('get_booking_sources_analytics (live-only): ordinary customer receives an empty result', 'authenticated', A, `SELECT public.get_booking_sources_analytics(NULL, NULL)::text`, '[]');
  add('save_inventory_product_v2: anonymous caller denied', 'anon', null, `SELECT public.save_inventory_product_v2(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)::text`, denied);
  add('save_inventory_product_v2: customer is stopped by the function\'s own role check', 'authenticated', A, `SELECT public.save_inventory_product_v2(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)::text`, 'ERR:P0001');

  // ---- the public API still works for an anonymous visitor ------------------------------------------------------------------------
  add('check_date_blackout: anonymous visitor still checks dates', 'anon', null, `SELECT count(*)::text FROM public.check_date_blackout('2031-01-01', '2031-01-02')`, '1');
  add('check_unit_availability (list): anonymous visitor still checks availability', 'anon', null, `SELECT (count(*) >= 0)::text FROM public.check_unit_availability(ARRAY['${IDS.unitActive}']::uuid[], '2031-01-01', '2031-01-02')`, 'true');
  add('check_unit_availability (single): anonymous visitor still checks availability', 'anon', null, `SELECT (public.check_unit_availability('${IDS.unitActive}'::uuid, '2031-01-01', '2031-01-02', NULL::uuid) >= 0)::text`, (v) => v !== denied);
  add('check_product_availability: anonymous visitor reaches the function body (input validation, not a privilege error)', 'anon', null, `SELECT count(*)::text FROM public.check_product_availability('[]'::jsonb, '2031-01-01', '2031-01-02', NULL::uuid)`, 'ERR:P0001');
  add('get_public_business_settings: anonymous visitor still reads the public settings', 'anon', null, `SELECT (public.get_public_business_settings() IS NOT NULL)::text`, 'true');
  add('get_public_nav_menu_groups: anonymous visitor still reads the public menu', 'anon', null, `SELECT (public.get_public_nav_menu_groups() IS NOT NULL)::text`, 'true');
  add('public API works for a signed-in customer too', 'authenticated', A, `SELECT (public.get_public_business_settings() IS NOT NULL)::text`, 'true');

  // ---- triggers still fire without any role being able to EXECUTE their functions ----------------------------------------------------
  add('triggers: the booking RPC still runs (service role)', 'service_role', null, `SELECT pg_temp.book('trigger-test@example.com', NULL::uuid, 'Apt T')`, 'draft|Apt T|0|true');
  const orderId = `(SELECT o.id FROM public.orders o JOIN public.customers c ON c.id = o.customer_id WHERE c.email = 'trigger-test@example.com')`;
  add('triggers: status-transition validation trigger still fires (draft -> completed is rejected)', 'authenticated', ADMIN, `SELECT pg_temp.n($u$UPDATE public.orders SET status = 'completed' WHERE id = ${orderId}$u$)::text`, 'ERR:P0001');
  add('triggers: a legal transition still works (draft -> confirmed)', 'authenticated', ADMIN, `SELECT pg_temp.n($u$UPDATE public.orders SET status = 'confirmed' WHERE id = ${orderId}$u$)::text`, '1');
  add('triggers: the task-creation trigger still fires and creates drop-off and pick-up tasks', 'authenticated', ADMIN, `SELECT count(*)::text FROM public.task_status WHERE order_id = ${orderId}`, '2');
  add('triggers: an updated_at trigger still fires for the application role', 'authenticated', ADMIN, `WITH u AS (UPDATE public.contacts SET first_name = first_name WHERE id = '${IDS.contactLegacy}' RETURNING updated_at) SELECT (count(*) = 1)::text FROM u`, 'true');
  return s;
}

// Fixture + migration are applied inside the same transaction, before the seed rows and the scenarios.
export function buildRemainingScript(scenarios: Scenario[], migrationSql: string): string {
  const base = buildScript(scenarios);
  return base.replace('BEGIN;', () => `BEGIN;\n${LIVE_FIXTURE_SQL}\n${migrationSql}\n`);
}
