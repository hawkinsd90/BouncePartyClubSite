// Booking-confirmation columns of orders (20261026120300, SEC-047): who may write them, the claim / finalize / release / retry life cycle
// and whether any other database function can reach them.
//
//   STATIC    the guard text (always runs).
//   EXECUTED  real SQL as the real roles in a scratch database that holds the COMPLETE migration chain (GUARD_DB_NAME, default
//             "bpc_replay_full"; the Production- and Development-shaped databases are used the same way when named). One rolled-back
//             transaction; scenarios run in order and share state, so the life cycle is a real sequence.
// Run: node scripts/dev/security-scratch.cjs test bookingConfirmationGuard

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
const GUARD = fs.readFileSync('supabase/migrations/20261026120300_guard_booking_confirmation_columns.sql', 'utf8').replace(/\r\n/g, '\n');
ok('static: the guard restricts only the authenticated and anon session roles', /current_user NOT IN \('authenticated', 'anon'\)/.test(GUARD));
ok('static: the guard covers INSERT and UPDATE, all three columns, and uses IS DISTINCT FROM so an unchanged value passes', /BEFORE INSERT OR UPDATE ON public\.orders/.test(GUARD) && (GUARD.match(/IS DISTINCT FROM OLD\./g) ?? []).length === 3);

const denied = (v: string) => v === 'ERR:42501';
const n = (q: string) => `SELECT pg_temp.n($u$${q}$u$)::text`;
const O = IDS.orderB;           // a pending_review order owned by customer B, confirmation state untouched by the seed
const C1 = '91000000-0000-4000-8000-000000000001';
const C2 = '91000000-0000-4000-8000-000000000002';
const C3 = '91000000-0000-4000-8000-000000000003';
const DRAFT = '92000000-0000-4000-8000-000000000001';
const ADMIN = IDS.uAdmin, CREW = IDS.uCrew, MASTER = IDS.uMaster, CUST = IDS.uA;
const claim = (id: string, claimId: string, secs = 600) => `SELECT public.claim_booking_confirmation('${id}'::uuid, '${claimId}'::uuid, ${secs})`;
const fin = (id: string, claimId: string) => `SELECT public.finalize_booking_confirmation('${id}'::uuid, '${claimId}'::uuid)::text`;
const rel = (id: string, claimId: string) => `SELECT public.release_booking_confirmation('${id}'::uuid, '${claimId}'::uuid)::text`;
const state = (id: string) => `SELECT concat_ws('|', COALESCE(booking_confirmation_sent, false), booking_confirmation_claim_id IS NOT NULL, booking_confirmation_claimed_at IS NOT NULL) FROM public.orders WHERE id = '${id}'`;

type Role = 'postgres' | 'anon' | 'authenticated' | 'service_role';
interface Sc { name: string; role: Role; uid: string | null; sql: string; expect: string | ((v: string) => boolean) }
const S: Sc[] = [];
const add = (name: string, role: Role, uid: string | null, sql: string, expect: Sc['expect']) => S.push({ name, role, uid, sql, expect });

