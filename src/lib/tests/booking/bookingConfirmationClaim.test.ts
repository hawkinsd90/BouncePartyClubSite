// The booking-confirmation claim functions (migration 20261017120000_add_booking_confirmation_claim.sql).
//
// Layers, labelled so nobody mistakes one for another:
//   STATIC    parses the migration text (always runs).
//   EXECUTED  runs the real SQL against SCRATCH PostgreSQL databases, as the real postgres / service_role / authenticated / anon
//             roles, in a transaction that is rolled back. It never touches a Supabase project.
//               ROLE_DB_PRE   a replay of the older migrations; the migration text is applied by the test (default "role_pre")
//               ROLE_DB_FULL  a fresh replay that already contains the migration (default "role_full")
//             A third check opens SEVERAL real database connections at once against "role_full" (committed, uniquely-keyed scratch
//             rows that are deleted afterwards) to prove that concurrent callers cannot both acquire or both finalize a claim.
//             Same host / port / psql variables as the role tests. With no reachable database the layer is SKIPPED (an
//             environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
// The concurrency guarantee is the single UPDATE ... WHERE statement in claim_booking_confirmation (Postgres row locking makes
// concurrent callers take turns); the executed test calls it repeatedly in one transaction and checks exactly one winner.
// Run: node node_modules/jiti/bin/jiti.js src/lib/bookingConfirmationClaim.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync, spawn } = require('child_process');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (process.env.ROLE_SKIP_STATIC && label.startsWith('static:')) return;
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const MIG = 'supabase/migrations/20261017120000_add_booking_confirmation_claim.sql';
const raw = read(MIG);
const sql = norm(stripSql(raw));
const names: string[] = fs.readdirSync('supabase/migrations').filter((f: string) => f.endsWith('.sql')).sort();

