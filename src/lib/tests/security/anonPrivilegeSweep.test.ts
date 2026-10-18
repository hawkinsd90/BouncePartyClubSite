// 20261026120000: the sequence revokes and the anonymous table-privilege sweep (SEC-014, SEC-039), reviewed for effective privileges
// (including grants to PUBLIC) and for the customer, staff, booking and receipt workflows that must keep working.
//
//   EXECUTED  the real migration file is run, as the table owner, inside a rolled-back transaction in a local scratch database that
//             holds the chain up to the last October file (default "bpc_replay_full25"; set SWEEP_DB_NAME for another shape), after
//             the synthetic fixture of coreDatabaseAccessScenarios. Then the scenarios run as the real anon / authenticated /
//             service_role roles. Nothing is committed and no Supabase project is touched.
// Run: node scripts/dev/security-scratch.cjs test anonPrivilegeSweep

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import { IDS, SEED_SQL } from '../support/coreDatabaseAccessScenarios';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const MIGRATION = fs.readFileSync('supabase/migrations/20261026120000_restrict_sequence_and_anon_table_privileges.sql', 'utf8').replace(/\r\n/g, '\n');
const denied = (v: string) => v === 'ERR:42501';
const n = (q: string) => `SELECT pg_temp.n($u$${q}$u$)::text`;
const A = IDS.uA, ADMIN = IDS.uAdmin, CREW = IDS.uCrew;
const FRESH_USER = 'd5d5d5d5-0000-4000-8000-000000000001';

interface Sc { name: string; role: 'anon' | 'authenticated' | 'service_role'; uid: string | null; sql: string; expect: string | ((v: string) => boolean) }
const S: Sc[] = [];
const add = (name: string, role: Sc['role'], uid: string | null, sql: string, expect: Sc['expect']) => S.push({ name, role, uid, sql, expect });

