// Database hardening: future-object privileges, site_events direct writes, get_user_role(uuid), customer_profiles.contact_id.
//
// Migrations under test:
//   20261018120000_restrict_future_database_privileges.sql
//   20261018120100_secure_site_event_ingestion.sql
//   20261018120200_restrict_role_lookup_and_profile_ownership.sql
//
// Layers, labelled so nobody mistakes one for another:
//   STATIC    parses the migration text (always runs).
//   EXECUTED  runs the real SQL against SCRATCH PostgreSQL databases as the real postgres / anon / authenticated / service_role
//             roles with Supabase-style JWT claims, inside a transaction that is rolled back. It never touches a Supabase project.
//               HARD_DB_PRE   a replay of every migration EXCEPT these three (default "hard_pre"); the test applies their text
//               HARD_DB_FULL  a fresh replay of every migration INCLUDING them (default "hard_full")
//             Same host / port / psql variables as the other scratch-database suites. With no reachable database the layer is
//             SKIPPED (an environment limit, not a pass); HARD_DB_REQUIRE=1 (or ROLE_DB_REQUIRE=1) makes that a failure.
//             Environments exercised: a Dev-like project (no default privileges), a hosted-style project (schema default
//             privileges that hand every new object to anon / authenticated), Dev's current overlay (old get_user_role, PUBLIC
//             execute, broad table grants) and a fresh full replay.
// Run: node node_modules/jiti/bin/jiti.js src/lib/databaseHardening.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import { IDS, SEED_SQL } from './coreDatabaseAccessScenarios';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (process.env.HARDENING_SKIP_STATIC && label.startsWith('static:')) return;
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const MIGS = {
  defaults: 'supabase/migrations/20261018120000_restrict_future_database_privileges.sql',
  events: 'supabase/migrations/20261018120100_secure_site_event_ingestion.sql',
  roles: 'supabase/migrations/20261018120200_restrict_role_lookup_and_profile_ownership.sql',
};
const raw = { defaults: read(MIGS.defaults), events: read(MIGS.events), roles: read(MIGS.roles) };
const sql = { defaults: norm(stripSql(raw.defaults)), events: norm(stripSql(raw.events)), roles: norm(stripSql(raw.roles)) };
const allRaw = raw.defaults + '\n' + raw.events + '\n' + raw.roles;
const names: string[] = fs.readdirSync('supabase/migrations').filter((f: string) => f.endsWith('.sql')).sort();

