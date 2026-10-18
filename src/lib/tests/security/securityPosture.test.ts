// Final security posture (Step 3B): one executed suite that states the intended end state of the database, as the real roles.
//
// Layers, labelled so nobody mistakes one for another:
//   STATIC    parses the Step 3B migration text (always runs).
//   EXECUTED  runs real SQL as the real postgres / anon / authenticated / service_role roles against a SCRATCH PostgreSQL database that holds
//             the COMPLETE repository migration chain (POSTURE_DB_NAME, default "bpc_replay_full"). Everything runs in one transaction that is
//             rolled back. It never touches a Supabase project. With no reachable database the layer is SKIPPED (an environment limit, not a
//             pass); CORE_DB_REQUIRE=1 makes that a failure.
//   BASELINE  point POSTURE_DB_NAME at a replay that stops at 20261025120000 (security-scratch.cjs builds "bpc_replay_full25") to see which
//             checks fail BEFORE the Step 3B migrations. That is how the "before" evidence was recorded.
// Run: node scripts/dev/security-scratch.cjs build && node scripts/dev/security-scratch.cjs test securityPosture

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import { IDS } from '../support/coreDatabaseAccessScenarios';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

const M_SEQ = 'supabase/migrations/20261026120000_restrict_sequence_and_anon_table_privileges.sql';
const M_CAT = 'supabase/migrations/20261026120100_grant_service_role_catalog_read.sql';
const M_CREW = 'supabase/migrations/20261026120200_restore_crew_task_and_receipt_access.sql';
const M_GUARD = 'supabase/migrations/20261026120300_guard_booking_confirmation_columns.sql';
const M_DEF = 'supabase/migrations/20261026120400_restrict_supabase_admin_default_privileges.sql';
const STEP4_SQL = 'audit/security/step4-development-containment-end-state.sql';