// ---------------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------------
ok('static: the migration sorts after the previous newest migration', names.indexOf('20261017120000_add_booking_confirmation_claim.sql') > names.indexOf('20261016120000_repair_role_assignment_and_signup_provisioning.sql'));
ok('static: exactly one migration adds the claim state', names.filter((n) => /booking_confirmation_claim/.test(n)).length === 1);
ok('static: it adds only the two claim columns to orders', /ALTER TABLE public\.orders ADD COLUMN IF NOT EXISTS booking_confirmation_claim_id uuid, ADD COLUMN IF NOT EXISTS booking_confirmation_claimed_at timestamptz;/.test(sql) && (sql.match(/ALTER TABLE/g) ?? []).length === 1);
ok('static: it does not touch booking_confirmation_sent\'s definition', !/ALTER COLUMN booking_confirmation_sent|ADD COLUMN[^;]*booking_confirmation_sent\b/.test(sql));
ok('static: it creates exactly the claim, finalize and release functions', (sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 3 && /FUNCTION public\.claim_booking_confirmation\(/.test(sql) && /FUNCTION public\.finalize_booking_confirmation\(/.test(sql) && /FUNCTION public\.release_booking_confirmation\(/.test(sql));
ok('static: every function pins search_path', (sql.match(/SET search_path TO 'public'/g) ?? []).length === 3);
ok('static: every function is SECURITY DEFINER (needed to write orders for the service role through a closed table)', (sql.match(/SECURITY DEFINER/g) ?? []).length === 3);
ok('static: execute is revoked from PUBLIC, anon and authenticated for all three and granted to service_role only', (sql.match(/REVOKE ALL ON FUNCTION public\.\w+\([^)]*\) FROM PUBLIC, anon, authenticated;/g) ?? []).length === 3 && (sql.match(/GRANT EXECUTE ON FUNCTION public\.\w+\([^)]*\) TO service_role;/g) ?? []).length === 3 && !/TO (anon|authenticated|PUBLIC)/i.test(sql));
ok('static: the claim is one UPDATE whose WHERE decides (no read-then-write)', /UPDATE public\.orders SET booking_confirmation_claim_id = p_claim_id, booking_confirmation_claimed_at = now\(\) WHERE id = p_order_id AND status <> 'draft' AND COALESCE\(booking_confirmation_sent, false\) = false AND \( booking_confirmation_claim_id IS NULL OR booking_confirmation_claimed_at IS NULL OR booking_confirmation_claimed_at < now\(\) - make_interval\(secs => p_stale_seconds\) \) RETURNING/.test(sql));
ok('static: the claim never sets booking_confirmation_sent', !/claim_booking_confirmation[\s\S]*?SET booking_confirmation_sent = true[\s\S]*?RETURNING booking_confirmation_claim_id INTO v_claimed/.test(sql) && !/booking_confirmation_claimed_at = now\(\)[^;]*booking_confirmation_sent = true/.test(sql));
ok('static: finalize and release require the exact claim id and an unsent order', (sql.match(/AND booking_confirmation_claim_id = p_claim_id AND COALESCE\(booking_confirmation_sent, false\) = false;/g) ?? []).length === 2);
ok('static: finalize is the only statement that sets booking_confirmation_sent = true', (sql.match(/booking_confirmation_sent = true/g) ?? []).length === 1 && /SET booking_confirmation_sent = true, booking_confirmation_claim_id = NULL, booking_confirmation_claimed_at = NULL WHERE/.test(sql));
ok('static: release never sets the sent flag', !/release_booking_confirmation[\s\S]*SET[^;]*booking_confirmation_sent = (true|false)/.test(sql.slice(sql.indexOf('FUNCTION public.release_booking_confirmation'), sql.indexOf('REVOKE ALL'))));
ok('static: a stale timeout below sixty seconds is refused', /p_stale_seconds < 60/.test(sql));
ok('static: no policy, default privilege, other table or other grant is touched', !/CREATE POLICY|DROP POLICY|ALTER DEFAULT PRIVILEGES|GRANT [^;]*ON (TABLE|ALL)|ALTER TABLE public\.(?!orders)/i.test(sql));
ok('static: the migration carries no internal planning labels and no project reference', !/\b(Phase|Stage) ?[A-Z0-9]\b|\bA1\b|qaagfafagdpgzcijnfbw/.test(raw));
ok('static: no earlier migration was edited to add the claim state', names.filter((n) => n !== '20261017120000_add_booking_confirmation_claim.sql').every((n) => !/booking_confirmation_claim_id/.test(read(`supabase/migrations/${n}`))));

// ---------------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------------
const port = process.env.ROLE_DB_PORT || process.env.CORE_DB_PORT || '54329';
const host = process.env.ROLE_DB_HOST || process.env.CORE_DB_HOST || '127.0.0.1';
const dbPre = process.env.ROLE_DB_PRE || 'role_pre';
const dbFull = process.env.ROLE_DB_FULL || 'role_full';
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
const argsFor = (db: string) => ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-At', '-X', '-q'];
function findPsql(db: string): string | null {
  for (const c of candidates) {
    const p = spawnSync(c, [...argsFor(db), '-c', "SELECT to_regclass('public.orders') IS NOT NULL"], { encoding: 'utf8', timeout: 15000 });
    if (p.status === 0 && p.stdout.trim() === 't') return c;
  }
  return null;
}

const O = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const seed = (id: string, status = 'confirmed', extra = '') =>
  `INSERT INTO public.orders (id, status, location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ('${id}', '${status}', 'residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 1000, 100, 900, 'same_day'${extra ? ', ' + extra.split('=')[1] : ''});`;
const state = (id: string) => `SELECT concat_ws('/', coalesce(booking_confirmation_sent::text, 'null'), coalesce(booking_confirmation_claim_id::text, 'none'), status) FROM public.orders WHERE id = '${id}'`;
const claim = (id: string, cid: string, stale = 600) => `SELECT public.claim_booking_confirmation('${id}', '${cid}', ${stale})`;
const fin = (id: string, cid: string) => `SELECT public.finalize_booking_confirmation('${id}', '${cid}')::text`;
const rel = (id: string, cid: string) => `SELECT public.release_booking_confirmation('${id}', '${cid}')::text`;

interface Step { name: string; role?: string; sql: string; setup?: string; expect: string | ((v: string) => boolean) }
const steps: Step[] = [];
const add = (name: string, sqlText: string, expect: Step['expect'], role = 'service_role', setup?: string) => steps.push({ name, sql: sqlText, expect, role, setup });
const as = (role: string) => role;
void as;

// fresh unsent order
add('fresh unsent order: the first request claims it', claim(O(1), C(1)), 'claimed', 'service_role', seed(O(1)));
add('... and the claim alone does NOT mark it sent', state(O(1)), `false/${C(1)}/confirmed`, 'postgres');
add('a second request while the claim is live is busy (never already-sent)', claim(O(1), C(2)), 'busy');
add('... and still not sent, still the first owner', state(O(1)), `false/${C(1)}/confirmed`, 'postgres');
add('the same owner asking again is busy too (a claim is not re-entrant)', claim(O(1), C(1)), 'busy');
add('a wrong claim id cannot finalize', fin(O(1), C(2)), 'false');
add('a wrong claim id cannot release', rel(O(1), C(2)), 'false');
add('... the owner is unchanged and the order is still unsent', state(O(1)), `false/${C(1)}/confirmed`, 'postgres');
add('the exact owner finalizes: sent, claim cleared', fin(O(1), C(1)), 'true');
add('... state is delivered and unclaimed', state(O(1)), 'true/none/confirmed', 'postgres');
add('after delivery a new request is already_sent', claim(O(1), C(3)), 'already_sent');
add('after delivery the old owner cannot release (the delivered state is never cleared)', rel(O(1), C(1)), 'false');
add('after delivery nobody can finalize again', fin(O(1), C(1)), 'false');
add('... still delivered and unclaimed', state(O(1)), 'true/none/confirmed', 'postgres');

// five callers: exactly one winner
add('five callers on one order: exactly one claims, four are busy', `SELECT string_agg(r, ',' ORDER BY n) FROM (SELECT n, public.claim_booking_confirmation('${O(2)}', ('cccccccc-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid, 600) r FROM generate_series(1, 5) n) x`, 'claimed,busy,busy,busy,busy', 'service_role', seed(O(2)));
add('... and the order is not sent', state(O(2)), (v) => v.startsWith('false/cccccccc-0000-4000-8000-000000000101/'), 'postgres');

// release after failure
add('failed delivery: the owner releases', rel(O(3), C(1)), 'true', 'service_role', `${seed(O(3))} UPDATE public.orders SET booking_confirmation_claim_id = '${C(1)}', booking_confirmation_claimed_at = now() WHERE id = '${O(3)}';`);
add('... released: unsent and unclaimed', state(O(3)), 'false/none/confirmed', 'postgres');
add('... and a retry claims again', claim(O(3), C(2)), 'claimed');
add('a released claim id cannot finalize later', fin(O(3), C(1)), 'false');

// stale claims
const staleSetup = (id: string, secs: number, owner: string) => `${seed(id)} UPDATE public.orders SET booking_confirmation_claim_id = '${owner}', booking_confirmation_claimed_at = now() - interval '${secs} seconds' WHERE id = '${id}';`;
add('a claim 599 seconds old is not stale yet: busy', claim(O(4), C(2)), 'busy', 'service_role', staleSetup(O(4), 599, C(1)));
add('a claim 601 seconds old is stale: a new request reclaims it', claim(O(5), C(2)), 'claimed', 'service_role', staleSetup(O(5), 601, C(1)));
add('... the new owner holds the claim and it is unsent', state(O(5)), `false/${C(2)}/confirmed`, 'postgres');
add('the stale prior owner can no longer finalize', fin(O(5), C(1)), 'false');
add('the stale prior owner can no longer release', rel(O(5), C(1)), 'false');
add('... the newer owner is untouched', state(O(5)), `false/${C(2)}/confirmed`, 'postgres');
add('the newer owner finalizes', fin(O(5), C(2)), 'true');
add('a claim with no timestamp is treated as abandoned', claim(O(6), C(2)), 'claimed', 'service_role', `${seed(O(6))} UPDATE public.orders SET booking_confirmation_claim_id = '${C(1)}', booking_confirmation_claimed_at = NULL WHERE id = '${O(6)}';`);
add('a shorter timeout makes a younger claim stale', claim(O(7), C(2), 60), 'claimed', 'service_role', staleSetup(O(7), 90, C(1)));

// invalid
add('a draft order cannot be claimed (invalid)', claim(O(8), C(1)), 'invalid', 'service_role', seed(O(8), 'draft'));
add('an unknown order is invalid', claim('abababab-0000-4000-8000-000000000000', C(1)), 'invalid');
add('a NULL order id is invalid', `SELECT public.claim_booking_confirmation(NULL, '${C(1)}', 600)`, 'invalid');
add('a NULL claim id is invalid', `SELECT public.claim_booking_confirmation('${O(1)}', NULL, 600)`, 'invalid');
add('a stale timeout under sixty seconds is invalid', claim(O(1), C(1), 5), 'invalid');
add('finalize and release with a NULL claim id do nothing', `SELECT public.finalize_booking_confirmation('${O(5)}', NULL)::text || public.release_booking_confirmation('${O(5)}', NULL)::text`, 'falsefalse');
add('a draft order cannot be finalized even with a forged claim id', fin(O(8), C(1)), 'false');
add('a NULL sent flag is treated as unsent', claim(O(9), C(1)), 'claimed', 'service_role', `${seed(O(9))} UPDATE public.orders SET booking_confirmation_sent = NULL WHERE id = '${O(9)}';`);
add('an order already marked sent with a leftover claim is already_sent, never re-claimed', claim(O(10), C(2)), 'already_sent', 'service_role', `${seed(O(10))} UPDATE public.orders SET booking_confirmation_sent = true, booking_confirmation_claim_id = '${C(1)}', booking_confirmation_claimed_at = now() - interval '9999 seconds' WHERE id = '${O(10)}';`);
add('finalize cannot overwrite an order that is already sent', fin(O(10), C(1)), 'false');
add('release cannot clear the claim fields of an already-sent order', rel(O(10), C(1)), 'false');
add('finalize changes nothing but the confirmation columns', `SELECT (SELECT count(*) FROM public.orders WHERE id = '${O(11)}' AND status = 'confirmed' AND subtotal_cents = 1000 AND deposit_due_cents = 100 AND booking_confirmation_sent AND booking_confirmation_claim_id IS NULL)::text`, '1', 'postgres',
  `${seed(O(11))} SELECT public.claim_booking_confirmation('${O(11)}', '${C(1)}', 600); SELECT public.finalize_booking_confirmation('${O(11)}', '${C(1)}');`);
add('new orders start with no claim', `SELECT coalesce(booking_confirmation_claim_id::text, 'none') || '/' || coalesce(booking_confirmation_claimed_at::text, 'none') || '/' || coalesce(booking_confirmation_sent::text, 'null') FROM public.orders WHERE id = '${O(12)}'`, 'none/none/false', 'postgres', seed(O(12)));

// access
for (const [fn, call] of [['claim', claim(O(1), C(9))], ['finalize', fin(O(1), C(9))], ['release', rel(O(1), C(9))]] as Array<[string, string]>) {
  for (const role of ['anon', 'authenticated']) add(`${role} cannot execute ${fn}_booking_confirmation`, call, (v) => v.startsWith('ERR:42501'), role);
  add(`service_role can execute ${fn}_booking_confirmation`, call, (v) => !v.startsWith('ERR:'), 'service_role');
}
add('PUBLIC holds no execute on any of the three', `SELECT count(*)::text FROM pg_proc WHERE proname IN ('claim_booking_confirmation','finalize_booking_confirmation','release_booking_confirmation') AND pronamespace = 'public'::regnamespace AND coalesce(proacl::text, '') ~ '(^|[{,])=X'`, '0', 'postgres');
add('anon and authenticated hold no execute (ACL check)', `SELECT count(*)::text FROM pg_proc p WHERE proname IN ('claim_booking_confirmation','finalize_booking_confirmation','release_booking_confirmation') AND pronamespace = 'public'::regnamespace AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`, '0', 'postgres');
add('service_role holds execute on all three', `SELECT count(*)::text FROM pg_proc p WHERE proname IN ('claim_booking_confirmation','finalize_booking_confirmation','release_booking_confirmation') AND pronamespace = 'public'::regnamespace AND has_function_privilege('service_role', p.oid, 'EXECUTE')`, '3', 'postgres');
add('all three are SECURITY DEFINER with a pinned search_path', `SELECT count(*)::text FROM pg_proc WHERE proname IN ('claim_booking_confirmation','finalize_booking_confirmation','release_booking_confirmation') AND pronamespace = 'public'::regnamespace AND prosecdef AND proconfig::text ~ 'search_path=public'`, '3', 'postgres');
add('the claim columns are not writable by anon or authenticated', `SELECT count(*)::text FROM (VALUES ('anon'), ('authenticated')) r(role) WHERE has_column_privilege(r.role, 'public.orders', 'booking_confirmation_claim_id', 'UPDATE') OR has_column_privilege(r.role, 'public.orders', 'booking_confirmation_claim_id', 'SELECT')`, '0', 'postgres');

// Hosted projects give new functions to anon / authenticated / service_role by default; the migration must take that away.
const DEFAULT_ACL_SQL = 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;\n';

function script(applyMigration: boolean, withDefaultGrants = true): string {
  const calls = steps.map((s, i) => {
    const setup = s.setup ? `EXECUTE ${q(s.setup)};` : '';
    return `  ${setup}\n  RAISE NOTICE 'R|${i}|%', pg_temp.as_role(${q(s.role ?? 'service_role')}, ${q(s.sql)});`;
  });
  return `
BEGIN;
ALTER TABLE public.orders DISABLE TRIGGER USER;
${applyMigration ? (withDefaultGrants ? DEFAULT_ACL_SQL : '') + raw : ''}
CREATE FUNCTION pg_temp.as_role(r text, qry text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE res text;
BEGIN
  IF r <> 'postgres' THEN EXECUTE 'SET LOCAL ROLE ' || quote_ident(r); END IF;
  BEGIN
    EXECUTE qry INTO res;
  EXCEPTION WHEN OTHERS THEN
    res := 'ERR:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN res;
END $f$;
DO $run$
BEGIN
${calls.join('\n')}
END $run$;
ROLLBACK;
`;
}

function execute(psql: string, db: string, label: string, applyMigration: boolean, withDefaultGrants = true) {
  const r = spawnSync(psql, [...argsFor(db), '-v', 'ON_ERROR_STOP=1'], { input: script(applyMigration, withDefaultGrants), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 180000 });
  const results: Record<number, string> = {};
  for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
  const done = Object.keys(results).length === steps.length;
  ok(`executed [${label}]: the script ran to completion in "${db}" (${Object.keys(results).length}/${steps.length} results)`, done);
  if (!done) console.error((r.stderr ?? '').split('\n').filter((l: string) => /ERROR|FATAL|DETAIL/.test(l)).slice(0, 6).join('\n'));
  steps.forEach((s, i) => {
    const got = results[i];
    const good = got !== undefined && (typeof s.expect === 'string' ? got === s.expect : s.expect(got));
    ok(`executed [${label}]: ${s.name} (got ${got})`, good);
  });
}


// Real concurrency: several psql connections at once. A sixth session holds an exclusive advisory lock while the workers queue
// on a shared one, so they are released together and race for the same order.
function psqlAsync(psql: string, db: string, input: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(psql, [...argsFor(db), '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: any) => { out += d.toString(); });
    child.stderr.on('data', (d: any) => { out += d.toString(); });
    child.on('close', (code: number | null) => resolve({ code, out }));
    child.stdin.end(input);
  });
}
const lastLine = (out: string) => out.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
const LOCK = 424242;

async function raceOnDatabase(psql: string, db: string) {
  const hasFns = spawnSync(psql, [...argsFor(db), '-c', "SELECT to_regprocedure('public.claim_booking_confirmation(uuid,uuid,integer)') IS NOT NULL"], { encoding: 'utf8' }).stdout.trim() === 't';
  if (!hasFns) {
    ok(`executed [concurrent connections]: "${db}" contains the claim functions`, !process.env.ROLE_DB_REQUIRE);
    return;
  }
  const id = 'dddddddd-0000-4000-8000-' + String(Date.now() % 1e12).padStart(12, '0');
  const cleanup = () => spawnSync(psql, [...argsFor(db), '-c', `DELETE FROM public.orders WHERE id::text LIKE 'dddddddd-%'`], { encoding: 'utf8' });
  cleanup();
  const seedSql = "BEGIN; ALTER TABLE public.orders DISABLE TRIGGER USER; INSERT INTO public.orders (id, status, location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, balance_due_cents, pickup_preference) VALUES ('" + id + "', 'confirmed', 'residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 1000, 100, 900, 'same_day'); ALTER TABLE public.orders ENABLE TRIGGER USER; COMMIT;";
  const seeded = spawnSync(psql, [...argsFor(db), '-v', 'ON_ERROR_STOP=1'], { input: seedSql, encoding: 'utf8' });
  ok(`executed [concurrent connections]: the scratch order was created in "${db}"`, seeded.status === 0);
  if (seeded.status !== 0) return;
  try {
    const race = async (sqlAfterLock: string, workers: number) => {
      const gate = spawn(psql, [...argsFor(db)], { stdio: ['pipe', 'pipe', 'pipe'] });
      gate.stdin.end(`SELECT pg_advisory_lock(${LOCK}); SELECT pg_sleep(2);`);
      await new Promise((r) => setTimeout(r, 700));
      const runs = Array.from({ length: workers }, () => psqlAsync(psql, db, `SELECT pg_advisory_lock_shared(${LOCK}); SET ROLE service_role; ${sqlAfterLock}`));
      const results = await Promise.all(runs);
      return results.map((r) => lastLine(r.out));
    };

    // five connections claim the same order at the same moment
    const claims = await race(`SELECT public.claim_booking_confirmation('${id}', gen_random_uuid(), 600);`, 5);
    ok(`executed [concurrent connections]: five simultaneous claims produce exactly one winner and four busy (got ${claims.join(',')})`, claims.filter((c) => c === 'claimed').length === 1 && claims.filter((c) => c === 'busy').length === 4);
    const afterClaims = spawnSync(psql, [...argsFor(db), '-c', `SELECT COALESCE(booking_confirmation_sent, false)::text || '/' || (booking_confirmation_claim_id IS NOT NULL)::text FROM public.orders WHERE id = '${id}'`], { encoding: 'utf8' }).stdout.trim();
    ok(`executed [concurrent connections]: ... and the order is in progress, not sent (got ${afterClaims})`, afterClaims === 'false/true');

    // five connections try to finalize with the winning claim id at the same moment: one succeeds
    const winner = '99999999-9999-4999-8999-999999999999';
    spawnSync(psql, [...argsFor(db), '-c', `UPDATE public.orders SET booking_confirmation_claim_id = '${winner}', booking_confirmation_claimed_at = now() WHERE id = '${id}'`], { encoding: 'utf8' });
    const finals = await race(`SELECT public.finalize_booking_confirmation('${id}', '${winner}');`, 5);
    ok(`executed [concurrent connections]: five simultaneous finalizes with the same claim id: exactly one true (got ${finals.join(',')})`, finals.filter((f) => f === 't').length === 1 && finals.filter((f) => f === 'f').length === 4);
    const afterFinal = spawnSync(psql, [...argsFor(db), '-c', `SELECT COALESCE(booking_confirmation_sent, false)::text || '/' || (booking_confirmation_claim_id IS NULL)::text FROM public.orders WHERE id = '${id}'`], { encoding: 'utf8' }).stdout.trim();
    ok(`executed [concurrent connections]: ... and the order ends delivered and unclaimed (got ${afterFinal})`, afterFinal === 'true/true');

    // a finalize racing a release for the same claim: at most one of them wins, and the order is never both
    spawnSync(psql, [...argsFor(db), '-c', `UPDATE public.orders SET booking_confirmation_sent = false, booking_confirmation_claim_id = '${winner}', booking_confirmation_claimed_at = now() WHERE id = '${id}'`], { encoding: 'utf8' });
    const gate = spawn(psql, [...argsFor(db)], { stdio: ['pipe', 'pipe', 'pipe'] });
    gate.stdin.end(`SELECT pg_advisory_lock(${LOCK}); SELECT pg_sleep(2);`);
    await new Promise((r) => setTimeout(r, 700));
    const mixed = await Promise.all([
      psqlAsync(psql, db, `SELECT pg_advisory_lock_shared(${LOCK}); SET ROLE service_role; SELECT public.finalize_booking_confirmation('${id}', '${winner}');`),
      psqlAsync(psql, db, `SELECT pg_advisory_lock_shared(${LOCK}); SET ROLE service_role; SELECT public.release_booking_confirmation('${id}', '${winner}');`),
    ]);
    const outcome = mixed.map((m) => lastLine(m.out));
    ok(`executed [concurrent connections]: a finalize and a release racing for one claim: exactly one wins (got ${outcome.join(',')})`, outcome.filter((o) => o === 't').length === 1 && outcome.filter((o) => o === 'f').length === 1);
  } finally {
    cleanup();
  }
}

(async () => {
const preCandidate = findPsql(dbPre);
const fullCandidate = findPsql(dbFull);
if (!preCandidate || !fullCandidate) {
  if (process.env.ROLE_DB_REQUIRE) ok(`executed: scratch databases "${dbPre}" and "${dbFull}" are available (ROLE_DB_REQUIRE is set)`, false);
  else console.log('EXECUTED layer SKIPPED: the scratch databases for the claim tests were not reachable (see the header of this file).');
} else {
  // the migration text applied on top of the older history, and applied twice (idempotent)
  execute(preCandidate, dbPre, 'older migrations + this migration', true);
  // Without hosted-style default grants, the migration's own GRANT must be what lets service_role execute.
  execute(preCandidate, dbPre, 'older migrations + this migration, no default grants', true, false);
  {
    const twice = script(true).replace('BEGIN;', () => `BEGIN;\n${raw}`);
    const r = spawnSync(preCandidate, [...argsFor(dbPre), '-v', 'ON_ERROR_STOP=1'], { input: twice, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 180000 });
    const n = [...((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)].length;
    if (n !== steps.length) console.error(((r.stderr ?? '') as string).split('\n').filter((l: string) => /ERROR|FATAL/.test(l)).slice(0, 4).join('\n'));
    ok(`executed [migration applied twice]: still runs cleanly and every step answers (${n}/${steps.length})`, n === steps.length);
  }
  // a fresh full replay that already contains the migration
  execute(fullCandidate, dbFull, 'fresh full replay', false);
  await raceOnDatabase(fullCandidate, dbFull);
}


  console.log(`Booking confirmation claim tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} booking confirmation claim test(s) failed`);
})();
