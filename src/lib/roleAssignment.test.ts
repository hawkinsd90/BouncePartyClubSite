// Role assignment and new-user provisioning repair.
//
// Layers, labelled so nobody mistakes one for another:
//   STATIC    parses the migration text (always runs).
//   SOURCE    checks the browser code that calls the repaired function still fits it (always runs).
//   EXECUTED  runs real SQL as the real anon / authenticated / service_role Postgres roles against SCRATCH PostgreSQL databases.
//             It never touches a Supabase project. Every script runs in a transaction that is rolled back.
//               ROLE_DB_PRE   a replay of every repository migration EXCEPT this one (the migration text is applied by the test)
//               ROLE_DB_FULL  a replay of every repository migration INCLUDING this one (a fresh full replay)
//             Defaults: "role_pre" / "role_full" on 127.0.0.1:54329 (override with ROLE_DB_PORT, ROLE_DB_HOST, CORE_DB_PSQL).
//             With no reachable database the layer is SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/roleAssignment.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import {
  assignmentScenarios, signupScenarios, devLikeScenarios, buildRoleScript, DEV_PRE_SQL, FIXTURE_SQL, LEGACY_PRE_SQL, LEGACY_UNKNOWN_ROLE_SQL, LEGACY_NO_AUTH_USERS_SQL, legacyScenarios, PRE_GRANTS_SQL, type RoleScenario,
} from './roleAssignmentScenarios';

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

const MIG_DIR = 'supabase/migrations/';
const MIG_NAME = '20261016120000_repair_role_assignment_and_signup_provisioning.sql';
const raw = read(MIG_DIR + MIG_NAME);
const sql = stripSql(raw);
const flat = norm(sql);

// ---------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------
const files: string[] = fs.readdirSync(MIG_DIR).filter((f: string) => f.endsWith('.sql')).sort();
ok('static: the migration sorts after every other migration (it is the newest)', files[files.length - 1] === MIG_NAME);
ok('static: exactly one migration was added for this repair', files.filter((f: string) => f.includes('repair_role_assignment_and_signup_provisioning')).length === 1);
ok('static: the migration name is descriptive and carries no internal label', !/(^|[^a-z])(phase|stage)[ _-]?[a-z0-9]|_a1_|_a_/i.test(MIG_NAME) && !/\b(Phase|Stage)\s?[A-Z0-9]|\bA1\b/.test(raw));