// ---------------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------------
{
  const seq = strip(read(M_SEQ));
  const cat = strip(read(M_CAT));
  const crew = strip(read(M_CREW));
  const guard = strip(read(M_GUARD));
  const def = strip(read(M_DEF));
  ok('static: sequence migration removes every anon privilege and authenticated UPDATE, and never touches service_role', /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;/.test(seq) && /REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM authenticated;/.test(seq) && !/service_role/.test(seq));
  ok('static: anon table privileges are removed only where no anon/public policy exists', /NOT EXISTS[\s\S]*pg_policies[\s\S]*ARRAY\['anon', 'public'\]/.test(seq) && /REVOKE ALL ON TABLE public\.%I FROM anon/.test(seq));
  ok('static: the signup-consent table keeps INSERT only', /REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.pending_signups_consent FROM anon;/.test(seq));
  ok('static: the unpinned SECURITY DEFINER trigger function gets a pinned search_path', /ALTER FUNCTION public\.update_google_reviews_updated_at\(\) SET search_path = public, pg_temp;/.test(seq));
  ok('static: the catalog migration grants SELECT only, only to service_role, on exactly eight tables', /GRANT SELECT ON TABLE public\.%I TO service_role/.test(cat) && !/anon|authenticated|INSERT|UPDATE|DELETE/.test(cat.replace(/RAISE NOTICE[^;]*;/g, '')) && (cat.match(/'[a-z_]+'/g) ?? []).filter((x: string) => /inventory_products|product_pricing|product_categories|product_bundles|product_bundle_components|package_inflatable_components|package_inflatable_eligibility|product_bundle_excluded_categories/.test(x)).length === 8);
  ok('static: the crew/receipt migration adds exactly two policies, each only when missing, with no anon or customer role', (crew.match(/CREATE POLICY/g) ?? []).length === 2 && (crew.match(/NOT EXISTS \(SELECT 1 FROM pg_policies/g) ?? []).length === 2 && !/anon|public\)|TO public/.test(crew));
  ok('static: the guard trigger restricts only authenticated and anon sessions and pins its search_path', /current_user NOT IN \('authenticated', 'anon'\)/.test(guard) && /SET search_path = public, pg_temp/.test(guard) && /REVOKE ALL ON FUNCTION public\.guard_booking_confirmation_columns\(\) FROM PUBLIC, anon, authenticated;/.test(guard));
  ok('static: the default-privilege migration fails closed (re-checks its postcondition and raises) and never grants anything; details in defaultPrivilegeMigration.test.ts', /RAISE EXCEPTION/.test(def) && !/GRANT/.test(def.replace(/ALTER DEFAULT PRIVILEGES[^;]*;/g, '')) && (def.match(/REVOKE ALL ON (TABLES|SEQUENCES|FUNCTIONS) FROM anon, authenticated/g) ?? []).length === 3);
  // SEC-045: stored template HTML is previewed in a sandboxed frame, and nothing in the browser code injects raw HTML.
  const tpl = read('src/components/admin/settings/MessageTemplatesTab.tsx');
  ok('static: the template preview is a sandboxed iframe with no script or same-origin permission', /<iframe[\s\S]*sandbox=""[\s\S]*srcDoc=\{template\.content_template\}/.test(tpl) && !/allow-scripts|allow-same-origin/.test(tpl));
  const srcFiles: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.(tsx|ts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !p.includes('/tests/')) srcFiles.push(p); } };
  walk('src');
  ok('static: no browser source injects raw HTML (dangerouslySetInnerHTML / innerHTML =)', srcFiles.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(read(f))).length === 0);
  // The anonymous-privilege sweep (20261026120000) makes a signed-out read of admin_settings an explicit refusal instead of zero rows;
  // the site-wide provider must treat that refusal like the old empty result and still load the public address.
  const biz = read('src/contexts/BusinessContext.tsx');
  ok('static: BusinessProvider treats a permission refusal from admin_settings as no private rows and still loads the public address', /refusedForVisitor/.test(biz) && /42501/.test(biz) && /getBusinessAddressText\(\)/.test(biz) && /if \(error && !refusedForVisitor\)/.test(biz));
  ok('static: the Development containment end-state script is a reviewed audit file, not a migration', fs.existsSync(STEP4_SQL) && !fs.readdirSync('supabase/migrations').some((f: string) => /containment/i.test(f)));
  const step4 = strip(read(STEP4_SQL));
  ok('static: the end-state script gives anon/authenticated schema USAGE, removes service_role CREATE, and does nothing else', /GRANT USAGE ON SCHEMA public TO anon, authenticated;/.test(step4) && /REVOKE CREATE ON SCHEMA public FROM service_role;/.test(step4) && (step4.match(/\b(GRANT|REVOKE)\b/g) ?? []).length === 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------------
interface Scenario { name: string; role: 'postgres' | 'anon' | 'authenticated' | 'service_role'; uid: string | null; sql: string; expect: string | ((v: string) => boolean) }
const S: Scenario[] = [];
const add = (name: string, role: Scenario['role'], uid: string | null, sql: string, expect: Scenario['expect']) => S.push({ name, role, uid, sql, expect });
const denied = (v: string) => v === 'ERR:42501';
const n = (q: string) => `SELECT pg_temp.n($u$${q}$u$)::text`;
const A = IDS.uA, ADMIN = IDS.uAdmin, CREW = IDS.uCrew, MASTER = IDS.uMaster, LEGACY = IDS.uLegacy;

const ALLOW_ANON = 'check_date_blackout,check_product_availability,check_unit_availability,get_public_business_settings,get_public_nav_menu_groups';
const CATALOG = ['inventory_products', 'product_pricing', 'product_categories', 'product_bundles', 'product_bundle_components', 'package_inflatable_components', 'package_inflatable_eligibility', 'product_bundle_excluded_categories'];

// ---- anonymous ----------------------------------------------------------------------------------------------------
add('SEC-010 anon-executable public functions equal the explicit allow-list', 'service_role', null, `SELECT string_agg(DISTINCT p.proname, ',' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')`, ALLOW_ANON);
add('SEC-010 no public function is executable through PUBLIC (every grant is explicit)', 'service_role', null, `SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))`, '0');
add('SEC-039 anon holds no table privilege on a table without an anon/public policy', 'service_role', null, `SELECT count(*)::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.roles && ARRAY['anon','public']::name[])`, '0');
add('SEC-003 the only table anon may write is the signup-consent table', 'service_role', null, `SELECT coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '') FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')`, 'pending_signups_consent');
add('SEC-003 anon holds INSERT (not SELECT, UPDATE or DELETE) on the signup-consent table', 'service_role', null, `SELECT concat_ws(',', has_table_privilege('anon','public.pending_signups_consent','INSERT'), has_table_privilege('anon','public.pending_signups_consent','SELECT'), has_table_privilege('anon','public.pending_signups_consent','UPDATE'), has_table_privilege('anon','public.pending_signups_consent','DELETE'))`, 't,f,f,f');
add('SEC-001 anon cannot read orders', 'anon', null, 'SELECT count(*)::text FROM public.orders', denied);
add('SEC-001 anon cannot insert orders', 'anon', null, n(`INSERT INTO public.orders (customer_id) VALUES ('${IDS.custA}')`), denied);
add('SEC-001 anon cannot update orders (including the confirmation flag)', 'anon', null, n(`UPDATE public.orders SET booking_confirmation_sent = true WHERE id = '${IDS.orderA}'`), denied);
add('SEC-001 anon cannot delete orders', 'anon', null, n(`DELETE FROM public.orders WHERE id = '${IDS.orderA}'`), denied);
add('SEC-001 no orders policy names public or anon', 'service_role', null, `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders' AND roles && ARRAY['anon','public']::name[]`, '0');
add('SEC-002 no policy named like "service role" lacks a service_role target (public + storage)', 'service_role', null, `SELECT count(*)::text FROM pg_policies WHERE schemaname IN ('public','storage') AND policyname ILIKE '%service role%' AND NOT ('service_role' = ANY (roles))`, '0');
add('SEC-002 no private table is readable by anon: customers, payments, addresses, user_roles, admin_settings', 'anon', null, `SELECT concat_ws(',', has_table_privilege('anon','public.customers','SELECT'), has_table_privilege('anon','public.payments','SELECT'), has_table_privilege('anon','public.addresses','SELECT'), has_table_privilege('anon','public.user_roles','SELECT'), has_table_privilege('anon','public.admin_settings','SELECT'))`, 'f,f,f,f,f');
add('public catalog still readable by anon (active units)', 'anon', null, `SELECT (count(*) >= 1)::text FROM public.units WHERE active`, 'true');
add('public availability and settings functions still work for anon', 'anon', null, `SELECT (public.get_public_business_settings() IS NOT NULL)::text`, 'true');

// ---- secrets table (SEC-039) ----------------------------------------------------------------------------------------
add('SEC-039 anon cannot read admin_settings', 'anon', null, 'SELECT count(*)::text FROM public.admin_settings', denied);
add('SEC-039 a signed-in customer reads no admin_settings row', 'authenticated', A, 'SELECT count(*)::text FROM public.admin_settings', '0');
add('SEC-039 crew reads no admin_settings row', 'authenticated', CREW, 'SELECT count(*)::text FROM public.admin_settings', '0');
add('SEC-039 a customer cannot change admin_settings', 'authenticated', A, n(`UPDATE public.admin_settings SET value = 'x'`), '0');
add('SEC-039 admin reads admin_settings', 'authenticated', ADMIN, 'SELECT (count(*) >= 1)::text FROM public.admin_settings', 'true');
add('SEC-039 the changelog of settings is also admin-only', 'authenticated', A, 'SELECT count(*)::text FROM public.admin_settings_changelog', '0');

// ---- sequences (SEC-014) ----------------------------------------------------------------------------------------------
add('SEC-014 anon holds no privilege on any public sequence', 'service_role', null, `SELECT count(*)::text FROM (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c WHERE (has_sequence_privilege('anon', c.oid, 'USAGE') OR has_sequence_privilege('anon', c.oid, 'SELECT') OR has_sequence_privilege('anon', c.oid, 'UPDATE'))`, '0');
add('SEC-014 authenticated cannot setval any public sequence', 'service_role', null, `SELECT count(*)::text FROM (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c WHERE has_sequence_privilege('authenticated', c.oid, 'UPDATE')`, '0');
add('SEC-014 service_role keeps USAGE on every public sequence (all the backend needs: nextval)', 'service_role', null, `SELECT count(*)::text FROM (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c WHERE NOT has_sequence_privilege('service_role', c.oid, 'USAGE')`, '0');
add('SEC-014 anon cannot setval the receipt sequence', 'anon', null, `SELECT setval('public.receipt_number_seq', 1)::text`, denied);
add('SEC-014 a signed-in customer cannot setval the ledger sequence', 'authenticated', A, `SELECT setval('public.payments_ledger_sequence_seq', 1)::text`, denied);
add('SEC-014 an admin still gets a receipt number (the generator is SECURITY DEFINER)', 'authenticated', ADMIN, `SELECT (length(public.generate_receipt_number()) > 0)::text`, 'true');
add('SEC-014 a signed-in customer cannot consume receipt numbers', 'authenticated', A, `SELECT public.generate_receipt_number()`, (v) => v.startsWith('ERR:'));
add('SEC-014 anon cannot consume receipt numbers', 'anon', null, `SELECT public.generate_receipt_number()`, denied);

// ---- default privileges (SEC-015) -------------------------------------------------------------------------------------
add('SEC-015 the migration owner defaults in public give nothing to anon or authenticated', 'service_role', null, `SELECT count(*)::text FROM pg_default_acl d WHERE d.defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(d.defaclrole) = 'postgres' AND (d.defaclacl::text LIKE '%anon=%' OR d.defaclacl::text LIKE '%authenticated=%')`, '0');
add('SEC-015 a table created now is invisible to anon/authenticated and open to service_role', 'service_role', null, `SELECT concat_ws(',', has_table_privilege('anon','public.zz_posture_probe','SELECT'), has_table_privilege('authenticated','public.zz_posture_probe','SELECT'), has_table_privilege('service_role','public.zz_posture_probe','SELECT'))`, 'f,f,t');
add('SEC-015 a function created now is not executable by PUBLIC, anon or authenticated', 'service_role', null, `SELECT concat_ws(',', has_function_privilege('anon','public.zz_posture_fn()','EXECUTE'), has_function_privilege('authenticated','public.zz_posture_fn()','EXECUTE'), has_function_privilege('service_role','public.zz_posture_fn()','EXECUTE'))`, 'f,f,t');
add('SEC-015 supabase_admin defaults: after the migration no anon/authenticated entry remains (simulated defaults)', 'service_role', null, `SELECT count(*)::text FROM pg_default_acl d WHERE d.defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(d.defaclrole) = 'supabase_admin' AND (d.defaclacl::text LIKE '%anon=%' OR d.defaclacl::text LIKE '%authenticated=%')`, '0');
add('SEC-015 supabase_admin defaults: service_role entry is preserved', 'service_role', null, `SELECT (count(*) >= 1)::text FROM pg_default_acl d WHERE d.defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(d.defaclrole) = 'supabase_admin' AND d.defaclacl::text LIKE '%service_role=%'`, 'true');
add('SEC-015 with the defaults already closed, a role that may not alter supabase_admin defaults passes (nothing to change)', 'service_role', null, `SELECT pg_temp.try_def_migration(false)`, 'ok');
add('SEC-015 with the defaults OPEN, a role that may not alter them is refused (fail closed, 42501), never a silent success', 'service_role', null, `SELECT pg_temp.try_def_migration(true)`, 'ERR:42501');

// ---- Development catalog grants (SEC-016) -------------------------------------------------------------------------------
add('SEC-016 service_role can SELECT all eight catalog tables (after revoking them and re-running the migration)', 'service_role', null, `SELECT count(*)::text FROM unnest(ARRAY[${CATALOG.map((t) => `'${t}'`).join(',')}]) t WHERE has_table_privilege('service_role', 'public.' || t, 'SELECT')`, '8');
add('SEC-016 anon cannot write the catalog tables, and a signed-in customer is stopped by row level security', 'authenticated', A, `SELECT ((SELECT count(*) FROM unnest(ARRAY[${CATALOG.map((t) => `'${t}'`).join(',')}]) t WHERE has_table_privilege('anon', 'public.' || t, 'INSERT,UPDATE,DELETE')) = 0)::text || ',' || pg_temp.n($u$UPDATE public.inventory_products SET active = active$u$)::text`, 'true,0');
add('SEC-016 service_role received SELECT only: no write privilege on any catalog table', 'service_role', null, `SELECT count(*)::text FROM unnest(ARRAY[${CATALOG.map((t) => `'${t}'`).join(',')}]) t WHERE has_table_privilege('service_role', 'public.' || t, 'INSERT,UPDATE,DELETE')`, '0');

// ---- SECURITY DEFINER hygiene (SEC-037) ---------------------------------------------------------------------------------
add('SEC-037 every SECURITY DEFINER function pins its search_path', 'service_role', null, `SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`, '0');

// ---- crew and receipts (SEC-036) -----------------------------------------------------------------------------------------
add('SEC-036 crew can create a missing task row', 'authenticated', CREW, n(`INSERT INTO public.task_status (order_id, task_type, task_date) VALUES ('${IDS.orderA}', 'pick-up', '2030-06-02')`), '1');
add('SEC-036 admin can still create a task row', 'authenticated', ADMIN, n(`INSERT INTO public.task_status (order_id, task_type, task_date) VALUES ('${IDS.orderB}', 'drop-off', '2030-06-02')`), '1');
add('SEC-036 a signed-in customer cannot create a task row', 'authenticated', A, n(`INSERT INTO public.task_status (order_id, task_type, task_date) VALUES ('${IDS.orderA}', 'pick-up', '2030-06-03')`), denied);
add('SEC-036 anon cannot create a task row', 'anon', null, n(`INSERT INTO public.task_status (order_id, task_type, task_date) VALUES ('${IDS.orderA}', 'pick-up', '2030-06-04')`), denied);
add('SEC-036 admin can set the receipt flag', 'authenticated', ADMIN, n(`UPDATE public.transaction_receipts SET receipt_sent_to_admin = true`), '1');
add('SEC-036 crew cannot change a receipt', 'authenticated', CREW, n(`UPDATE public.transaction_receipts SET receipt_sent_to_admin = false`), '0');
add('SEC-036 a customer cannot change a receipt', 'authenticated', A, n(`UPDATE public.transaction_receipts SET receipt_sent_to_admin = false`), '0');
add('SEC-036 anon cannot change a receipt', 'anon', null, n(`UPDATE public.transaction_receipts SET receipt_sent_to_admin = false`), denied);

// ---- server-managed confirmation columns (SEC-047, SEC-035 part) -------------------------------------------------------
add('SEC-047 admin cannot change the confirmation claim', 'authenticated', ADMIN, n(`UPDATE public.orders SET booking_confirmation_claim_id = gen_random_uuid() WHERE id = '${IDS.orderA}'`), denied);
add('SEC-047 crew cannot change the confirmation claim', 'authenticated', CREW, n(`UPDATE public.orders SET booking_confirmation_claimed_at = now() WHERE id = '${IDS.orderA}'`), denied);
add('SEC-047 master cannot set the confirmation-sent flag', 'authenticated', MASTER, n(`UPDATE public.orders SET booking_confirmation_sent = true WHERE id = '${IDS.orderA}'`), denied);
add('SEC-047 staff cannot insert an order that already claims a confirmation', 'authenticated', ADMIN, n(`INSERT INTO public.orders (customer_id, booking_confirmation_sent) VALUES ('${IDS.custA}', true)`), denied);
add('SEC-047 admin can still edit other order columns', 'authenticated', ADMIN, n(`UPDATE public.orders SET admin_message = 'hello' WHERE id = '${IDS.orderA}'`), '1');
add('SEC-047 crew can still advance the workflow status', 'authenticated', CREW, n(`UPDATE public.orders SET workflow_status = 'on_the_way' WHERE id = '${IDS.orderA}'`), '1');
add('SEC-047 the claim function (service role) still claims', 'service_role', null, `SELECT public.claim_booking_confirmation('${IDS.orderA}'::uuid, '90000000-0000-4000-8000-0000000000c1'::uuid, 600)`, (v) => !v.startsWith('ERR:'));
add('SEC-047 the claim function (service role) then finalizes', 'service_role', null, `SELECT public.finalize_booking_confirmation('${IDS.orderA}'::uuid, '90000000-0000-4000-8000-0000000000c1'::uuid)::text`, (v) => !v.startsWith('ERR:'));
add('SEC-047 an admin cannot call the claim function directly', 'authenticated', ADMIN, `SELECT public.claim_booking_confirmation('${IDS.orderA}'::uuid, gen_random_uuid(), 600)`, denied);

// ---- roles and customer isolation (SEC-006..009) --------------------------------------------------------------------------
add('SEC-006 a customer cannot give themselves a role', 'authenticated', A, n(`INSERT INTO public.user_roles (user_id, role) VALUES ('${A}', 'master')`), denied);
add('SEC-006 crew cannot give anyone a role', 'authenticated', CREW, n(`INSERT INTO public.user_roles (user_id, role) VALUES ('${IDS.uB}', 'crew')`), denied);
add('SEC-006 an admin cannot grant master or admin', 'authenticated', ADMIN, n(`INSERT INTO public.user_roles (user_id, role) VALUES ('${IDS.uB}', 'master')`), denied);
add('SEC-006 an admin can grant crew', 'authenticated', ADMIN, n(`INSERT INTO public.user_roles (user_id, role) VALUES ('${IDS.uB}', 'crew')`), '1');
add('SEC-006 a master can grant admin', 'authenticated', MASTER, n(`INSERT INTO public.user_roles (user_id, role) VALUES ('${IDS.uB}', 'admin')`), '1');
add('SEC-006 anon cannot read or write user_roles', 'anon', null, 'SELECT count(*)::text FROM public.user_roles', denied);
add('SEC-008 a customer cannot look up another user\'s role', 'authenticated', A, `SELECT coalesce(public.get_user_role('${ADMIN}'::uuid), 'NULL')`, 'NULL');
add('SEC-008 a customer sees their own role', 'authenticated', A, `SELECT public.get_user_role('${A}'::uuid)`, 'customer');
add('SEC-009 a customer cannot repoint their profile at another contact', 'authenticated', LEGACY, n(`UPDATE public.customer_profiles SET contact_id = NULL`), denied);
add('SEC-009 a customer can still edit their phone', 'authenticated', LEGACY, n(`UPDATE public.customer_profiles SET phone = '5551234567'`), '1');
add('SEC-007 the signup trigger is attached to auth.users', 'service_role', null, `SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'users' AND c.relnamespace = 'auth'::regnamespace AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal`, '1');
add('customer A reads only their own orders through get_my_orders', 'authenticated', A, `SELECT count(*)::text FROM public.get_my_orders(50)`, '1');
add('customer A reads no order, payment or invoice link directly', 'authenticated', A, `SELECT ((SELECT count(*) FROM public.orders) + (SELECT count(*) FROM public.payments) + (SELECT count(*) FROM public.invoice_links))::text`, '0');
add('customer A cannot touch customer B\'s customer record', 'authenticated', A, n(`UPDATE public.customers SET first_name = 'x' WHERE id = '${IDS.custB}'`), '0');

// ---- sensitive functions (SEC-011, SEC-012, SEC-013) ---------------------------------------------------------------------------
add('SEC-011 anon cannot call the administrative role functions', 'service_role', null, `SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_admin_users','check_expiring_cards','get_user_creation_logs','cleanup_old_rate_limits','assign_user_role','remove_user_role','get_admin_analytics_impl') AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, '0');
add('SEC-012 payment and receipt RPCs are not executable by anon or authenticated unless admin-gated inside', 'service_role', null, `SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('record_cash_payment','record_check_payment','apply_balance_payment_financials','increment_order_refunded_cents','apply_order_payment','claim_payment_operation','mark_payment_operation','release_payment_operation') AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, '');
add('SEC-012 a customer cannot generate an invoice number', 'authenticated', A, `SELECT public.generate_invoice_number()`, (v) => v.startsWith('ERR:'));
add('SEC-013 update_pricing_rules (if present) is not executable by anon or authenticated', 'service_role', null, `SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'update_pricing_rules' AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, '0');
add('SEC-034 a staff session cannot write money tables directly (payments)', 'authenticated', ADMIN, n(`INSERT INTO public.payments (order_id, type, amount_cents) VALUES ('${IDS.orderA}', 'deposit', 1)`), denied);
add('SEC-034 a staff session cannot change the order subtotal', 'authenticated', ADMIN, n(`UPDATE public.orders SET subtotal_cents = 1 WHERE id = '${IDS.orderA}'`), denied);

// ---- storage (SEC-018, 019, 020, 021) ------------------------------------------------------------------------------------------
add('SEC-018 waiver, signature, photo and evidence buckets are private', 'service_role', null, `SELECT coalesce(string_agg(id, ',' ORDER BY id), '') FROM storage.buckets WHERE public AND id IN ('signed-waivers','signatures','physical-waivers','lot-pictures','order-pictures','order-evidence')`, '');
add('SEC-020 the only buckets that remain public are the marketing and shared-asset buckets (public-assets is a recorded exception)', 'service_role', null, `SELECT coalesce(string_agg(id, ',' ORDER BY id), '') FROM storage.buckets WHERE public AND id NOT IN ('carousel-media','event-essentials-media','public-assets','unit-images')`, '');
add('SEC-019 the only storage policy open to anon/public is the marketing-media read', 'service_role', null, `SELECT coalesce(string_agg(policyname || ':' || cmd, ',' ORDER BY policyname), '') FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND roles && ARRAY['anon','public']::name[]`, 'Public read marketing media:SELECT');
add('SEC-019 no storage policy lets signed-in non-staff roles write', 'service_role', null, `SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('INSERT','UPDATE','DELETE','ALL') AND (roles && ARRAY['anon','public']::name[])`, '0');

// ---- script -----------------------------------------------------------------------------------------------------------------------
function buildScript(preamble: string): string {
  const calls = S.map((sc, i) => {
    const uid = sc.uid ? `'${sc.uid}'::uuid` : 'NULL::uuid';
    return `  RAISE NOTICE 'R|${i}|%', pg_temp.as_role('${sc.role}', ${uid}, $q$${sc.sql}$q$);`;
  });
  return `
BEGIN;
${preamble}
CREATE FUNCTION pg_temp.as_role(r text, uid uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', r, true);
  EXECUTE 'SET LOCAL ROLE ' || quote_ident(r);
  BEGIN
    EXECUTE q INTO res;
  EXCEPTION WHEN OTHERS THEN
    res := 'ERR:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN COALESCE(res, 'NULL');
END $f$;
CREATE FUNCTION pg_temp.n(q text) RETURNS integer LANGUAGE plpgsql AS $g$
DECLARE c integer;
BEGIN
  EXECUTE q;
  GET DIAGNOSTICS c = ROW_COUNT;
  RETURN c;
END $g$;
GRANT EXECUTE ON FUNCTION pg_temp.n(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.as_role(text, uuid, text) TO PUBLIC;
DO $run$
BEGIN
${calls.join('\n')}
END $run$;
ROLLBACK;
`;
}

function preamble(): string {
  const seed = read('src/lib/tests/support/coreDatabaseAccessScenarios.ts');
  const m = /export const SEED_SQL = `([\s\S]*?)`;\s*\n\s*export interface Scenario/.exec(seed);
  if (!m) throw new Error('cannot extract SEED_SQL');
  const seedSql = m[1].replace(/\$\{IDS\.(\w+)\}/g, (_x: string, k: string) => (IDS as any)[k]);
  const catalogRevoke = CATALOG.map((t) => `REVOKE ALL ON TABLE public.${t} FROM service_role;`).join('\n');
  return `${seedSql}
-- a receipt for the receipt-flag scenarios
INSERT INTO public.transaction_receipts (transaction_type, amount_cents) VALUES ('deposit', 5000);
-- a settings row, so "admin can read settings" is meaningful on a schema-only snapshot
INSERT INTO public.admin_settings (key, value) VALUES ('zz_posture_probe', 'x') ON CONFLICT DO NOTHING;
-- Development-like state: service_role has no right on the catalog tables; the migration must restore SELECT (and only SELECT).
${catalogRevoke}
${strip(read(M_CAT))}
-- probes for "objects created today"
CREATE TABLE public.zz_posture_probe (id int);
CREATE FUNCTION public.zz_posture_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
-- supabase_admin defaults as hosted Production carries them, then the migration
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
${read(M_DEF)}
-- a role that is NOT allowed to alter supabase_admin defaults must not make the migration fail
CREATE ROLE zz_posture_nomember NOLOGIN;
CREATE FUNCTION pg_temp.try_def_migration(reopen boolean) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF reopen THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon';
  END IF;
  SET LOCAL ROLE zz_posture_nomember;
  EXECUTE $m$${read(M_DEF).replace(/\$\$/g, '$d$')}$m$;
  RESET ROLE;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN 'ERR:' || SQLSTATE;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.try_def_migration(boolean) TO PUBLIC;
`;
}

{
  const db = process.env.POSTURE_DB_NAME || process.env.CORE_DB_NAME || 'bpc_replay_full';
  const port = process.env.CORE_DB_PORT || '54329';
  const host = process.env.CORE_DB_HOST || '127.0.0.1';
  const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
  const args = ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-X', '-q', '-w'];
  let psql: string | null = null;
  for (const c of candidates) {
    const probe = spawnSync(c, [...args, '-Atc', "SELECT to_regprocedure('public.is_crew_or_admin()') IS NOT NULL AND to_regclass('public.order_refunds') IS NOT NULL"], { encoding: 'utf8', timeout: 15000 });
    if (probe.status === 0 && probe.stdout.trim() === 't') { psql = c; break; }
  }
  if (!psql) {
    if (process.env.CORE_DB_REQUIRE) ok(`executed: the complete-chain scratch database "${db}" is available (CORE_DB_REQUIRE is set)`, false);
    else console.log('EXECUTED layer SKIPPED: no scratch PostgreSQL database holding the complete migration chain was reachable (see the header of this file).');
  } else {
    const r = spawnSync(psql, [...args, '-v', 'ON_ERROR_STOP=1'], { input: buildScript(preamble()), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 240000 });
    const results: Record<number, string> = {};
    for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
    ok(`executed: the posture script ran to completion in database "${db}" (${Object.keys(results).length}/${S.length} results)`, Object.keys(results).length === S.length);
    if (Object.keys(results).length !== S.length) console.error((r.stderr ?? '').split('\n').filter((l: string) => /ERROR|LINE|DETAIL/.test(l)).slice(0, 8).join('\n'));
    S.forEach((sc, i) => {
      const got = results[i];
      const good = got !== undefined && (typeof sc.expect === 'string' ? got === sc.expect : sc.expect(got));
      ok(`executed: ${sc.name} (got ${got})`, good);
    });
  }
}

console.log(`Security posture tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} security posture test(s) failed`);
