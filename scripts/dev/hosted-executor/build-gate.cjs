#!/usr/bin/env node
'use strict';
// Generates audit/step4/s11-gate-checks.sql: the READ-ONLY database checks that must ALL be true on hosted Development (containment still in force) before the
// containment end-state script (audit/security/step4-development-containment-end-state.sql, stage S11) may be proposed for approval.
// The allow-lists below are the accepted Step 3 local posture (anon-executable functions, anon table privileges, bucket privacy), taken from the replayed
// Development-shaped database after the 28 files; the five Step 3B rules are copied verbatim from audit/security/step3b-verification-rules.json.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/security/step3b-verification-rules.json'), 'utf8'));
const arr = (a) => 'ARRAY[' + a.map((x) => "'" + x + "'").join(',') + ']::text[]';
const ANON_FNS = ['check_date_blackout', 'check_product_availability', 'check_unit_availability', 'get_public_business_settings', 'get_public_nav_menu_groups'];
const ANON_TABLES = ['google_reviews:SELECT', 'hero_carousel_images:SELECT', 'inventory_products:SELECT', 'package_inflatable_components:SELECT', 'package_inflatable_eligibility:SELECT', 'pending_signups_consent:INSERT', 'pricing_rules:SELECT', 'product_bundle_components:SELECT', 'product_bundle_excluded_categories:SELECT', 'product_bundles:SELECT', 'product_categories:SELECT', 'product_pricing:SELECT', 'unit_media:SELECT', 'units:SELECT'];
const PUBLIC_BUCKETS = ['carousel-media', 'event-essentials-media', 'unit-images'];
const checks = [
  ['G01 containment still in force before S11: anon and authenticated have no USAGE on public', "NOT has_schema_privilege('anon','public','USAGE') AND NOT has_schema_privilege('authenticated','public','USAGE')"],
  ['G02 the ledger holds exactly the 28 executor rows', "(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%') = 28"],
  ['G03 orders has no policy for anon or public (SEC-001/002/003)', "NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND roles && ARRAY['anon','public']::name[])"],
  ['G04 no policy named like "service role" applies to public, anon or authenticated', "NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname ILIKE '%service role%' AND roles && ARRAY['anon','public','authenticated']::name[])"],
  ['G05 anon-executable public functions equal the accepted allow-list (SEC-010)', `(SELECT coalesce(array_agg(DISTINCT p.proname::text ORDER BY p.proname::text), ARRAY[]::text[]) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND has_function_privilege('anon', p.oid, 'EXECUTE')) = ${arr(ANON_FNS)}`],
  ['G06 anon table privileges equal the accepted allow-list (SEC-014/039)', `(SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) FROM (SELECT c.relname||':'||p AS x FROM pg_class c, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v') AND has_table_privilege('anon', c.oid, p)) z) = ${arr(ANON_TABLES)}`],
  ['G07 no sequence privilege for anon, no UPDATE for authenticated (SEC-014)', "NOT EXISTS (SELECT 1 FROM (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='S' OFFSET 0) c WHERE has_sequence_privilege('anon', c.oid, 'USAGE') OR has_sequence_privilege('anon', c.oid, 'UPDATE') OR has_sequence_privilege('authenticated', c.oid, 'UPDATE'))"],
  ['G08 row level security is on for every public table', "NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)"],
  ['G09 no SECURITY DEFINER function in public lacks a pinned search_path (SEC-037)', "NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%'))"],
  ['G10 no default privilege entry in public or global names anon, authenticated or PUBLIC (SEC-015)', "NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace) AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'))))"],
  ['G11 public buckets are exactly the marketing buckets; every other bucket is private (SEC-018/019)', `(SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::text[]) FROM storage.buckets WHERE public) = ${arr(PUBLIC_BUCKETS)}`],
  ['G12 no storage.objects policy grants INSERT, UPDATE, DELETE or ALL to anon or public (SEC-018)', "NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('INSERT','UPDATE','DELETE','ALL') AND roles && ARRAY['anon','public']::name[])"],
  ['G13 the booking-confirmation guard trigger exists and is enabled on orders (SEC-047)', "EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND tgname='trg_guard_booking_confirmation_columns' AND tgenabled <> 'D')"],
  ['G14 public schema ACL names only postgres and service_role', "(SELECT coalesce(array_agg(g ORDER BY g), ARRAY[]::text[]) FROM (SELECT DISTINCT (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)::text AS g FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname='public') z) = ARRAY['postgres','service_role']::text[]"],
  ['G15 the signup trigger exists on auth.users (20261016120000)', "EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created' AND NOT tgisinternal)"],
];
for (const v of Object.keys(rules).filter((k) => /^\d{14}$/.test(k))) checks.push([`G16 Step 3B ${v}: post_effect_present is true`, rules[v].post_effect_present.replace(/;\s*$/, '')]);
const lines = [];
lines.push('-- Stage S11 GATE: read-only database checks for hosted Development. Generated by scripts/dev/hosted-executor/build-gate.cjs. NOT RUN against any hosted system.');
lines.push('-- Run once, as one statement, after stage S10 and BEFORE the containment end-state script. EVERY row must have ok = true. Any false row, any error, or any missing row keeps containment on.');
lines.push('-- Also required (cannot be expressed in SQL): the executor audit store shows a denied anon and authenticated role probe after every step; `verify` reports the final catalog fingerprint equal to the sealed one.');
lines.push('SELECT id, ok FROM (');
lines.push(checks.map(([id, expr]) => `  SELECT ${"'" + id.replace(/'/g, "''") + "'"}::text AS id, COALESCE((${expr}), false) AS ok`).join('\n  UNION ALL\n'));
lines.push(') g ORDER BY id;');
const out = lines.join('\n') + '\n';
const target = path.join(ROOT, 'audit', 'step4', 's11-gate-checks.sql');
fs.writeFileSync(target, out);
console.log('wrote', target, 'checks', checks.length);