// ---- anonymous visitor: what must still work ----
add('anon can still read the public catalog (active units)', 'anon', null, `SELECT (count(*) >= 1)::text FROM public.units WHERE active`, 'true');
add('anon can still read public pricing rules', 'anon', null, `SELECT (count(*) >= 1)::text FROM public.pricing_rules`, 'true');
add('anon can still call the public settings and navigation functions', 'anon', null, `SELECT (public.get_public_business_settings() IS NOT NULL)::text || ',' || (public.get_public_nav_menu_groups() IS NOT NULL)::text`, 'true,true');
// The staging-table INSERT policy reads auth.users, which anon cannot read, so an anonymous insert is refused with or without this migration
// (checked against the unmodified chain): signup consent is recorded through the record-consent Edge Function. What the migration must keep is the
// INSERT privilege itself, so behaviour is unchanged, and nothing else.
add('the signup-consent staging table keeps exactly the INSERT privilege for anon (behaviour unchanged)', 'anon', null, `SELECT concat_ws(',', has_table_privilege('anon','public.pending_signups_consent','INSERT'), has_table_privilege('anon','public.pending_signups_consent','SELECT'), has_table_privilege('anon','public.pending_signups_consent','UPDATE'), has_table_privilege('anon','public.pending_signups_consent','DELETE'))`, 't,f,f,f');
// ---- anonymous visitor: what must be refused ----
add('anon cannot read the consent staging table back', 'anon', null, 'SELECT count(*)::text FROM public.pending_signups_consent', denied);
add('anon cannot rewrite or delete consent rows', 'anon', null, n(`UPDATE public.pending_signups_consent SET source = 'x'`), denied);
add('anon cannot insert a consent row for a user that is not new', 'anon', null, n(`INSERT INTO public.pending_signups_consent (user_id, batch_id, consents) VALUES ('${A}', gen_random_uuid(), '[]'::jsonb)`), denied);
for (const t of ['admin_settings', 'admin_settings_changelog', 'sms_conversations', 'rate_limits', 'user_permissions_changelog', 'user_consent_log', 'invoices', 'contact_inquiries', 'email_templates', 'order_notes']) {
  add(`anon cannot read ${t}`, 'anon', null, `SELECT count(*)::text FROM public.${t}`, denied);
}
// ---- sequences ----
add('anon cannot touch the receipt or ledger sequence', 'anon', null, `SELECT concat_ws(',', has_sequence_privilege('anon','public.receipt_number_seq','USAGE'), has_sequence_privilege('anon','public.payments_ledger_sequence_seq','USAGE'), has_sequence_privilege('anon','public.receipt_number_seq','UPDATE'))`, 'f,f,f');
add('anon cannot nextval or setval', 'anon', null, `SELECT nextval('public.receipt_number_seq')::text`, denied);
add('a signed-in customer cannot setval', 'authenticated', A, `SELECT setval('public.receipt_number_seq', 1)::text`, denied);
add('an admin cannot setval from the browser role either', 'authenticated', ADMIN, `SELECT setval('public.payments_ledger_sequence_seq', 1)::text`, denied);
// ---- receipts: admin keeps working through the definer generator and the column default ----
add('admin can create a receipt (the receipt-number default still runs)', 'authenticated', ADMIN, n(`INSERT INTO public.transaction_receipts (transaction_type, amount_cents) VALUES ('deposit', 100)`), '1');
add('admin still gets a receipt number from the generator', 'authenticated', ADMIN, `SELECT (length(public.generate_receipt_number()) > 0)::text`, 'true');
add('a signed-in customer cannot create a receipt', 'authenticated', A, n(`INSERT INTO public.transaction_receipts (transaction_type, amount_cents) VALUES ('deposit', 100)`), (v) => v.startsWith('ERR:') || v === '0');
add('crew cannot create a receipt', 'authenticated', CREW, n(`INSERT INTO public.transaction_receipts (transaction_type, amount_cents) VALUES ('deposit', 100)`), (v) => v.startsWith('ERR:') || v === '0');
add('anon cannot create a receipt', 'anon', null, n(`INSERT INTO public.transaction_receipts (transaction_type, amount_cents) VALUES ('deposit', 100)`), denied);
// ---- payments: the backend keeps its ledger sequence ----
add('the backend (service role) can still record a payment (ledger sequence default)', 'service_role', null, n(`INSERT INTO public.payments (order_id, type, amount_cents) VALUES ('${IDS.orderB}', 'deposit', 100)`), '1');
add('the backend can still take a sequence value', 'service_role', null, `SELECT (nextval('public.payments_ledger_sequence_seq') > 0)::text`, 'true');
// record_cash_payment is a backend function (the record-cash-payment Edge Function calls it with the service role after checking the caller)
add('the backend can still record a cash payment (definer function, ledger sequence default): not refused for privileges', 'service_role', null, `SELECT CASE WHEN pg_temp.try_cash('${IDS.orderA}') = 'ERR:42501' THEN 'refused' ELSE 'allowed' END`, 'allowed');
add('a signed-in admin cannot call the cash-payment function directly from the browser role', 'authenticated', ADMIN, `SELECT pg_temp.try_cash('${IDS.orderA}')`, denied);
add('a customer cannot record a cash payment', 'authenticated', A, `SELECT pg_temp.try_cash('${IDS.orderA}')`, denied);
add('anon cannot record a cash payment', 'anon', null, `SELECT pg_temp.try_cash('${IDS.orderA}')`, denied);
// ---- staff ----
add('staff keep reading the private tables the anonymous sweep touched (admin: admin_settings)', 'authenticated', ADMIN, 'SELECT (count(*) >= 0)::text FROM public.admin_settings', 'true');
add('crew still reads task rows', 'authenticated', CREW, `SELECT (count(*) >= 1)::text FROM public.task_status`, 'true');
add('a customer still reads only their own orders through get_my_orders', 'authenticated', A, `SELECT count(*)::text FROM public.get_my_orders(50)`, '1');
// ---- effective privileges, including PUBLIC ----
add('no sequence, table or function in public is granted to PUBLIC', 'service_role', null,
  `SELECT ((SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','S') AND a.grantee = 0) + (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))))::text`, '0');
add('anon has no effective privilege on any table without an anon policy (PUBLIC and inherited grants included)', 'service_role', null,
  `SELECT count(*)::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.roles && ARRAY['anon','public']::name[])`, '0');
add('anon is a member of no other role', 'service_role', null, `SELECT count(*)::text FROM pg_auth_members WHERE member = 'anon'::regrole`, '0');