// ---- 1. unauthorized: direct writes ----
for (const [who, role, uid] of [['anon', 'anon', null], ['a signed-in customer', 'authenticated', CUST], ['crew', 'authenticated', CREW], ['an admin', 'authenticated', ADMIN], ['a master', 'authenticated', MASTER]] as Array<[string, Role, string | null]>) {
  add(`${who} cannot set a claim id`, role, uid, n(`UPDATE public.orders SET booking_confirmation_claim_id = '${C3}' WHERE id = '${O}'`), role === 'authenticated' && uid !== CUST ? denied : (v) => v === 'ERR:42501' || v === '0');
  add(`${who} cannot mark the confirmation as sent`, role, uid, n(`UPDATE public.orders SET booking_confirmation_sent = true WHERE id = '${O}'`), role === 'authenticated' && uid !== CUST ? denied : (v) => v === 'ERR:42501' || v === '0');
}
add('admin cannot set the claim time', 'authenticated', ADMIN, n(`UPDATE public.orders SET booking_confirmation_claimed_at = now() WHERE id = '${O}'`), denied);
add('admin cannot slip a claim write into an otherwise legitimate multi-column update (the whole statement fails)', 'authenticated', ADMIN, n(`UPDATE public.orders SET admin_message = 'sneaky', booking_confirmation_sent = true WHERE id = '${O}'`), denied);
add('... and the legitimate half of that statement was not applied', 'postgres', null, `SELECT coalesce(admin_message, '') <> 'sneaky' FROM public.orders WHERE id = '${O}'`, 'true');
add('admin cannot reach the columns with an upsert (INSERT .. ON CONFLICT DO UPDATE)', 'authenticated', ADMIN, n(`INSERT INTO public.orders (id, customer_id, address_id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, booking_confirmation_sent) SELECT id, customer_id, address_id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, true FROM public.orders WHERE id = '${O}' ON CONFLICT (id) DO UPDATE SET booking_confirmation_sent = true`), denied);
add('browser roles cannot create orders at all (INSERT was revoked by 20261021120000), so the guard insert branch below is defence in depth', 'authenticated', ADMIN, n(`INSERT INTO public.orders (customer_id) VALUES ('${IDS.custA}')`), denied);
// The insert branch of the guard is exercised by granting INSERT for the rest of this rolled-back transaction only.
add('(test setup) temporarily allow browser-role INSERT on orders', 'postgres', null, n('GRANT INSERT ON public.orders TO authenticated, anon'), '0');
const copyOrder = (extra: string, value: string) => `INSERT INTO public.orders (customer_id, address_id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents, ${extra}) SELECT customer_id, address_id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, 0, 0, 0, ${value} FROM public.orders WHERE id = '${IDS.orderG}'`;
add('staff cannot create an order that already holds a claim', 'authenticated', ADMIN, n(copyOrder('booking_confirmation_claim_id', `'${C3}'`)), denied);
add('staff cannot create an order that already has a claim time', 'authenticated', ADMIN, n(copyOrder('booking_confirmation_claimed_at', 'now()')), denied);
add('staff cannot create an order already marked as sent', 'authenticated', ADMIN, n(copyOrder('booking_confirmation_sent', 'true')), denied);
add('staff CAN create an ordinary order (so the three refusals above are the guard, not a missing column or policy)', 'authenticated', ADMIN, n(copyOrder('booking_confirmation_sent', 'false')), '1');
add('anon cannot create an order that is already marked as sent', 'anon', null, n(`INSERT INTO public.orders (customer_id, booking_confirmation_sent) VALUES ('${IDS.custA}', true)`), denied);
add('(test setup) take the temporary INSERT grant away again', 'postgres', null, n('REVOKE INSERT ON public.orders FROM authenticated, anon'), '0');
add('the order is still untouched after every refused write', 'postgres', null, state(O), 'f|f|f');
// legitimate staff writes
add('staff can still edit other columns', 'authenticated', ADMIN, n(`UPDATE public.orders SET admin_message = 'hello' WHERE id = '${O}'`), '1');
add('crew can still advance the workflow', 'authenticated', CREW, n(`UPDATE public.orders SET workflow_status = 'on_the_way' WHERE id = '${O}'`), '1');
add('a client that sends the whole row back with the confirmation columns UNCHANGED is not blocked', 'authenticated', ADMIN, n(`UPDATE public.orders SET booking_confirmation_sent = booking_confirmation_sent, booking_confirmation_claim_id = booking_confirmation_claim_id, admin_message = 'echo' WHERE id = '${O}'`), '1');

// ---- 2. the server life cycle (service role = the Edge Function; the functions are SECURITY DEFINER) ----
add('a browser role cannot call claim (execute is service-role only)', 'authenticated', ADMIN, claim(O, C1), denied);
add('anon cannot call finalize', 'anon', null, fin(O, C1), denied);
add('a signed-in customer cannot call release', 'authenticated', CUST, rel(O, C1), denied);
add('claim: the first request wins', 'service_role', null, claim(O, C1), 'claimed');
add('claim: state shows a held claim, not sent', 'postgres', null, state(O), 'f|t|t');
add('claim: a retry while the claim is held is busy (no second send)', 'service_role', null, claim(O, C2), 'busy');
add('claim: the same request id retried is also busy, never a second claim', 'service_role', null, claim(O, C1), 'busy');
add('claim: a stale-seconds value below the floor is invalid', 'service_role', null, claim(O, C2, 10), 'invalid');
add('finalize: a different claim id changes nothing', 'service_role', null, fin(O, C2), 'false');
add('finalize: the owner finalizes', 'service_role', null, fin(O, C1), 'true');
add('finalize: state is sent with the claim cleared', 'postgres', null, state(O), 't|f|f');
add('finalize: repeating it is idempotent (false, no change)', 'service_role', null, fin(O, C1), 'false');
add('claim: after delivery the answer is already_sent', 'service_role', null, claim(O, C3), 'already_sent');
add('release: after delivery it never clears the sent flag', 'service_role', null, rel(O, C1), 'false');
add('release: state still sent', 'postgres', null, state(O), 't|f|f');
// a second order: failure and retry path
const P = IDS.orderA;
add('retry path: claim', 'service_role', null, claim(P, C1), 'claimed');
add('retry path: release after a failed send by the wrong claim does nothing', 'service_role', null, rel(P, C2), 'false');
add('retry path: release by the owner frees the order', 'service_role', null, rel(P, C1), 'true');
add('retry path: release twice is idempotent', 'service_role', null, rel(P, C1), 'false');
add('retry path: a new request can now claim', 'service_role', null, claim(P, C2), 'claimed');
add('stale takeover: age the claim (table owner)', 'postgres', null, n(`UPDATE public.orders SET booking_confirmation_claimed_at = now() - interval '11 minutes' WHERE id = '${P}'`), '1');
add('stale takeover: an abandoned claim is taken over', 'service_role', null, claim(P, C3), 'claimed');
add('stale takeover: the abandoned request can no longer finalize', 'service_role', null, fin(P, C2), 'false');
add('stale takeover: the new owner finalizes', 'service_role', null, fin(P, C3), 'true');
// edge cases
add('an unknown order is invalid', 'service_role', null, claim('93000000-0000-4000-8000-0000000000ff', C1), 'invalid');
add('null arguments are invalid / false, not an error', 'service_role', null, `SELECT public.claim_booking_confirmation(NULL, NULL, 600) || ',' || public.finalize_booking_confirmation(NULL, NULL)::text || ',' || public.release_booking_confirmation(NULL, NULL)::text`, 'invalid,false,false');
add('the service role can still write the columns directly (the guard only restricts browser roles)', 'service_role', null, n(`UPDATE public.orders SET booking_confirmation_claim_id = NULL WHERE id = '${IDS.orderLegacy}'`), '1');
add('draft order (table owner creates it)', 'postgres', null, n(`INSERT INTO public.orders (id, customer_id, address_id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents) SELECT '${DRAFT}', customer_id, address_id, 'draft', location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents FROM public.orders WHERE id = '${IDS.orderG}'`), '1');
add('a draft order cannot be claimed', 'service_role', null, claim(DRAFT, C1), 'invalid');

