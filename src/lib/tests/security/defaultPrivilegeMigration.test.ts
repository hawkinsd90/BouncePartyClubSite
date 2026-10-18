// 20261026120400 (SEC-015) must FAIL CLOSED: a privilege failure may never end as a recorded success with the default privileges still open.
//
//   STATIC    the migration text (always runs).
//   EXECUTED  the real file is run as different database roles against local scratch databases, in a transaction that is rolled back:
//               superuser operator (what the local replays use)            -> closes the defaults, postcondition holds
//               non-superuser, NOT a member of supabase_admin (a hosted-like operator) -> refused with 42501 when defaults are open,
//                                                                              state unchanged; passes as a no-op when none are open
//               non-superuser MEMBER of supabase_admin                     -> closes the defaults
//               open defaults that this file cannot fix (owner postgres)    -> refused
//             Databases: Production-shaped bpc_replay_prodpre (real supabase_admin defaults), Development-shaped bpc_replay_devpre4 (none)
//             and the repository chain bpc_replay_full25. A missing database is a failure when STEP3B_SHAPES_REQUIRE / CORE_DB_REQUIRE is set.
// Run: node scripts/dev/security-scratch.cjs test defaultPrivilegeMigration

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;
let skipped = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}

const FILE = 'supabase/migrations/20261026120400_restrict_supabase_admin_default_privileges.sql';
const sql: string = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const code = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');

// ---- STATIC ----
ok('static: the file checks the postcondition before and after, and raises when it does not hold', /RAISE EXCEPTION/.test(code) && (code.match(/EXECUTE entries_open INTO leaked/g) ?? []).length === 2);
ok('static: it raises with insufficient_privilege so the whole transaction (and the history row) rolls back', /USING ERRCODE = 'insufficient_privilege'/.test(code));
ok('static: a refused ALTER is remembered, never swallowed as success', /EXCEPTION WHEN insufficient_privilege THEN\s+attempt_error := SQLERRM/.test(code));
ok('static: it creates no role, grants nothing and uses no hosted-only mechanism', !/CREATE ROLE|\bGRANT\b|SECURITY DEFINER|dblink|pg_net/i.test(code.replace(/REVOKE ALL ON (TABLES|SEQUENCES|FUNCTIONS) FROM anon, authenticated/g, '')));
ok('static: the header names the Step 4 rollout and the hosted-capability gate, not an ad hoc manual run', /coordinated Step 4 rollout/.test(sql) && /Step 4 gate/.test(sql) && !/apply manually/i.test(sql));

// ---- EXECUTED ----
const port = process.env.CORE_DB_PORT || '54329';
const host = process.env.CORE_DB_HOST || '127.0.0.1';
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
const COUNT = `(SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(d.defaclrole) IN ('supabase_admin', 'postgres') AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')))`;

function run(db: string, role: string | null, setup = ''): { before: number; after: number; error: string; ok: boolean } | null {
  const BS = String.fromCharCode(92);
  const script = `${BS}set ON_ERROR_ROLLBACK on
${BS}set VERBOSITY default
BEGIN;
CREATE ROLE zz_op NOLOGIN;
CREATE ROLE zz_member NOLOGIN;
GRANT supabase_admin TO zz_member;
${setup}
SELECT 'BEFORE|' || ${COUNT};
${role ? `SET LOCAL ROLE ${role};` : ''}
${sql}
RESET ROLE;
SELECT 'AFTER|' || ${COUNT};
ROLLBACK;
`;
  for (const c of candidates) {
    const r = spawnSync(c, ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-At', '-X', '-q', '-w'], { input: script, encoding: 'utf8', timeout: 60000 });
    const out = (r.stdout ?? '') + '\n' + (r.stderr ?? '');
    if (/database ".*" does not exist/.test(out)) return null;
    const before = /BEFORE\|(\d+)/.exec(out);
    const after = /AFTER\|(\d+)/.exec(out);
    if (!before || !after) continue;
    const err = /ERROR:\s+([^\n]*)/.exec(out);
    return { before: Number(before[1]), after: Number(after[1]), error: err ? err[1] : '', ok: !err };
  }
  return null;
}

const must = !!(process.env.STEP3B_SHAPES_REQUIRE || process.env.CORE_DB_REQUIRE);
function available(db: string): boolean {
  const r = run(db, null);
  if (r === null) {
    if (must) ok(`executed: database ${db} is available`, false);
    else { skipped++; console.log(`SKIPPED: database ${db} not present`); }
    return false;
  }
  return true;
}

if (available('bpc_replay_prodpre')) {
  const db = 'bpc_replay_prodpre';
  let r = run(db, null)!;
  ok(`executed [Production-shaped]: real supabase_admin defaults are open before (got ${r.before})`, r.before > 0);
  ok('executed [Production-shaped, superuser operator as in the local replays]: succeeds and the postcondition holds', r.ok && r.after === 0);
  r = run(db, 'zz_op')!;
  ok('executed [Production-shaped, non-superuser non-member operator]: refused with the explicit message, defaults unchanged, nothing recorded as success', !r.ok && /still name anon, authenticated or PUBLIC/.test(r.error) && r.after === r.before && r.after > 0);
  r = run(db, 'zz_member')!;
  ok('executed [Production-shaped, member of supabase_admin]: succeeds and the postcondition holds', r.ok && r.after === 0);
  r = run(db, null, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon;`)!;
  ok('executed [Production-shaped, open defaults of the owner role that this file cannot fix]: refused', !r.ok && /still name/.test(r.error) && r.after > 0);
  r = run(db, 'zz_op', `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated; ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated; ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;`)!;
  ok('executed [Production-shaped, defaults already closed by the owner from the dashboard]: a non-superuser operator now passes as a no-op (the Step 4 gate procedure works)', r.ok && r.before === 0 && r.after === 0);
  r = run(db, null, sql)!;
  ok('executed [Production-shaped]: running the file twice is safe', r.ok && r.after === 0);
}
for (const [db, label] of [['bpc_replay_devpre4', 'Development-shaped'], ['bpc_replay_full25', 'repository chain']] as const) {
  if (!available(db)) continue;
  let r = run(db, null)!;
  ok(`executed [${label}]: no open public defaults before (got ${r.before}) and the file passes as a no-op for a superuser`, r.before === 0 && r.ok && r.after === 0);
  r = run(db, 'zz_op')!;
  ok(`executed [${label}]: a non-superuser non-member operator also passes (nothing to change, so no privilege is needed)`, r.ok && r.after === 0);
  r = run(db, 'zz_op', `SET LOCAL ROLE postgres;`)!;
  ok(`executed [${label}]: still passes after switching back`, r.ok);
}

console.log(`default privilege migration tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) throw new Error(`${failed} default privilege migration test(s) failed`);