function script(preamble: string, migration: string): string {
  const calls = S.map((sc, i) => `  RAISE NOTICE 'R|${i}|%', pg_temp.as_role('${sc.role}', ${sc.uid ? `'${sc.uid}'::uuid` : 'NULL::uuid'}, $q$${sc.sql}$q$);`);
  return `
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email, created_at) VALUES ('${FRESH_USER}', 'fresh-signup@example.test', now());
${SEED_SQL}
${preamble}
${migration}
CREATE FUNCTION pg_temp.as_role(r text, uid uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE res text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', r, true);
  EXECUTE 'SET LOCAL ROLE ' || quote_ident(r);
  BEGIN EXECUTE q INTO res; EXCEPTION WHEN OTHERS THEN res := 'ERR:' || SQLSTATE; END;
  RESET ROLE;
  RETURN COALESCE(res, 'NULL');
END $f$;
CREATE FUNCTION pg_temp.n(q text) RETURNS integer LANGUAGE plpgsql AS $g$
DECLARE c integer;
BEGIN EXECUTE q; GET DIAGNOSTICS c = ROW_COUNT; RETURN c; END $g$;
CREATE FUNCTION pg_temp.try_cash(o uuid) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN PERFORM public.record_cash_payment(o, 100, 0, NULL); RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN 'ERR:' || SQLSTATE; END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.n(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.as_role(text, uuid, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.try_cash(uuid) TO PUBLIC;
DO $run$
BEGIN
${calls.join('\n')}
END $run$;
ROLLBACK;
`;
}

const db = process.env.SWEEP_DB_NAME || 'bpc_replay_full25';
const port = process.env.CORE_DB_PORT || '54329';
const host = process.env.CORE_DB_HOST || '127.0.0.1';
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
function psql(input: string, stop = true) {
  for (const c of candidates) {
    const r = spawnSync(c, ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-X', '-q', '-w', ...(stop ? ['-v', 'ON_ERROR_STOP=1'] : [])], { input, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
    if (r.status !== null && !/could not connect|command not found|ENOENT/.test((r.stderr ?? '') + (r.error?.message ?? ''))) return r;
  }
  return null;
}
const probe = psql('SELECT 1;');
if (!probe || probe.status !== 0) {
  if (process.env.CORE_DB_REQUIRE) ok(`executed: scratch database ${db} is available (CORE_DB_REQUIRE is set)`, false);
  else console.log(`EXECUTED layer SKIPPED: scratch database ${db} not reachable`);
} else {
  // 1. the migration, then every scenario
  const r = psql(script('', MIGRATION));
  const results: Record<number, string> = {};
  for (const m of (((r?.stderr ?? '') + (r?.stdout ?? '')) as string).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
  ok(`executed: the migration and ${S.length} scenarios ran to completion in "${db}" (${Object.keys(results).length}/${S.length})`, Object.keys(results).length === S.length);
  if (Object.keys(results).length !== S.length) console.error(((r?.stderr ?? '') as string).split('\n').filter((l: string) => /ERROR|DETAIL/.test(l)).slice(0, 5).join('\n'));
  S.forEach((sc, i) => {
    const got = results[i];
    ok(`executed: ${sc.name} (got ${got})`, got !== undefined && (typeof sc.expect === 'string' ? got === sc.expect : sc.expect(got)));
  });

  // 2. fail closed: a grant the REVOKEs cannot remove stops the migration instead of leaving a partial result
  const stops = (grant: string) => {
    const rr = psql(`BEGIN;\n${grant};\n${MIGRATION}\nROLLBACK;\n`, false);
    return /anonymous privileges remain/.test((rr?.stderr ?? '') as string);
  };
  const pubSeq = psql(`BEGIN;
GRANT USAGE ON SEQUENCE public.receipt_number_seq TO PUBLIC;
${MIGRATION}
SELECT 'EFFECTIVE|' || has_sequence_privilege('anon', 'public.receipt_number_seq', 'USAGE');
ROLLBACK;
`);
  ok('a grant of a sequence to PUBLIC is removed by the migration (effective anon privilege gone)', /EFFECTIVE\|false/.test(((pubSeq?.stdout ?? '') + (pubSeq?.stderr ?? '')) as string) || /EFFECTIVE\|f/.test(((pubSeq?.stdout ?? '') + (pubSeq?.stderr ?? '')) as string));
  ok('fail closed: a grant of a private table to PUBLIC stops the migration', stops('GRANT SELECT ON TABLE public.admin_settings TO PUBLIC'));
  ok('fail closed: anon inheriting a role that holds a private table privilege stops the migration', stops('CREATE ROLE zz_inherit NOLOGIN; GRANT SELECT ON TABLE public.admin_settings TO zz_inherit; GRANT zz_inherit TO anon'));
  const twice = psql(`BEGIN;\n${MIGRATION}\n${MIGRATION}\nROLLBACK;\n`);
  ok('the migration is safe to run twice', !!twice && twice.status === 0);
}

console.log(`anonymous privilege sweep tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} anonymous privilege sweep test(s) failed`);