// ---- 3. no other function can reach the columns ----
add('only the known functions mention the confirmation columns (a new one must be reviewed)', 'service_role', null,
  `SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ILIKE '%booking_confirmation_%'`,
  'claim_booking_confirmation,create_booking_request,create_staff_invoice_order,finalize_booking_confirmation,guard_booking_confirmation_columns,release_booking_confirmation');
add('none of them is executable by anon or authenticated', 'service_role', null,
  `SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ILIKE '%booking_confirmation_%' AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, '0');
add('the only SECURITY DEFINER function a browser role can run that writes orders is the admin-gated archive', 'service_role', null,
  `SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) AND (p.prosrc ~* 'update +(public\\.)?orders' OR p.prosrc ~* 'insert +into +(public\\.)?orders' OR (p.prosrc ~* 'execute' AND p.prosrc ~* 'orders'))`, 'archive_old_orders');
add('archive_old_orders cannot touch the confirmation columns (it only sets archived_at) and refuses non-admins', 'authenticated', CUST, `SELECT public.archive_old_orders(90)::text`, (v) => v.startsWith('ERR:'));
add('no view in public exposes orders for writing', 'service_role', null, `SELECT count(*)::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v','m') AND pg_get_viewdef(c.oid) ILIKE '%orders%' AND c.relkind = 'v' AND pg_relation_is_updatable(c.oid, false) <> 0`, '0');
add('the guard trigger is enabled on orders for inserts and updates', 'service_role', null, `SELECT (tgenabled = 'O' AND (tgtype & 4) = 4 AND (tgtype & 16) = 16 AND (tgtype & 2) = 2)::text FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND tgname = 'trg_guard_booking_confirmation_columns'`, 'true');

function script(): string {
  const calls = S.map((sc, i) => `  RAISE NOTICE 'R|${i}|%', pg_temp.as_role('${sc.role}', ${sc.uid ? `'${sc.uid}'::uuid` : 'NULL::uuid'}, $q$${sc.sql}$q$);`);
  return `
BEGIN;
${SEED_SQL}
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
GRANT EXECUTE ON FUNCTION pg_temp.n(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.as_role(text, uuid, text) TO PUBLIC;
DO $run$
BEGIN
${calls.join('\n')}
END $run$;
ROLLBACK;
`;
}

const db = process.env.GUARD_DB_NAME || 'bpc_replay_full';
const port = process.env.CORE_DB_PORT || '54329';
const host = process.env.CORE_DB_HOST || '127.0.0.1';
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
let ran = false;
for (const c of candidates) {
  const probe = spawnSync(c, ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-At', '-X', '-q', '-w', '-c', "SELECT to_regprocedure('public.guard_booking_confirmation_columns()') IS NOT NULL"], { encoding: 'utf8', timeout: 15000 });
  if (probe.status !== 0 || probe.stdout.trim() !== 't') continue;
  ran = true;
  const r = spawnSync(c, ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1'], { input: script(), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
  const results: Record<number, string> = {};
  for (const m of (((r.stderr ?? '') + (r.stdout ?? '')) as string).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
  ok(`executed: ${S.length} scenarios ran to completion in "${db}" (${Object.keys(results).length}/${S.length})`, Object.keys(results).length === S.length);
  if (Object.keys(results).length !== S.length) console.error(((r.stderr ?? '') as string).split('\n').filter((l: string) => /ERROR|DETAIL/.test(l)).slice(0, 5).join('\n'));
  S.forEach((sc, i) => {
    const got = results[i];
    ok(`executed: ${sc.name} (got ${got})`, got !== undefined && (typeof sc.expect === 'string' ? got === sc.expect : sc.expect(got)));
  });
  break;
}
if (!ran) {
  if (process.env.CORE_DB_REQUIRE) ok(`executed: scratch database ${db} with the guard migration is available (CORE_DB_REQUIRE is set)`, false);
  else console.log(`EXECUTED layer SKIPPED: scratch database ${db} not reachable or without the guard`);
}

console.log(`booking confirmation guard tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} booking confirmation guard test(s) failed`);