// ---------------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------------
ok('static: the three migrations sort after the booking-confirmation claim migration, in order', (() => {
  const i = names.indexOf('20261017120000_add_booking_confirmation_claim.sql');
  return i >= 0 && names[i + 1] === '20261018120000_restrict_future_database_privileges.sql' && names[i + 2] === '20261018120100_secure_site_event_ingestion.sql' && names[i + 3] === '20261018120200_restrict_role_lookup_and_profile_ownership.sql';
})());
ok('static: file names describe behaviour and carry no internal planning label', names.slice(-3).every((n) => !/phase|stage|a1|a2|priority|security_phase/i.test(n)) && !/\b(Phase|Stage) ?[A-Z0-9]\b|\bA1\b|\bA2\b/.test(allRaw));
ok('static: no earlier migration was edited', names.slice(0, -3).every((n) => !/restrict_future_database_privileges|secure_site_event_ingestion/.test(n)));
ok('static: default privileges target only the proven migration owner role (postgres)', (sql.defaults.match(/ALTER DEFAULT PRIVILEGES FOR ROLE (\w+)/g) ?? []).every((s) => s === 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres') && (sql.defaults.match(/ALTER DEFAULT PRIVILEGES/g) ?? []).length === (sql.defaults.match(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres/g) ?? []).length);
ok('static: the migration documents its cross-schema audit (owners per schema, the extensions exception, the owner-wide statement)', /owner-wide/.test(raw.defaults) && /extensions\s+49 owned by postgres/.test(raw.defaults) && /supabase_auth_admin/.test(raw.defaults) && /never by postgres/.test(raw.defaults) && !/limited to public/i.test(raw.defaults));
ok('static: the application anon / authenticated / service_role defaults are scoped to the public schema; only the PUBLIC function revoke is owner-wide, with the extensions compatibility exception', (() => {
  const stmts = sql.defaults.match(/ALTER DEFAULT PRIVILEGES[^;]*;/g) ?? [];
  const global = stmts.filter((s) => !/IN SCHEMA/.test(s));
  const schemas = stmts.filter((s) => /IN SCHEMA/.test(s)).map((s) => /IN SCHEMA (\w+)/.exec(s)![1]);
  return global.length === 1 && /REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/.test(global[0]) && schemas.every((s) => s === 'public' || s === 'extensions') && schemas.filter((s) => s === 'extensions').length === 1;
})());
ok('static: future objects lose anon / authenticated and service_role keeps the backend access', /IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated/.test(sql.defaults) && /IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated/.test(sql.defaults) && /IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated/.test(sql.defaults) && /IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role/.test(sql.defaults) && /IN SCHEMA public GRANT ALL ON TABLES TO service_role/.test(sql.defaults) && /IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role/.test(sql.defaults));
ok('static: the defaults migration rewrites no existing object (no GRANT / REVOKE on an existing object)', !/(^| )(GRANT|REVOKE)\b(?!.*DEFAULT)/.test(sql.defaults.replace(/ALTER DEFAULT PRIVILEGES[^;]*;/g, '')));
ok('static: site_events: every INSERT / ALL / UPDATE / DELETE policy is dropped and no policy is created', /cmd IN \('INSERT', 'ALL', 'UPDATE', 'DELETE'\)/.test(sql.events) && /DROP POLICY %I ON public\.site_events/.test(sql.events) && !/CREATE POLICY/i.test(sql.events));
ok('static: site_events: anon loses everything, authenticated keeps only SELECT, service_role gets SELECT and INSERT', /REVOKE ALL ON TABLE public\.site_events FROM PUBLIC, anon;/.test(sql.events) && /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public\.site_events FROM authenticated;/.test(sql.events) && /GRANT SELECT ON TABLE public\.site_events TO authenticated;/.test(sql.events) && /GRANT SELECT, INSERT ON TABLE public\.site_events TO service_role;/.test(sql.events));
ok('static: site_events: no row is rewritten and no constraint is added to historical data', !/\b(UPDATE public\.|DELETE FROM|INSERT INTO|ALTER TABLE|ADD CONSTRAINT|CHECK ?\()/i.test(sql.events));
ok('static: get_user_role keeps its signature and return type, is SECURITY DEFINER with a pinned search_path', /CREATE OR REPLACE FUNCTION public\.get_user_role\(user_id_input uuid\) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'/.test(sql.roles));
ok('static: get_user_role answers another user only to the backend (role setting), never from a caller-supplied value', /COALESCE\(current_setting\('role', true\), 'none'\) NOT IN \('service_role', 'none'\)/.test(sql.roles) && /user_id_input <> v_caller/.test(sql.roles) && !/request\.jwt\.claim|raw_user_meta_data|jwt/i.test(sql.roles.slice(sql.roles.indexOf('FUNCTION public.get_user_role'), sql.roles.indexOf('REVOKE ALL ON FUNCTION public.get_user_role'))));
ok('static: get_user_role does not call itself or another helper to authorize', !/get_user_role\(|is_admin\(|user_has_role\(|get_user_highest_role\(/.test(sql.roles.slice(sql.roles.indexOf('BEGIN DECLARE') > 0 ? sql.roles.indexOf('BEGIN DECLARE') : sql.roles.indexOf('DECLARE v_caller'), sql.roles.indexOf('REVOKE ALL ON FUNCTION public.get_user_role'))));
ok('static: get_user_role uses the repository role precedence master, admin, crew, customer and a stable tiebreak', /WHEN 'master' THEN 1 WHEN 'admin' THEN 2 WHEN 'crew' THEN 3 WHEN 'customer' THEN 4 ELSE 5 END, ur\.created_at, ur\.id LIMIT 1/.test(sql.roles) && !/LIMIT 1\) *;\s*RETURN COALESCE\(v_role/.test('') );
ok('static: get_user_role execute is revoked from PUBLIC and anon and kept for authenticated and service_role', /REVOKE ALL ON FUNCTION public\.get_user_role\(uuid\) FROM PUBLIC, anon;/.test(sql.roles) && /GRANT EXECUTE ON FUNCTION public\.get_user_role\(uuid\) TO authenticated, service_role;/.test(sql.roles));
ok('static: customer_profiles: authenticated keeps SELECT and UPDATE only on an explicit list of editable columns', /GRANT SELECT ON TABLE public\.customer_profiles TO authenticated;/.test(sql.roles) && /editable text\[\] := ARRAY\['display_name', 'phone', 'email_notifications', 'sms_notifications', 'first_name', 'last_name', 'updated_at'\]/.test(sql.roles));
ok('static: customer_profiles: contact_id, user_id, id and created_at are not in the editable list', (() => { const m = /editable text\[\] := ARRAY\[([^\]]*)\]/.exec(sql.roles); return !!m && !/contact_id|user_id|'id'|created_at/.test(m[1]); })());
ok('static: customer_profiles: the table-level UPDATE is revoked before the column grants (a column grant cannot subtract)', /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public\.customer_profiles FROM authenticated;/.test(sql.roles) && sql.roles.indexOf('REVOKE INSERT, UPDATE, DELETE, TRUNCATE') < sql.roles.indexOf('GRANT UPDATE ('));
ok('static: no migration here uses dynamic SQL built from caller input or changes another table', !/EXECUTE [^;]*(p_|user_id_input)/.test(allRaw) && !/ALTER TABLE public\.(?!customer_profiles|site_events)/i.test(allRaw));
ok('static: no policy, grant or function outside the four areas is touched', !/(CREATE|DROP) POLICY/i.test(sql.roles) && !/FUNCTION public\.(?!get_user_role)/.test(sql.roles));

// ---------------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------------
const port = process.env.HARD_DB_PORT || process.env.ROLE_DB_PORT || process.env.CORE_DB_PORT || '54329';
const host = process.env.HARD_DB_HOST || process.env.ROLE_DB_HOST || process.env.CORE_DB_HOST || '127.0.0.1';
const dbPre = process.env.HARD_DB_PRE || 'hard_pre';
const dbFull = process.env.HARD_DB_FULL || 'hard_full';
const required = !!(process.env.HARD_DB_REQUIRE || process.env.ROLE_DB_REQUIRE);
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
const argsFor = (db: string) => ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-At', '-X', '-q'];
function findPsql(db: string): string | null {
  for (const c of candidates) {
    const p = spawnSync(c, [...argsFor(db), '-c', "SELECT to_regclass('public.site_events') IS NOT NULL AND to_regclass('public.customer_profiles') IS NOT NULL"], { encoding: 'utf8', timeout: 15000 });
    if (p.status === 0 && p.stdout.trim() === 't') return c;
  }
  return null;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const U = {
  admin: IDS.uAdmin,
  crew: IDS.uCrew,
  a: IDS.uA,
  b: IDS.uB,
  legacy: IDS.uLegacy,
  master: '00000000-0000-4000-8000-0000000000e1',
  multi: '00000000-0000-4000-8000-0000000000e2',
  twoTop: '00000000-0000-4000-8000-0000000000e3',
  mixed: '00000000-0000-4000-8000-0000000000e4',
  nobody: '00000000-0000-4000-8000-0000000000e5',
  crewCust: '00000000-0000-4000-8000-0000000000e6',
  unknown: '00000000-0000-4000-8000-0000000000ff',
};
const CONTACT_A = '00000000-0000-4000-8000-00000000c0a1'; // exists, belongs to no customer
const CONTACT_LEGACY = IDS.contactLegacy; // belongs to the historical customer (the target of the attack)
const PRE_USER = '55555555-0000-4000-8000-000000000001';
const PRE_CONTACT = '66666666-0000-4000-8000-000000000001';
// Data that exists BEFORE the migrations are applied (historical analytics rows, a profile with a contact link) and must come through untouched.
const PRE_DATA = `
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email) VALUES ('${PRE_USER}', 'pre.existing@example.com');
INSERT INTO public.contacts (id, email, first_name, last_name, customer_id) VALUES ('${PRE_CONTACT}', 'pre.existing.contact@example.com', 'Pre', 'Existing', NULL);
INSERT INTO public.customer_profiles (user_id, contact_id, display_name) VALUES ('${PRE_USER}', '${PRE_CONTACT}', 'Pre Existing');
INSERT INTO public.site_events (event_name, session_id, page_path, metadata) VALUES ('quote_submitted', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '/quote', '{}'::jsonb), ('unit_view', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '/units/x', '{"name":"X","slug":"x"}'::jsonb);
`;
const PROFILE_FIXTURE = `
INSERT INTO auth.users (id, email) VALUES
  ('${U.master}', 'master@example.com'), ('${U.multi}', 'multi@example.com'), ('${U.twoTop}', 'twotop@example.com'),
  ('${U.mixed}', 'mixed@example.com'), ('${U.nobody}', 'nobody@example.com'), ('${U.crewCust}', 'crewcust@example.com');
INSERT INTO public.user_roles (user_id, role, created_at) VALUES
  ('${U.master}', 'master', now()),
  ('${U.multi}', 'customer', now() - interval '3 minutes'), ('${U.multi}', 'crew', now() - interval '2 minutes'), ('${U.multi}', 'admin', now() - interval '1 minute'),
  ('${U.twoTop}', 'admin', now() - interval '2 minutes'), ('${U.twoTop}', 'master', now() - interval '1 minute'),
  ('${U.crewCust}', 'customer', now() - interval '2 minutes'), ('${U.crewCust}', 'crew', now() - interval '1 minute');
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
INSERT INTO public.user_roles (user_id, role) VALUES ('${U.mixed}', ' Admin ');
INSERT INTO public.customer_profiles (user_id, contact_id, display_name, phone) VALUES ('${U.a}', NULL, 'Ann', '5550000001'), ('${U.b}', NULL, 'Bob', '5550000002');
INSERT INTO public.site_events (event_name, session_id, page_path, metadata) VALUES ('quote_started', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '/quote', '{}'::jsonb);
`;

interface Step {
  name: string;
  role: 'postgres' | 'anon' | 'authenticated' | 'service_role';
  uid?: string | null;
  sql: string;
  setup?: string;
  expect: string | ((v: string) => boolean);
  needsApply?: boolean; // compares with the state before the migrations were applied
  exploit?: boolean; // only meaningful in the "before the fix" run
}
const steps: Step[] = [];
const add = (name: string, role: Step['role'], uid: string | null, sqlText: string, expect: Step['expect'], extra: Partial<Step> = {}) => steps.push({ name, role, uid, sql: sqlText, expect, ...extra });
const DENIED = 'ERR:42501';
const cnt = (stmt: string) => `SELECT pg_temp.cnt(${q(stmt)})`;
const execRole = (role: string, fn: string) => `has_function_privilege('${role}', '${fn}', 'EXECUTE')`;

// ---- default privileges --------------------------------------------------------------------------------------------
const DP_SETUP = `
CREATE FUNCTION public.zz_dp_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1';
CREATE TABLE public.zz_dp_tbl (id integer);
CREATE SEQUENCE public.zz_dp_seq;
CREATE FUNCTION extensions.zz_dpx_fn() RETURNS integer LANGUAGE sql AS 'SELECT 2';
`;
const publicHasFn = (fn: string) => `SELECT (proacl IS NULL OR coalesce(proacl::text, '') ~ '(^|[{,])=X')::text FROM pg_proc WHERE oid = '${fn}'::regprocedure`;
add('new function: PUBLIC cannot execute it merely because it exists', 'postgres', null, publicHasFn('public.zz_dp_fn()'), 'false', { setup: DP_SETUP });
add('new function: anon cannot execute it', 'postgres', null, `SELECT ${execRole('anon', 'public.zz_dp_fn()')}::text`, 'false');
add('new function: authenticated cannot execute it', 'postgres', null, `SELECT ${execRole('authenticated', 'public.zz_dp_fn()')}::text`, 'false');
add('new function: service_role can execute it', 'postgres', null, `SELECT ${execRole('service_role', 'public.zz_dp_fn()')}::text`, 'true');
add('new function: calling it as anon is denied', 'anon', null, 'SELECT public.zz_dp_fn()::text', DENIED);
add('new function: calling it as authenticated is denied', 'authenticated', U.a, 'SELECT public.zz_dp_fn()::text', DENIED);
add('new function: calling it as service_role works', 'service_role', null, 'SELECT public.zz_dp_fn()::text', '1');
add('new table: anon holds no privilege on it', 'postgres', null, `SELECT (has_table_privilege('anon', 'public.zz_dp_tbl', 'SELECT') OR has_table_privilege('anon', 'public.zz_dp_tbl', 'INSERT') OR has_table_privilege('anon', 'public.zz_dp_tbl', 'UPDATE') OR has_table_privilege('anon', 'public.zz_dp_tbl', 'DELETE'))::text`, 'false');
add('new table: authenticated holds no privilege on it', 'postgres', null, `SELECT (has_table_privilege('authenticated', 'public.zz_dp_tbl', 'SELECT') OR has_table_privilege('authenticated', 'public.zz_dp_tbl', 'INSERT') OR has_table_privilege('authenticated', 'public.zz_dp_tbl', 'UPDATE') OR has_table_privilege('authenticated', 'public.zz_dp_tbl', 'DELETE'))::text`, 'false');
add('new table: service_role has full backend access', 'postgres', null, `SELECT (has_table_privilege('service_role', 'public.zz_dp_tbl', 'SELECT') AND has_table_privilege('service_role', 'public.zz_dp_tbl', 'INSERT') AND has_table_privilege('service_role', 'public.zz_dp_tbl', 'UPDATE') AND has_table_privilege('service_role', 'public.zz_dp_tbl', 'DELETE'))::text`, 'true');
add('new table: anon reading it is denied', 'anon', null, 'SELECT count(*)::text FROM public.zz_dp_tbl', DENIED);
add('new table: authenticated writing it is denied', 'authenticated', U.a, cnt('INSERT INTO public.zz_dp_tbl VALUES (1)'), DENIED);
add('new table: service_role can write and read it', 'service_role', null, 'WITH i AS (INSERT INTO public.zz_dp_tbl VALUES (1) RETURNING 1) SELECT count(*)::text FROM i', '1');
add('new sequence: anon and authenticated hold no privilege on it', 'postgres', null, `SELECT (has_sequence_privilege('anon', 'public.zz_dp_seq', 'USAGE') OR has_sequence_privilege('anon', 'public.zz_dp_seq', 'SELECT') OR has_sequence_privilege('anon', 'public.zz_dp_seq', 'UPDATE') OR has_sequence_privilege('authenticated', 'public.zz_dp_seq', 'USAGE') OR has_sequence_privilege('authenticated', 'public.zz_dp_seq', 'SELECT') OR has_sequence_privilege('authenticated', 'public.zz_dp_seq', 'UPDATE'))::text`, 'false');
add('new sequence: service_role can use it', 'postgres', null, `SELECT (has_sequence_privilege('service_role', 'public.zz_dp_seq', 'USAGE') AND has_sequence_privilege('service_role', 'public.zz_dp_seq', 'SELECT') AND has_sequence_privilege('service_role', 'public.zz_dp_seq', 'UPDATE'))::text`, 'true');
add('new sequence: anon cannot advance it', 'anon', null, "SELECT nextval('public.zz_dp_seq')::text", DENIED);
add('new sequence: service_role can advance it', 'service_role', null, "SELECT nextval('public.zz_dp_seq')::text", '1');
add('a function in the extensions schema keeps PUBLIC execute (extension installs are not broken)', 'postgres', null, publicHasFn('extensions.zz_dpx_fn()'), 'true');
add('a future postgres-owned function in an unrelated schema also starts closed (the owner-wide PUBLIC revoke is intentional)', 'postgres', null, publicHasFn('zz_other.zz_fn()'), 'false', { setup: "CREATE SCHEMA zz_other; CREATE FUNCTION zz_other.zz_fn() RETURNS integer LANGUAGE sql AS 'SELECT 3';" });
add('... and anon / authenticated cannot execute it', 'postgres', null, `SELECT (${execRole('anon', 'zz_other.zz_fn()')} OR ${execRole('authenticated', 'zz_other.zz_fn()')})::text`, 'false');
add('the owner-wide default is scoped to the owner: a function created by ANOTHER role keeps the built-in PUBLIC execute (Supabase-owned schemas are unaffected)', 'postgres', null, publicHasFn('public.zz_other_owner_fn()'), 'true',
  { setup: "CREATE ROLE zz_other_owner NOLOGIN; GRANT CREATE ON SCHEMA public TO zz_other_owner; SET LOCAL ROLE zz_other_owner; CREATE FUNCTION public.zz_other_owner_fn() RETURNS integer LANGUAGE sql AS 'SELECT 4'; RESET ROLE;" });
add('the same applies to the table default: a table created by another role gets no application defaults', 'postgres', null, "SELECT (has_table_privilege('service_role', 'public.zz_other_owner_tbl', 'SELECT'))::text", 'false',
  { setup: "SET LOCAL ROLE zz_other_owner; CREATE TABLE public.zz_other_owner_tbl (id integer); RESET ROLE;" });
add('an explicit GRANT can still deliberately open a new function to anon and authenticated', 'anon', null, 'SELECT public.zz_dp_fn()::text', '1', { setup: 'GRANT EXECUTE ON FUNCTION public.zz_dp_fn() TO anon, authenticated;' });
add('... and authenticated can then call it as well', 'authenticated', U.a, 'SELECT public.zz_dp_fn()::text', '1');
add('an explicit GRANT can still deliberately open a new table for reading', 'anon', null, 'SELECT count(*)::text FROM public.zz_dp_tbl', '1', { setup: 'GRANT SELECT ON public.zz_dp_tbl TO anon;' });
add('... but only what was granted: writing it is still denied', 'anon', null, cnt('INSERT INTO public.zz_dp_tbl VALUES (2)'), DENIED);
add('a function created by the migration owner after an explicit REVOKE ALL / GRANT pair behaves exactly as granted', 'postgres', null, `SELECT (NOT ${execRole('anon', 'public.zz_dp_fn()')})::text`, 'false');
add('no existing public object had its privileges changed by the three migrations (outside get_user_role, site_events, customer_profiles)', 'postgres', null,
  `SELECT count(*)::text FROM (
     SELECT 'f:' || p.oid::regprocedure::text AS n, p.proacl::text AS a FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname NOT IN ('zz_dp_fn')
     UNION ALL SELECT 't:' || c.relname, c.relacl::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','S') AND c.relname NOT IN ('zz_dp_tbl','zz_dp_seq')
   ) after
   FULL JOIN pg_temp.acl_before before ON before.n = after.n
   WHERE after.a IS DISTINCT FROM before.a AND coalesce(after.n, before.n) NOT IN ('f:get_user_role(uuid)', 't:site_events', 't:customer_profiles')`, '0', { needsApply: true });

// ---- site_events ---------------------------------------------------------------------------------------------------
const insertEvent = "INSERT INTO public.site_events (event_name, session_id, page_path) VALUES ('page_view', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '/')";
add('site_events: anonymous direct INSERT is denied', 'anon', null, cnt(insertEvent), DENIED, { setup: PROFILE_FIXTURE });
add('site_events: anonymous INSERT with an order and unit reference is denied too (no id probing)', 'anon', null, cnt(`INSERT INTO public.site_events (event_name, order_id, unit_id) VALUES ('page_view', '${IDS.orderA}', '${IDS.unitActive}')`), DENIED);
add('site_events: a signed-in customer cannot insert directly', 'authenticated', U.a, cnt(insertEvent), DENIED);
add('site_events: Admin cannot insert directly either (only the backend writes)', 'authenticated', U.admin, cnt(insertEvent), DENIED);
add('site_events: anonymous UPDATE is denied', 'anon', null, cnt("UPDATE public.site_events SET event_name = 'x'"), DENIED);
add('site_events: anonymous DELETE is denied', 'anon', null, cnt('DELETE FROM public.site_events'), DENIED);
add('site_events: anonymous TRUNCATE is denied', 'anon', null, cnt('TRUNCATE public.site_events'), DENIED);
add('site_events: a signed-in customer cannot DELETE', 'authenticated', U.a, cnt('DELETE FROM public.site_events'), DENIED);
add('site_events: a signed-in customer cannot TRUNCATE', 'authenticated', U.a, cnt('TRUNCATE public.site_events'), DENIED);
add('site_events: anonymous SELECT is denied', 'anon', null, 'SELECT count(*)::text FROM public.site_events', DENIED);
add('site_events: the backend (service_role) can insert', 'service_role', null, `WITH i AS (${insertEvent} RETURNING 1) SELECT count(*)::text FROM i`, '1');
add('site_events: the backend can insert with unit, order and metadata', 'service_role', null, `WITH i AS (INSERT INTO public.site_events (event_name, session_id, unit_id, order_id, page_path, metadata) VALUES ('unit_view', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${IDS.unitActive}', '${IDS.orderA}', '/unit/x', '{"name":"n","slug":"s"}'::jsonb) RETURNING 1) SELECT count(*)::text FROM i`, '1');
add('site_events: the server clock stamps created_at', 'postgres', null, "SELECT (count(*) FILTER (WHERE created_at IS NULL) = 0)::text FROM public.site_events", 'true');
add('site_events: the backend (service_role) can read events', 'service_role', null, 'SELECT count(*)::text FROM public.site_events', (v) => Number(v) >= 2);
add('site_events: rows that existed before the migrations are all still there', 'postgres', null, "SELECT count(*)::text FROM public.site_events WHERE session_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'", '2');
add('site_events: Admin can still read events (Site Analytics)', 'authenticated', U.admin, 'SELECT count(*)::text FROM public.site_events', (v) => Number(v) >= 1);
add('site_events: Master can still read events', 'authenticated', U.master, 'SELECT count(*)::text FROM public.site_events', (v) => Number(v) >= 1);
add('site_events: historical rows (an older event name) are still readable', 'authenticated', U.admin, "SELECT count(*)::text FROM public.site_events WHERE event_name = 'quote_started'", '1');
add('site_events: the Site Analytics unit query (join to units) still works for Admin', 'authenticated', U.admin, "SELECT count(*)::text FROM (SELECT se.unit_id, u.name FROM public.site_events se LEFT JOIN public.units u ON u.id = se.unit_id WHERE se.event_name = 'unit_view' AND se.created_at >= now() - interval '1 day') x", (v) => Number(v) >= 0);
add('site_events: the Site Analytics daily-session query still works for Admin', 'authenticated', U.admin, 'SELECT count(DISTINCT session_id)::text FROM public.site_events WHERE created_at >= date_trunc(\'day\', now())', (v) => Number(v) >= 0);
add('site_events: a customer can read nothing (the Admin-only policy still applies)', 'authenticated', U.a, 'SELECT count(*)::text FROM public.site_events', '0');
add('site_events: no INSERT / UPDATE / DELETE / ALL policy remains', 'postgres', null, "SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'site_events' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')", '0');
add('site_events: exactly one policy remains, the Admin read policy', 'postgres', null, "SELECT string_agg(policyname || ':' || cmd, ',') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'site_events'", 'Admins can read site events:SELECT');
add('site_events: anon holds no table privilege and authenticated holds only SELECT', 'postgres', null,
  "SELECT coalesce((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'site_events' AND grantee = 'anon'), 'none') || '/' || coalesce((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'site_events' AND grantee = 'authenticated'), 'none')", 'none/SELECT');
add('site_events: the four analytics indexes are untouched', 'postgres', null, "SELECT count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'site_events' AND indexname IN ('idx_site_events_event_name','idx_site_events_created_at','idx_site_events_unit_id','idx_site_events_session_id')", '4');
add('site_events: row level security is still on', 'postgres', null, "SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.site_events'::regclass", 'true');

// ---- get_user_role -------------------------------------------------------------------------------------------------
const gur = (id: string | null) => `SELECT coalesce(public.get_user_role(${id === null ? 'NULL::uuid' : `'${id}'`}), 'NULL')`;
add('get_user_role: anonymous asking about themselves is denied', 'anon', null, gur(U.a), DENIED);
add('get_user_role: anonymous asking about another user is denied', 'anon', null, gur(U.admin), DENIED);
add('get_user_role: customer A asking about A gets the customer role', 'authenticated', U.a, gur(U.a), 'customer');
add('get_user_role: customer A asking about customer B gets nothing', 'authenticated', U.a, gur(U.b), 'NULL');
add('get_user_role: customer A asking about an Admin gets nothing (no role enumeration)', 'authenticated', U.a, gur(U.admin), 'NULL');
add('get_user_role: customer A asking about a Master gets nothing', 'authenticated', U.a, gur(U.master), 'NULL');
add('get_user_role: customer A asking about an unknown id gets nothing (same as any other id)', 'authenticated', U.a, gur(U.unknown), 'NULL');
add('get_user_role: customer B asking about A gets nothing', 'authenticated', U.b, gur(U.a), 'NULL');
add('get_user_role: Crew asking about themselves', 'authenticated', U.crew, gur(U.crew), 'crew');
add('get_user_role: Crew asking about another user gets nothing', 'authenticated', U.crew, gur(U.a), 'NULL');
add('get_user_role: Admin asking about themselves', 'authenticated', U.admin, gur(U.admin), 'admin');
add('get_user_role: Admin asking about another user gets nothing (no current Admin workflow needs it)', 'authenticated', U.admin, gur(U.a), 'NULL');
add('get_user_role: Master asking about themselves', 'authenticated', U.master, gur(U.master), 'master');
add('get_user_role: Master asking about another user gets nothing', 'authenticated', U.master, gur(U.admin), 'NULL');
add('get_user_role: a privileged database session (no role switched, e.g. maintenance or a scheduled job) can still ask about anyone', 'postgres', null, gur(U.admin), 'admin');
add('get_user_role: the backend asks about a customer','service_role', null, gur(U.a), 'customer');
add('get_user_role: the backend asks about Crew', 'service_role', null, gur(U.crew), 'crew');
add('get_user_role: the backend asks about an Admin', 'service_role', null, gur(U.admin), 'admin');
add('get_user_role: the backend asks about a Master', 'service_role', null, gur(U.master), 'master');
add('get_user_role: the backend asks about an unknown id and gets the customer default (unchanged)', 'service_role', null, gur(U.unknown), 'customer');
add('get_user_role: a user with no role row is a customer (backend)', 'service_role', null, gur(U.nobody), 'customer');
add('get_user_role: a NULL id answers customer for a signed-in user (unchanged)', 'authenticated', U.a, gur(null), 'customer');
add('get_user_role: a NULL id answers customer for the backend (unchanged)', 'service_role', null, gur(null), 'customer');
add('get_user_role: several role rows - master and admin: master wins, regardless of row order', 'service_role', null, gur(U.twoTop), 'master');
add('get_user_role: several role rows - customer, crew and admin: admin wins', 'service_role', null, gur(U.multi), 'admin');
add('get_user_role: the same precedence applies when the user asks about themselves', 'authenticated', U.multi, gur(U.multi), 'admin');
add('get_user_role: several role rows - customer and crew: crew wins', 'service_role', null, gur(U.crewCust), 'crew');
add('get_user_role: a historical mixed-case row (" Admin ") is returned normalised', 'service_role', null, gur(U.mixed), 'admin');
add('get_user_role: a role value claimed in the JWT does not let a customer ask about others', 'authenticated', U.a, `SELECT set_config('request.jwt.claim.role', 'service_role', true) IS NOT NULL AND public.get_user_role('${U.admin}') IS NULL`, 'true');
add('get_user_role: anon cannot execute, authenticated and service_role can, PUBLIC cannot', 'postgres', null, `SELECT concat_ws('/', ${execRole('anon', 'public.get_user_role(uuid)')}::text, ${execRole('authenticated', 'public.get_user_role(uuid)')}::text, ${execRole('service_role', 'public.get_user_role(uuid)')}::text, (SELECT (proacl IS NULL OR coalesce(proacl::text, '') ~ '(^|[{,])=X')::text FROM pg_proc WHERE oid = 'public.get_user_role(uuid)'::regprocedure))`, 'false/true/true/false');
add('get_user_role: row level security that relies on it still works - an Admin reads all roles, a customer only their own', 'authenticated', U.admin, 'SELECT (SELECT count(*) FROM public.user_roles) > (SELECT 1)', 'true');
add('get_user_role: ... and a customer sees only their own role row', 'authenticated', U.a, 'SELECT count(*)::text FROM public.user_roles', '1');
add('get_user_role: the function is SECURITY DEFINER with a pinned search_path', 'postgres', null, "SELECT (prosecdef AND proconfig::text ~ 'search_path=public')::text FROM pg_proc WHERE oid = 'public.get_user_role(uuid)'::regprocedure", 'true');

// ---- customer_profiles ---------------------------------------------------------------------------------------------
const ownIds = 'SELECT count(*)::text FROM public.current_customer_ids()';
add('profile: a pre-existing profile keeps its contact link (no data was changed)', 'postgres', null, `SELECT contact_id::text FROM public.customer_profiles WHERE user_id = '${PRE_USER}'`, PRE_CONTACT);
add('profile: customer A reads their own profile', 'authenticated', U.a, 'SELECT count(*)::text FROM public.customer_profiles', '1');
add('profile: customer A cannot read B\'s profile', 'authenticated', U.a, `SELECT count(*)::text FROM public.customer_profiles WHERE user_id = '${U.b}'`, '0');
add('profile: customer A can edit their display name', 'authenticated', U.a, cnt("UPDATE public.customer_profiles SET display_name = 'Ann Updated'"), '1');
add('profile: customer A can edit their phone', 'authenticated', U.a, cnt("UPDATE public.customer_profiles SET phone = '5551112222'"), '1');
add('profile: customer A can edit notification preferences', 'authenticated', U.a, cnt('UPDATE public.customer_profiles SET email_notifications = false, sms_notifications = false'), '1');
add('profile: customer A can edit first and last name', 'authenticated', U.a, cnt("UPDATE public.customer_profiles SET first_name = 'Ann', last_name = 'Adams', updated_at = now()"), '1');
add('profile: customer A cannot point contact_id at another customer\'s contact', 'authenticated', U.a, cnt(`UPDATE public.customer_profiles SET contact_id = '${CONTACT_LEGACY}'`), DENIED);
add('profile: customer A cannot clear contact_id', 'authenticated', U.a, cnt('UPDATE public.customer_profiles SET contact_id = NULL'), DENIED);
add('profile: customer A cannot set contact_id to an arbitrary id', 'authenticated', U.a, cnt("UPDATE public.customer_profiles SET contact_id = '99999999-9999-4999-8999-999999999999'"), DENIED);
add('profile: customer A cannot set contact_id to their own existing value either (the column is not writable at all)', 'authenticated', U.a, cnt('UPDATE public.customer_profiles SET contact_id = contact_id'), DENIED);
add('profile: customer A cannot re-point user_id at B', 'authenticated', U.a, cnt(`UPDATE public.customer_profiles SET user_id = '${U.b}'`), DENIED);
add('profile: customer A cannot change the profile id or created_at', 'authenticated', U.a, cnt("UPDATE public.customer_profiles SET created_at = now() - interval '5 years'"), DENIED);
add('profile: a mixed update that includes contact_id fails as a whole', 'authenticated', U.a, cnt(`UPDATE public.customer_profiles SET display_name = 'Hacked', contact_id = '${CONTACT_LEGACY}'`), DENIED);
add('profile: ... and the display name was not changed by the failed mixed update', 'postgres', null, `SELECT display_name FROM public.customer_profiles WHERE user_id = '${U.a}'`, 'Ann Updated');
add('profile: customer A cannot edit B\'s profile (row level security)', 'authenticated', U.a, cnt(`UPDATE public.customer_profiles SET display_name = 'x' WHERE user_id = '${U.b}'`), '0');
add('profile: customer A cannot insert a profile for themselves or others', 'authenticated', U.a, cnt(`INSERT INTO public.customer_profiles (user_id, contact_id) VALUES ('${U.nobody}', '${CONTACT_LEGACY}')`), DENIED);
add('profile: customer A cannot delete a profile', 'authenticated', U.a, cnt('DELETE FROM public.customer_profiles'), DENIED);
add('profile: anonymous cannot read or write profiles', 'anon', null, 'SELECT count(*)::text FROM public.customer_profiles', DENIED);
add('profile: after all those attempts customer A still owns only their own customer record', 'authenticated', U.a, ownIds, '1');
add('profile: ... and the historical customer\'s order is not visible to customer A', 'authenticated', U.a, `SELECT count(*)::text FROM public.get_my_orders(50) r WHERE r->>'id' = '${IDS.orderLegacy}'`, '0');
add('profile: ... while customer A\'s own order still is', 'authenticated', U.a, `SELECT count(*)::text FROM public.get_my_orders(50) r WHERE r->>'id' = '${IDS.orderA}'`, '1');
add('profile: the historical account (profile -> contact -> customer) still owns its customer', 'authenticated', U.legacy, ownIds, '1');
add('profile: ... and still sees its historical order', 'authenticated', U.legacy, `SELECT count(*)::text FROM public.get_my_orders(50) r WHERE r->>'id' = '${IDS.orderLegacy}'`, '1');
add('profile: the historical account cannot move its link to someone else\'s contact', 'authenticated', U.legacy, cnt(`UPDATE public.customer_profiles SET contact_id = '${CONTACT_A}'`), DENIED);
add('profile: the backend can set contact_id (sign-up / server linking)', 'service_role', null, cnt(`UPDATE public.customer_profiles SET contact_id = '${CONTACT_A}' WHERE user_id = '${U.b}'`), '1');
add('profile: the backend can create a profile', 'service_role', null, cnt(`INSERT INTO public.customer_profiles (user_id, contact_id) VALUES ('${U.nobody}', NULL)`), '1');
add('profile: sign-up still provisions a profile with its contact link (trigger-run function)', 'postgres', null,
  "SELECT (cp.contact_id IS NOT NULL)::text FROM public.customer_profiles cp WHERE cp.user_id = '44444444-0000-4000-8000-000000000001'", 'true',
  { setup: "ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created; INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('44444444-0000-4000-8000-000000000001', 'signup.new@example.com', '{\"first_name\":\"Sue\",\"last_name\":\"Signup\"}'::jsonb);" });
add('profile: Admin can still read all profiles', 'authenticated', U.admin, 'SELECT count(*)::text FROM public.customer_profiles', (v) => Number(v) >= 3);
add('profile: Admin cannot edit another user\'s profile through the API (no such policy existed)', 'authenticated', U.admin, cnt("UPDATE public.customer_profiles SET display_name = 'x'"), '0');
add('profile: authenticated UPDATE is limited to the editable columns', 'postgres', null, "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'customer_profiles' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'", 'display_name,email_notifications,first_name,last_name,phone,sms_notifications,updated_at');
add('profile: contact_id is not writable by anon or authenticated', 'postgres', null, "SELECT count(*)::text FROM (VALUES ('anon'), ('authenticated')) r(role) WHERE has_column_privilege(r.role, 'public.customer_profiles', 'contact_id', 'UPDATE') OR has_column_privilege(r.role, 'public.customer_profiles', 'contact_id', 'INSERT')", '0');
add('profile: service_role keeps full access', 'postgres', null, "SELECT (has_table_privilege('service_role', 'public.customer_profiles', 'SELECT') AND has_table_privilege('service_role', 'public.customer_profiles', 'INSERT') AND has_table_privilege('service_role', 'public.customer_profiles', 'UPDATE') AND has_table_privilege('service_role', 'public.customer_profiles', 'DELETE'))::text", 'true');
add('profile: the own-profile row policies are untouched', 'postgres', null, "SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_profiles'", 'Admins can view all profiles,Users can update own profile,Users can view own profile');

// The same attack before the fix, to show it is real: only run in the "before the migrations" environment.
const exploitSteps: Step[] = [
  { name: 'EXPLOIT (before the fix): customer A CAN point contact_id at the historical customer\'s contact', role: 'authenticated', uid: U.a, sql: cnt(`UPDATE public.customer_profiles SET contact_id = '${CONTACT_LEGACY}'`), expect: '1', setup: PROFILE_FIXTURE, exploit: true },
  { name: 'EXPLOIT (before the fix): ... and then owns that customer\'s record', role: 'authenticated', uid: U.a, sql: ownIds, expect: '2', exploit: true },
  { name: 'EXPLOIT (before the fix): ... and sees that customer\'s order', role: 'authenticated', uid: U.a, sql: `SELECT count(*)::text FROM public.get_my_orders(50) r WHERE r->>'id' = '${IDS.orderLegacy}'`, expect: '1', exploit: true },
  { name: 'EXPLOIT (before the fix): any signed-in customer can ask for an Admin\'s role', role: 'authenticated', uid: U.a, sql: gur(U.admin), expect: (v) => v.toLowerCase() === 'admin', exploit: true },
  { name: 'EXPLOIT (before the fix): anonymous visitors can insert site events directly', role: 'anon', uid: null, sql: cnt(insertEvent), expect: '1', exploit: true },
];

// The scratch databases are replayed with hosted-style default privileges (so tables carry the grants Dev's tables carry). A Dev-like
// project is modelled by clearing those defaults first; a hosted-style one keeps them.
const PRIV_VARIANTS = {
  devLike: `
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
-- and the tables this work touches carry no explicit grant for the backend or for signed-in users, so the migrations must provide it
REVOKE ALL ON TABLE public.site_events, public.customer_profiles FROM service_role, authenticated;
`,
  hosted: '',
};
// Dev today: the old get_user_role (lower-cases, 'customer' default), PUBLIC execute, broad table grants.
const DEV_OVERLAY = `
CREATE OR REPLACE FUNCTION public.get_user_role(user_id_input uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ SELECT COALESCE((SELECT LOWER(role) FROM user_roles WHERE user_id = user_id_input LIMIT 1), 'customer'); $f$;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO PUBLIC, anon;
GRANT ALL ON TABLE public.site_events, public.customer_profiles TO anon, authenticated;
-- worst case on site_events: a PUBLIC grant and a blanket policy that covers every command
GRANT INSERT, UPDATE, DELETE ON TABLE public.site_events TO PUBLIC;
CREATE POLICY zz_open_all ON public.site_events FOR ALL TO public USING (true) WITH CHECK (true);
`;

function script(list: Step[], opts: { apply: boolean; variant?: string; overlay?: string }): string {
  const calls = list.map((s, i) => {
    const setup = s.setup ? `  EXECUTE ${q(s.setup)};\n` : '';
    return `${setup}  RAISE NOTICE 'R|${i}|%', pg_temp.as_role(${q(s.role)}, ${s.uid ? `'${s.uid}'::uuid` : 'NULL::uuid'}, ${q(s.sql)});`;
  });
  const apply = opts.apply ? `${raw.defaults}\n${raw.events}\n${raw.roles}\n` : '';
  return `
BEGIN;
${opts.variant ?? ''}
${opts.overlay ?? ''}
CREATE TEMP TABLE acl_before AS
  SELECT 'f:' || p.oid::regprocedure::text AS n, p.proacl::text AS a FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL SELECT 't:' || c.relname, c.relacl::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','S');
${PRE_DATA}
${apply}
${SEED_SQL}
CREATE FUNCTION pg_temp.as_role(r text, uid uuid, qry text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', r, true);
  IF r <> 'postgres' THEN EXECUTE 'SET LOCAL ROLE ' || quote_ident(r); END IF;
  BEGIN
    EXECUTE qry INTO res;
  EXCEPTION WHEN OTHERS THEN
    res := 'ERR:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN COALESCE(res, 'NULL');
END $f$;
CREATE FUNCTION pg_temp.cnt(stmt text) RETURNS text LANGUAGE plpgsql AS $g$
DECLARE c integer;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS c = ROW_COUNT;
  RETURN c::text;
END $g$;
GRANT EXECUTE ON FUNCTION pg_temp.as_role(text, uuid, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.cnt(text) TO PUBLIC;
DO $run$
BEGIN
${calls.join('\n')}
END $run$;
ROLLBACK;
`;
}

function execute(psql: string, db: string, label: string, list: Step[], opts: { apply: boolean; variant?: string; overlay?: string }) {
  const r = spawnSync(psql, [...argsFor(db), '-v', 'ON_ERROR_STOP=1'], { input: script(list, opts), encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, timeout: 240000 });
  const results: Record<number, string> = {};
  for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
  const done = Object.keys(results).length === list.length;
  ok(`executed [${label}]: the script ran to completion in "${db}" (${Object.keys(results).length}/${list.length} results)`, done);
  if (!done) console.error(((r.stderr ?? '') as string).split('\n').filter((l: string) => /ERROR|FATAL|DETAIL|CONTEXT/.test(l)).slice(0, 6).join('\n'));
  list.forEach((s, i) => {
    const got = results[i];
    const good = got !== undefined && (typeof s.expect === 'string' ? got === s.expect : s.expect(got));
    ok(`executed [${label}]: ${s.name} (got ${got})`, good);
  });
}

const preAvailable = findPsql(dbPre);
const fullAvailable = findPsql(dbFull);
if (!preAvailable || !fullAvailable) {
  if (required) ok(`executed: scratch databases "${dbPre}" and "${dbFull}" are available (HARD_DB_REQUIRE / ROLE_DB_REQUIRE is set)`, false);
  else console.log('EXECUTED layer SKIPPED: the scratch databases for the hardening tests were not reachable (see the header of this file).');
} else {
  // The three migrations' text applied on top of every older migration - in a Dev-like project and in a hosted-style one.
  execute(preAvailable, dbPre, 'older migrations + these migrations, Dev-like project (no default privileges)', steps, { apply: true, variant: PRIV_VARIANTS.devLike });
  execute(preAvailable, dbPre, 'older migrations + these migrations, hosted-style default privileges', steps, { apply: true, variant: PRIV_VARIANTS.hosted });
  // Dev's current shape (old get_user_role with PUBLIC execute, broad table grants) with only the new migrations on top.
  execute(preAvailable, dbPre, 'Dev-like overlay + these migrations', steps, { apply: true, variant: PRIV_VARIANTS.devLike, overlay: DEV_OVERLAY });
  execute(preAvailable, dbPre, 'Dev-like overlay + these migrations, hosted-style defaults too', steps, { apply: true, variant: PRIV_VARIANTS.hosted, overlay: DEV_OVERLAY });
  // A fresh full replay that already contains the migrations (the snapshot-based step needs the before state, so it is skipped here).
  execute(fullAvailable, dbFull, 'fresh full replay', steps.filter((s) => !s.needsApply), { apply: false });
  // The same applied twice is harmless.
  {
    const twice = script(steps, { apply: true }).replace('BEGIN;', () => `BEGIN;\n${allRaw}`);
    const r = spawnSync(preAvailable, [...argsFor(dbPre), '-v', 'ON_ERROR_STOP=1'], { input: twice, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, timeout: 240000 });
    const n = [...((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)].length;
    ok(`executed [migrations applied twice]: every step still answers (${n}/${steps.length})`, n === steps.length);
  }
  // The attacks, before the fix: they work, which is why the fix exists.
  execute(preAvailable, dbPre, 'before the fix (older migrations only)', exploitSteps, { apply: false });
}

console.log(`Database hardening tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} database hardening test(s) failed`);