const assignFn = (() => {
  const i = sql.indexOf('CREATE OR REPLACE FUNCTION public.assign_role_by_email');
  const e = sql.indexOf('$function$;', sql.indexOf('$function$', i) + 10);
  return norm(sql.slice(i, e));
})();
const signupFn = (() => {
  const i = sql.indexOf('CREATE OR REPLACE FUNCTION public.auto_assign_customer_role');
  const e = sql.indexOf('$function$;', sql.indexOf('$function$', i) + 10);
  return norm(sql.slice(i, e));
})();
ok('static: assign_role_by_email is replaced', assignFn.length > 200);
ok('static: auto_assign_customer_role is replaced', signupFn.length > 200);
ok('static: no user_roles insert arbitrates ON CONFLICT (user_id) alone', !/INSERT INTO public\.user_roles[^;]*ON CONFLICT \(user_id\)/i.test(sql));
ok('static: the arbiter that exists is used where a conflict is possible', /ON CONFLICT \(user_id, role\) DO NOTHING/.test(assignFn) && /ON CONFLICT \(user_id, role\) DO NOTHING/.test(signupFn));
ok('static: the requested role is trimmed and lowercased', /v_role := lower\(btrim\(p_role, E' \\t\\r\\n'\)\)/.test(assignFn));
ok('static: normalization comes before the master / admin authorization checks', assignFn.indexOf('v_role := lower(btrim(p_role') < assignFn.indexOf("v_role = 'master'") && assignFn.indexOf('v_role := lower(btrim(p_role') < assignFn.indexOf("v_role = 'admin'"));
ok('static: the allowlist is exactly master, admin, crew', /v_role NOT IN \('master', 'admin', 'crew'\)/.test(assignFn));
ok('static: the master guard compares the normalized value', /v_role = 'master' AND v_caller_role <> 'master'/.test(assignFn));
ok('static: the master guard never compares the raw input', !/p_role\s*(=|<>|!=)\s*'/.test(assignFn) && !/p_role IN \(/.test(assignFn));
ok('static: the caller role is read case-insensitively and the highest role wins', /bool_or\(lower\(btrim\(role\)\) = 'master'\)/.test(assignFn) && /bool_or\(lower\(btrim\(role\)\) = 'admin'\)/.test(assignFn));
ok('static: the function is SECURITY DEFINER with a fixed search_path', /SECURITY DEFINER/.test(assignFn) && /SET search_path TO 'public'|SET search_path = public/.test(assignFn));
ok('static: the target is serialized with an advisory lock', /pg_advisory_xact_lock\(/.test(assignFn));
ok('static: stale extra rows for the target are removed and one row is kept', /DELETE FROM public\.user_roles WHERE user_id = v_target_id AND id <> v_keep/.test(assignFn));
ok('static: unknown email still returns false', /RETURN false/.test(assignFn) && /RETURN true/.test(assignFn));
ok('static: assign_role_by_email grants are explicit (authenticated, service_role; not PUBLIC / anon)', /REVOKE ALL ON FUNCTION public\.assign_role_by_email\(text, text\) FROM PUBLIC, anon;/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.assign_role_by_email\(text, text\) TO authenticated, service_role;/.test(sql));
ok('static: the signup function grants stay server-only', /REVOKE ALL ON FUNCTION public\.auto_assign_customer_role\(\) FROM PUBLIC, anon, authenticated;/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.auto_assign_customer_role\(\) TO service_role;/.test(sql));
ok('static: signup provisioning only adds customer when the user has no role', /INSERT INTO public\.user_roles \(user_id, role\) SELECT NEW\.id, 'customer' WHERE NOT EXISTS \(SELECT 1 FROM public\.user_roles ur WHERE ur\.user_id = NEW\.id\) ON CONFLICT \(user_id, role\) DO NOTHING/.test(signupFn));
ok('static: signup provisioning never updates or deletes an existing role', !/(UPDATE|DELETE FROM) public\.user_roles/i.test(signupFn));
ok('static: the signup exception handler is preserved (logs and returns NEW)', /EXCEPTION WHEN OTHERS THEN/.test(signupFn) && /auth_trigger_logs/.test(signupFn) && /RETURN NEW;\s*END;?\s*$|RETURN NEW; END/.test(signupFn));
ok('static: the CHECK accepts the lowercase vocabulary only', /CHECK \(role IN \('master', 'admin', 'crew', 'customer'\)\)/.test(sql) && !/'(MASTER|ADMIN|CREW|CUSTOMER)'/.test(sql.replace(/lower\([^)]*\)/g, '')));
ok('static: legacy CHECK constraints are dropped whatever their name', /DROP CONSTRAINT/.test(sql) && /pg_get_constraintdef/.test(sql));
ok('static: existing role values are normalized before the CHECK is added', sql.indexOf('UPDATE public.user_roles') >= 0 && sql.indexOf('UPDATE public.user_roles') < sql.indexOf('ADD CONSTRAINT user_roles_role_check'));
ok('static: unknown stored role values stop the migration instead of being guessed', /RAISE EXCEPTION/.test(sql.slice(0, sql.indexOf('ADD CONSTRAINT user_roles_role_check'))));
ok('static: the foreign key is restored with ON DELETE CASCADE only when none exists', /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/.test(sql) && /contype = 'f'/.test(sql));
ok('static: only orphan role rows are removed', /DELETE FROM public\.user_roles[\s\S]{0,200}NOT EXISTS \(SELECT 1 FROM auth\.users/.test(sql));
ok('static: UNIQUE (user_id) is not added', !/UNIQUE\s*\(\s*user_id\s*\)/i.test(sql) && !/ADD CONSTRAINT[^;]*UNIQUE/i.test(sql));
ok('static: the signup trigger is recreated once, AFTER INSERT on auth.users', (sql.match(/CREATE TRIGGER /g) ?? []).length === 1 && /CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth\.users FOR EACH ROW EXECUTE FUNCTION public\.auto_assign_customer_role\(\)/.test(flat));
ok('static: other trigger names that ran the signup function are removed first', /DROP TRIGGER/.test(sql) && /tgfoid/.test(sql));
ok('static: get_user_role is not modified', !/FUNCTION public\.get_user_role\b/.test(sql));
ok('static: assign_user_role / remove_user_role / get_user_highest_role / user_has_role / get_admin_users are not touched', !/FUNCTION public\.(assign_user_role|remove_user_role|get_user_highest_role|user_has_role|get_admin_users)\b/.test(sql));
ok('static: no default privileges are changed', !/ALTER DEFAULT PRIVILEGES/i.test(sql));
ok('static: no other table is touched except customer_profiles name columns', !/ALTER TABLE public\.(?!user_roles|customer_profiles)/i.test(sql));
ok('static: nothing is applied outside the migration (no BEGIN / COMMIT statements at top level)', !/^\s*(BEGIN|COMMIT);/m.test(raw));
ok('static: the migration carries no internal planning labels', !/\b(Phase|Stage) ?[A-Z0-9]\b|\bA1\b|\bBatch [A-Z]\b/.test(raw));
ok('static: no real Production project reference is in the migration', !raw.includes('qaagfafagdpgzcijnfbw'));

// ---------------------------------------------------------------------------------------------------------------
// SOURCE: the Permissions screen still fits the repaired function
// ---------------------------------------------------------------------------------------------------------------
const perm = read('src/components/admin/PermissionsTab.tsx');
const auth = read('src/contexts/AuthContext.tsx');
ok('source: the Permissions screen calls assign_role_by_email with user_email and user_role', /\.rpc\(\s*['"]assign_role_by_email['"][\s\S]{0,200}user_email[\s\S]{0,120}user_role/.test(perm) || /assign_role_by_email[\s\S]{0,300}p_email[\s\S]{0,120}p_role/.test(perm));
ok('source: a false result is still handled as "user not found"', /=== false|!data|data === false|if \(!.*\)\s*\{[\s\S]{0,200}not found/i.test(perm));
ok('source: the role options sent are lowercase (crew / admin) and the master button is offered only to a master', /<option value="crew">/.test(perm) && /<option value="admin">/.test(perm) && /currentUserRole === 'master'/.test(perm) && /handleRoleChange\(user, 'master'\)/.test(perm) && !/value="(Crew|Admin|Master|CREW|ADMIN|MASTER)"/.test(perm));
ok('source: nothing in the screen offers "customer" through the assign RPC', !/assign_role_by_email[\s\S]{0,300}['"]customer['"]/.test(perm));
{
  const fnBody = (name: string): string => {
    const i = perm.indexOf(`function ${name}(`);
    const j = perm.indexOf('\n  }\n', i);
    return i >= 0 && j > i ? perm.slice(i, j) : '';
  };
  const add = fnBody('handleAddUserByEmail');
  const change = fnBody('handleRoleChange');
  const canManage = perm.slice(perm.indexOf('const canManageUser'), perm.indexOf('};', perm.indexOf('const canManageUser')));
  // Add User (the only way a signed-up customer can be given a staff role: the list below never shows customers)
  ok('source: Add User is offered to a master or an admin only', /\(currentUserRole === 'master' \|\| currentUserRole === 'admin'\) && \(\s*<button[\s\S]{0,200}setShowAddForm/.test(perm));
  ok('source: Add User sends the lowercase chosen role to assign_role_by_email, which is typed admin | crew', /useState<'admin' \| 'crew'>\('crew'\)/.test(perm) && /p_role: addRole,/.test(add));
  ok('source: Add User defaults to crew and only a master is offered admin', /currentUserRole === 'master' && <option value="admin">/.test(perm) && /<option value="crew">/.test(perm));
  ok('source: Add User never offers master', !/<option value="master"/.test(perm));
  ok('source: Add User does no client-side check of the target (a signed-up customer is allowed; the database decides)', add.length > 0 && !/canManageUser|user\.role|users\.find/.test(add));
  ok('source: Add User explains it is for users who have already signed up (customers)', /must have already signed up before a role can be assigned/.test(perm));
  ok('source: Add User treats false / null as "user not found"', /data === false \|\| data === null/.test(add));
  // The list (existing-user management): only staff rows, never customers
  const listFn = (() => {
    const names = files.filter((f: string) => /get_all_role_users/.test(read(MIG_DIR + f)) && /FUNCTION public\.get_all_role_users/.test(read(MIG_DIR + f)));
    return names.length ? read(MIG_DIR + names[names.length - 1]) : '';
  })();
  ok('source: the permissions list is fed by get_all_role_users, which returns staff roles only (customers never appear in it)', /rpc\('get_all_role_users'\)/.test(perm) && /LOWER\(ur\.role\) IN \('master', 'admin', 'crew'\)/.test(listFn));
  // Existing-user management
  ok('source: canManageUser - a master manages anyone', /currentUserRole === 'master'\) return true/.test(canManage));
  ok('source: canManageUser - an admin manages only crew or no-role targets (never admin / master)', /currentUserRole === 'admin'\) return targetRole === 'crew' \|\| targetRole === null/.test(canManage) && !/targetRole === '(admin|master)'/.test(canManage));
  ok('source: the Master and Admin role buttons exist only for a master', /currentUserRole === 'master' && \(\s*<>\s*<button[\s\S]{0,250}handleRoleChange\(user, 'master'\)[\s\S]{0,500}handleRoleChange\(user, 'admin'\)/.test(perm));
  ok('source: the Crew button and role removal are available wherever canManageUser allows', /canManageUser\(user\.role \?\? null\) && \([\s\S]{0,1800}handleRoleChange\(user, 'crew'\)[\s\S]{0,600}handleRemoveRole\(user\)/.test(perm));
  ok('source: changing and removing a role are direct table writes (not the assign RPC), so they are governed by row policies', /\.from\('user_roles'\)\s*\.update\(\{ role: newRole \}\)/.test(change) && /\.from\('user_roles'\)\s*\.delete\(\)/.test(fnBody('handleRemoveRole')) && !/assign_role_by_email/.test(change));
}
ok('source: the app reads one role per user (maybeSingle) and the role type is lowercase', /maybeSingle\(\)/.test(auth) && /'master'|"master"/.test(auth) && /'crew'|"crew"/.test(auth));
ok('source: no browser code writes a capitalised role value', !/role:\s*['"](Admin|Master|Crew|Customer|ADMIN|MASTER)['"]/.test(read('src/contexts/AuthContext.tsx') + perm));

// ---------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------
const port = process.env.ROLE_DB_PORT || process.env.CORE_DB_PORT || '54329';
const host = process.env.ROLE_DB_HOST || process.env.CORE_DB_HOST || '127.0.0.1';
const dbPre = process.env.ROLE_DB_PRE || 'role_pre';
const dbFull = process.env.ROLE_DB_FULL || 'role_full';
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
const argsFor = (db: string) => ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-At', '-X', '-q'];

function findPsql(db: string, probeSql: string): string | null {
  for (const c of candidates) {
    const p = spawnSync(c, [...argsFor(db), '-c', probeSql], { encoding: 'utf8', timeout: 15000 });
    if (p.status === 0 && p.stdout.trim() === 't') return c;
  }
  return null;
}

function execute(psql: string, db: string, label: string, scenarios: RoleScenario[], script: string) {
  const r = spawnSync(psql, [...argsFor(db), '-v', 'ON_ERROR_STOP=1'], { input: script, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 180000 });
  const results: Record<number, string> = {};
  for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
  const done = Object.keys(results).length === scenarios.length;
  ok(`executed [${label}]: the scenario script ran to completion in "${db}" (${Object.keys(results).length}/${scenarios.length} results)`, done);
  if (!done) console.error((r.stderr ?? '').split('\n').filter((l: string) => /ERROR|FATAL/.test(l)).slice(0, 5).join('\n'));
  scenarios.forEach((s, i) => {
    const got = results[i];
    const good = got !== undefined && (typeof s.expect === 'string' ? got === s.expect : s.expect(got));
    ok(`executed [${label}]: ${s.name} (got ${got})`, good);
  });
  return results;
}

const needPre = findPsql(dbPre, "SELECT to_regprocedure('public.assign_role_by_email(text,text)') IS NOT NULL AND to_regclass('public.user_roles') IS NOT NULL");
const needFull = findPsql(dbFull, "SELECT to_regprocedure('public.auto_assign_customer_role()') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created')");

if (!needPre || !needFull) {
  if (process.env.ROLE_DB_REQUIRE) ok(`executed: scratch databases "${dbPre}" and "${dbFull}" are available (ROLE_DB_REQUIRE is set)`, false);
  else console.log('EXECUTED layer SKIPPED: the scratch databases for the role tests were not reachable (see the header of this file).');
} else {
  const migrationSql = raw;
  const assignments = assignmentScenarios();
  const signups = signupScenarios();
  const devLike = devLikeScenarios();

  // 1. the real migration text applied on top of the replay of every older migration
  execute(needPre, dbPre, 'older migrations + this migration: assignment', assignments, buildRoleScript({ preMigrationSql: PRE_GRANTS_SQL, migrationSql, scenarios: assignments }));
  execute(needPre, dbPre, 'older migrations + this migration: signup', signups, buildRoleScript({ preMigrationSql: PRE_GRANTS_SQL, migrationSql, scenarios: signups }));

  // 2. a fresh full replay that already contains the migration (no migration text applied by the test)
  execute(needFull, dbFull, 'fresh full replay: assignment', assignments, buildRoleScript({ scenarios: assignments }));
  execute(needFull, dbFull, 'fresh full replay: signup', signups, buildRoleScript({ scenarios: signups }));

  // 3. the live Dev-like state (no CHECK, no foreign key, no trigger, lowercase data, orphan rows) with the migration on top
  execute(needFull, dbFull, 'Dev-like state + this migration', devLike, buildRoleScript({ preMigrationSql: DEV_PRE_SQL, migrationSql, fixtureSql: '', scenarios: devLike }));
  const devAssign = assignments.filter((sc) => !/foreign key|CASCADE|CHECK|UNIQUE|unknown email changes no role/.test(sc.name));
  execute(needFull, dbFull, 'Dev-like state + this migration: assignment', devAssign, buildRoleScript({ preMigrationSql: DEV_PRE_SQL, migrationSql, fixtureSql: '', scenarios: devAssign }));

  // 4. applying the migration twice is harmless
  const twice = devLikeScenarios().slice(0, 7);
  execute(needFull, dbFull, 'migration applied twice', twice, buildRoleScript({ preMigrationSql: DEV_PRE_SQL, migrationSql: migrationSql + '\n' + migrationSql, fixtureSql: '', scenarios: twice }));
  void FIXTURE_SQL;

  // 5. legacy casing / whitespace / duplicate rows are normalized
  const legacy = legacyScenarios();
  execute(needFull, dbFull, 'legacy role casing + this migration', legacy, buildRoleScript({ preMigrationSql: LEGACY_PRE_SQL, migrationSql, fixtureSql: '', scenarios: legacy }));

  // 6. the migration refuses to guess: an unknown stored role, or an empty auth.users, stops it and changes nothing
  const refuse = (label: string, pre: string, message: string) => {
    const r = spawnSync(needFull, [...argsFor(dbFull), '-v', 'ON_ERROR_STOP=1'], { input: `BEGIN;\n${pre}\n${migrationSql}\nROLLBACK;\n`, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
    const firstError = ((r.stderr ?? '') as string).split('\n').find((l: string) => /ERROR/.test(l)) ?? 'no error';
    ok(`executed [${label}]: the migration stops with "${message}" (got ${firstError})`, r.status !== 0 && (r.stderr ?? '').includes(message));
  };
  refuse('unknown stored role', LEGACY_PRE_SQL + LEGACY_UNKNOWN_ROLE_SQL, 'review those rows before applying this migration');
  refuse('empty auth.users', LEGACY_PRE_SQL + LEGACY_NO_AUTH_USERS_SQL + "INSERT INTO public.user_roles (user_id, role) VALUES ('99999999-0000-4000-8000-0000000000b1', 'crew');", 'refusing to treat every user_roles row as an orphan');
}

console.log(`Role assignment tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} role assignment test(s) failed`);
