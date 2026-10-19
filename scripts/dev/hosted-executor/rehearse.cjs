#!/usr/bin/env node
'use strict';
// Local rehearsal and negative-control harness for the exact-version migration executor (Step 4A.1, D-01).
// LOCAL SCRATCH POSTGRESQL ONLY (127.0.0.1, databases bpc_exec_*). It never contacts a hosted project and never reads a credential.
//
//   node scripts/dev/hosted-executor/rehearse.cjs --package SEALED.json --template bpc_replay_dev_s3 --out results.json
//
// Scenario groups: S (end-to-end and failure/restart behaviour), P (package and approval refusals), H (hosted gating, refusal paths only),
// V (violation x guard mutation matrix at script level), E (hosted-like privileges: which of the 28 files a non-superuser, non-member operator can run).

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const X = require('./dev-migration-executor.cjs');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const PKG = path.resolve(arg('package')), TEMPLATE = arg('template', 'bpc_replay_dev_s3'), OUT = arg('out'), PORT = arg('port', '54329');
const PSQL = process.env.BPC_PSQL || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const EXE = path.join(__dirname, 'dev-migration-executor.cjs');
const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const BASE = pkg.start_state;
const ONLY = arg('only', '');
const want = (g) => !ONLY || ONLY === g;
const results = [];
function check(id, label, cond, detail) { results.push({ id, label, pass: !!cond, detail: detail === undefined ? '' : String(detail).slice(0, 300) }); console.log((cond ? 'ok   ' : 'FAIL ') + id + ' ' + label + (cond ? '' : ' :: ' + String(detail).slice(0, 200))); }

const psqlRaw = (db, sql, flags = []) => cp.spawnSync(PSQL, ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, ...flags, '-f', '-'], { input: sql, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, PGCLIENTENCODING: 'UTF8' }, maxBuffer: 64 * 1024 * 1024 });
const sql = (db, text, flags) => { const r = psqlRaw(db, text, flags); return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };
const val = (db, text) => { const r = sql(db, text); if (r.code !== 0) throw new Error(r.err); return r.out; };
function clone(name, tpl = TEMPLATE) {
  const db = 'bpc_exec_' + name;
  for (const c of [`drop database if exists "${db}" with (force)`, `create database "${db}" template "${tpl}"`, `comment on database "${db}" is 'bpc-migration-executor-scratch:v1'`]) { const r = sql('postgres', c); if (r.code !== 0) throw new Error(r.err); }
  return db;
}
let auditN = 0;
const auditDir = () => path.join(os.tmpdir(), `bpc-rehearse-${process.pid}-${++auditN}`);
function exe(args, env = {}) {
  const r = cp.spawnSync('node', [EXE, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, ...env }, maxBuffer: 64 * 1024 * 1024 });
  let json = null; const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop(); try { json = JSON.parse(line); } catch (e) { json = null; }
  return { code: r.status, json, raw: (r.stdout || '') + (r.stderr || '') };
}
const common = (db, audit, o = {}) => ['--package', o.pkg || PKG, '--db', db, '--audit-dir', audit, '--approval-hash', o.hash || pkg.document_sha256, '--expect-base-count', String(o.count ?? BASE.base_count), '--expect-base-sha256', o.sha || BASE.base_sha256, '--port', PORT];
const fingerprintOf = (db) => { const r = sql(db, X_FP, ['-1']); return r.out.split('\n').filter((l) => l.includes('|')).join(';'); };
const X_FP = require('./lib/fingerprint.cjs').READ_ONLY_STATEMENT;
const ledgerCount = (db) => Number(val(db, 'select count(*) from supabase_migrations.schema_migrations'));
const withPkg = (mutate, rehash) => { const p = JSON.parse(JSON.stringify(pkg)); mutate(p); if (rehash) X.sealHash(p); const f = path.join(os.tmpdir(), `bpc-pkg-${process.pid}-${++auditN}.json`); fs.writeFileSync(f, JSON.stringify(p)); return { file: f, hash: p.document_sha256 }; };
const lastEvent = (audit, ev) => { const rs = fs.readFileSync(path.join(audit, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); return rs.filter((r) => r.event === ev); };

console.log('package', pkg.document_sha256, 'items', pkg.items.length);
const V = pkg.items.map((i) => i.version);

// ---------------------------------------------------------------- S: end to end
if (want('S')) {
  const db = clone('s01'), a = auditDir();
  const pl = exe(['plan', ...common(db, a)]);
  check('S01a', 'plan shows 28 remaining, observed base equals the approved export, containment in force', pl.json && pl.json.remaining.length === 28 && pl.json.observed_base_count === BASE.base_count && pl.json.observed_base_sha256 === BASE.base_sha256 && pl.json.containment_in_force === true, pl.raw);
  const rp = path.join(os.tmpdir(), `bpc-report-${process.pid}.json`);
  const r = exe(['run', ...common(db, a), '--report', rp]);
  check('S01b', 'full run executes all 28 in order and records 28 ledger rows (88 total)', r.json && r.json.ok && r.json.executed.join() === V.join() && r.json.ledger_rows_total === BASE.base_count + 28 && r.json.base_unchanged, r.raw);
  const led = val(db, "select count(*) filter (where statements[1] like '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%' and statements[2] is not null and name !~ '^\\d') from supabase_migrations.schema_migrations");
  check('S01c', 'every package ledger row carries version, CLI-style name, marker and the exact SQL text', led === '28', led);
  const rep = JSON.parse(fs.readFileSync(rp, 'utf8'));
  check('S01h', 'the sanitized execution report records ledger identity before/after (60 -> 88 rows), 28 new versions, no pre-existing row modified, 28 steps with fingerprints and denied probes, and no SQL text or connection data', rep.ledger_before.rows === 60 && rep.ledger_after.rows === 88 && rep.new_versions.length === 28 && rep.pre_existing_rows_modified_or_removed.length === 0 && rep.steps.length === 28 && rep.steps.every((x) => /^[0-9a-f]{32}$/.test(x.fingerprint) && x.probes.anon === 'denied') && !/CREATE |ALTER |postgres(ql)?:\/\/|password/i.test(JSON.stringify(rep)), JSON.stringify(rep).slice(0, 200));
  const v = exe(['verify', ...common(db, a)]);
  check('S01d', 'verify: nothing missing and the final catalog fingerprint equals the rehearsed one', v.json && v.json.ok && v.json.fingerprint_matches_final === true, v.raw);
  const r2 = exe(['run', ...common(db, a)]);
  check('S01e', 'a second run executes nothing (previously recorded versions are detected, no duplicate rows)', r2.json && r2.json.ok && r2.json.executed.length === 0 && ledgerCount(db) === BASE.base_count + 28, r2.raw);
  const steps = lastEvent(a, 'step_end');
  check('S01f', 'every step recorded a post-commit role probe: anon and authenticated denied on public.orders', steps.length === 28 && steps.every((s) => s.probes && s.probes.anon === 'denied' && s.probes.authenticated === 'denied'));
  const noCreds = !/password|postgres(ql)?:\/\//i.test(fs.readFileSync(path.join(a, 'audit.jsonl'), 'utf8'));
  check('S01g', 'the audit store holds no credentials or connection strings', noCreds);
}
// S02 crash after commit, restart reconciles
if (want('S')) {
  const db = clone('s02'), a = auditDir();
  const r = exe(['run', ...common(db, a)], { BPC_EXECUTOR_TEST_HOOK: 'crash-after-commit:20261012120000' });
  check('S02a', 'process killed right after the commit of step 7: exit 9, 7 package rows in the ledger, no step_end for it', r.code === 9 && ledgerCount(db) === BASE.base_count + 7 && !lastEvent(a, 'step_end').some((s) => s.version === '20261012120000'), r.raw + ledgerCount(db));
  const r2 = exe(['run', ...common(db, a)]);
  check('S02b', 'restart reconciles the missing audit end record from the ledger and completes the remaining 21 steps', r2.json && r2.json.ok && r2.json.reconciled.includes('20261012120000') && r2.json.executed.length === 21 && ledgerCount(db) === BASE.base_count + 28, r2.raw);
  check('S02c', 'the audit store notes the incomplete prior run', lastEvent(a, 'prior_run_incomplete').length === 1);
}
// S03 connection killed mid-run
if (want('S')) {
  const db = clone('s03'), a = auditDir();
  const r = exe(['run', ...common(db, a)], { BPC_EXECUTOR_TEST_HOOK: 'kill-psql:600:20261019120000' });
  const n = ledgerCount(db);
  const prefixOnly = val(db, `select count(*) from supabase_migrations.schema_migrations where version = '20261019120000'`) === '0' || r.json.failed === null;
  check('S03a', 'psql killed during step 17 (client side): run stops as failed, no partial ledger row for that step', r.json && (r.json.ok === false ? r.json.failed.version === '20261019120000' && !r.json.failed.ledger_row_present : true) && prefixOnly, r.raw);
  const r2 = exe(['run', ...common(db, a)]);
  check('S03b', 'a rerun after the interruption reaches the same final state with a verified fingerprint', r2.json && r2.json.ok && ledgerCount(db) === BASE.base_count + 28 && exe(['verify', ...common(db, a)]).json.ok, r2.raw + n);
}
// S04 failed SQL (statement timeout)
if (want('S')) {
  const db = clone('s04'), a = auditDir(); const before = fingerprintOf(db);
  const r = exe(['run', ...common(db, a), '--statement-timeout-ms', '1']);
  check('S04a', 'a SQL failure inside a step rolls the whole step back: nothing recorded, catalog unchanged, run reported failed', r.json && r.json.ok === false && r.json.failed && r.json.failed.ledger_row_present === false && ledgerCount(db) === BASE.base_count && fingerprintOf(db) === before, r.raw);
  const r2 = exe(['run', ...common(db, a)]);
  check('S04b', 'after fixing the cause the same run completes', r2.json && r2.json.ok && ledgerCount(db) === BASE.base_count + 28, r2.raw);
}
// S05..S07 ledger refusals
if (want('S')) {
  const db = clone('s05'), a = auditDir(); exe(['run', ...common(db, a)]);
  sql(db, `delete from supabase_migrations.schema_migrations where version = '20261011120000'`);
  const r = exe(['run', ...common(db, a)]);
  check('S05', 'a package version missing from the middle of the recorded set is refused (recorded versions must be a prefix)', r.json && r.json.refused && r.json.code === 'ledger', r.raw);
  const db6 = clone('s06'), a6 = auditDir(); sql(db6, `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20990101000000','stray',ARRAY['-- stray'])`);
  const r6 = exe(['run', ...common(db6, a6)]);
  check('S06', 'an unexpected extra ledger row (outside the approved export) is refused before any step', r6.json && r6.json.refused && r6.json.code === 'ledger' && ledgerCount(db6) === BASE.base_count + 1, r6.raw);
  const db7 = clone('s07'), a7 = auditDir(); const r7 = exe(['run', ...common(db7, a7, { sha: 'f'.repeat(64) })]);
  check('S07', 'a wrong approved-export hash is refused', r7.json && r7.json.refused && ledgerCount(db7) === BASE.base_count, r7.raw);
  const db7b = clone('s07b'), a7b = auditDir(); sql(db7b, `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261007120000','fake',ARRAY['-- BPC-LOCAL-EXECUTOR executed'])`);
  const r7b = exe(['run', ...common(db7b, a7b)]);
  check('S07b', 'a pre-existing foreign row for a package version is refused (not written by this executor)', r7b.json && r7b.json.refused && r7b.json.code === 'ledger', r7b.raw);
}
// S08 unexpected schema state, S09 security regression
if (want('S')) {
  const db = clone('s08'), a = auditDir(); sql(db, `create function public.zz_unexpected() returns int language sql as 'select 1'`);
  const r = exe(['run', ...common(db, a)]);
  check('S08a', 'an unexpected function in the public schema stops the first step at the in-transaction pre-fingerprint; nothing recorded', r.json && r.json.ok === false && /fingerprint mismatch/.test(r.json.failed.error) && ledgerCount(db) === BASE.base_count, r.raw);
  const db2 = clone('s08b'), a2 = auditDir(); sql(db2, `alter policy "Customers can view own orders" on public.orders using (true)`);
  const r2 = exe(['run', ...common(db2, a2)]);
  check('S08b', 'a modified policy is refused the same way', r2.json && r2.json.ok === false && /fingerprint mismatch/.test(r2.json.failed.error), r2.raw);
  const db3 = clone('s09'), a3 = auditDir(); sql(db3, `grant usage on schema public to anon`);
  const r3 = exe(['run', ...common(db3, a3)]);
  check('S09', 'a security-posture regression (anon granted USAGE on public) stops the first step; nothing recorded', r3.json && r3.json.ok === false && /containment|fingerprint/.test(r3.json.failed.error) && ledgerCount(db3) === BASE.base_count, r3.raw);
}
// S10 postcondition failure after the SQL ran
if (want('S')) {
  const bad = withPkg((p) => { p.items[2].post_fp_all = 'a'.repeat(32); p.items[3].pre_fp_all = 'a'.repeat(32); }, true);
  const db = clone('s10'), a = auditDir();
  const r = exe(['run', ...common(db, a, { pkg: bad.file, hash: bad.hash })]);
  const f2 = fingerprintOf(db);
  check('S10a', 'a wrong expected post-state: step 3 executes, fails its postcondition and is rolled back; steps 1-2 stay recorded; nothing partial', r.json && r.json.ok === false && r.json.failed.version === '20261009120000' && ledgerCount(db) === BASE.base_count + 2 && /post/.test(r.json.failed.error), r.raw);
  const v = val(db, "select count(*) from supabase_migrations.schema_migrations where version = '20261009120000'");
  check('S10b', 'no ledger row for the rolled-back step', v === '0');
}

// ---------------------------------------------------------------- P: package and approval refusals
if (want('P')) {
  const db = clone('p01'), a = auditDir();
  let r = exe(['run', ...common(db, a, { hash: 'e'.repeat(64) })]); check('P01', 'a wrong typed approval hash is refused', r.json && r.json.refused && r.json.code === 'approval', r.raw);
  r = exe(['run', '--package', PKG, '--db', db, '--audit-dir', a, '--expect-base-count', '60', '--expect-base-sha256', BASE.base_sha256, '--port', PORT]); check('P02', 'a missing approval is refused (fail closed)', r.json && r.json.refused, r.raw);
  const t1 = withPkg((p) => { p.items[0].sha256_lf = 'b'.repeat(64); }, false); r = exe(['run', ...common(db, a, { pkg: t1.file, hash: t1.hash })]); check('P03', 'a package edited without re-hashing is refused', r.json && r.json.refused && r.json.code === 'package-hash', r.raw);
  const t2 = withPkg((p) => { p.items[0].sha256_lf = 'b'.repeat(64); }, true); r = exe(['run', ...common(db, a, { pkg: t2.file, hash: t2.hash })]); check('P04', 'a re-hashed package whose file hash differs from the Git commit is refused', r.json && r.json.refused && r.json.code === 'hash', r.raw);
  for (const [id, v, label] of [['P05', '20260125173238', 'blocked'], ['P06', '20260305203528', 'withdrawn (Case 41)'], ['P07', '20251003170350', 'demo-admin'], ['P08', '20260611184401', 'excluded pricing']]) {
    const t = withPkg((p) => { p.items.unshift({ ...p.items[0], version: v, file: v + '_x.sql', order: 1 }); p.items.forEach((i, k) => { i.order = k + 1; }); }, true);
    r = exe(['run', ...common(db, a, { pkg: t.file, hash: t.hash })]); check(id, `a ${label} version in the package is refused`, r.json && r.json.refused && /deny|scope/.test(r.json.code), r.raw);
  }
  const t3 = withPkg((p) => { p.items.splice(3, 1); p.items.forEach((i, k) => { i.order = k + 1; }); }, true); r = exe(['run', ...common(db, a, { pkg: t3.file, hash: t3.hash })]); check('P09', 'an item removed from the sealed chain is refused (dependency or fingerprint chain)', r.json && r.json.refused && /dependency|fp-chain/.test(r.json.code), r.raw);
  const t4 = withPkg((p) => { p.items.reverse(); p.items.forEach((i, k) => { i.order = k + 1; }); }, true); r = exe(['run', ...common(db, a, { pkg: t4.file, hash: t4.hash })]); check('P10', 'items out of version order are refused', r.json && r.json.refused && /order|dependency/.test(r.json.code), r.raw);
  const t5 = withPkg((p) => { p.items[5].requires = ['20299999999999']; }, true); r = exe(['run', ...common(db, a, { pkg: t5.file, hash: t5.hash })]); check('P11', 'a prerequisite that is not an earlier item is refused', r.json && r.json.refused && r.json.code === 'dependency', r.raw);
  check('P12', 'transaction-control, SET ROLE, SET search_path and CONCURRENTLY statements in a migration file are detected; dollar-quoted bodies and comments are ignored',
    X.forbiddenStatements("select 1;\ncommit;").length === 1 && X.forbiddenStatements("set role postgres;").length === 1 && X.forbiddenStatements("create index concurrently i on t(a);").length === 1 && X.forbiddenStatements("create function f() returns void language plpgsql as $$ begin commit; end $$; -- commit;\n/* begin; */ select 'begin;';").length === 0);
  check('P13', 'none of the 28 files contains a forbidden statement (read from the bound commit)', (() => { try { X.readFiles(pkg, path.join(__dirname, '..', '..', '..')); return true; } catch (e) { return false; } })());
  r = exe(['run', ...common(db, a), '--password', 'x']); check('P14', 'credential-style options are not accepted', r.json && r.json.refused, r.raw);
  r = exe(['run', ...common(db, a)], { DATABASE_URL: 'postgres://x' }); check('P15', 'a DATABASE_URL in the environment is refused for the local target', r.json && r.json.refused && r.json.code === 'hosted-guard', r.raw);
  r = exe(['run', ...common('postgres', a)]); check('P16', 'a non-scratch database name is refused before connecting', r.json && r.json.refused && r.json.code === 'hosted-guard', r.raw);
}

// ---------------------------------------------------------------- H: hosted gating (refusal paths only; no connection is ever attempted)
if (want('H')) {
  const dir = os.tmpdir(); const a = auditDir();
  const mk = (over, name) => { const d = { schema: X.AUTH_SCHEMA, project_ref: X.DEV_REF, package_sha256: pkg.document_sha256, versions: V.slice(0, 3), approved_withheld: V.slice(0, 3), base_ledger: { count: BASE.base_count, sha256: BASE.base_sha256 }, restore_point: { id: 'rp-1', taken_at_utc: new Date(Date.now() - 3 * 3600e3).toISOString() }, approved_by: 'owner', approved_at: new Date(Date.now() - 3600e3).toISOString(), expires_at: new Date(Date.now() + 3600e3).toISOString(), statement: 'AUTHORIZE HOSTED DEVELOPMENT EXECUTION', ...over }; d.document_sha256 = X.docHash(d, 'document_sha256'); const f = path.join(dir, `bpc-auth-${process.pid}-${name}.json`); fs.writeFileSync(f, JSON.stringify(d)); return { f, h: d.document_sha256, d }; };
  const hargs = (au, extra = []) => ['run', '--package', PKG, '--target', 'hosted-development', '--authorization', au.f, '--audit-dir', a, '--approval-hash', au.h, '--expect-base-count', String(BASE.base_count), '--expect-base-sha256', BASE.base_sha256, ...extra];
  let r = exe(['run', '--package', PKG, '--target', 'hosted-development', '--audit-dir', a, '--approval-hash', pkg.document_sha256, '--expect-base-count', '60', '--expect-base-sha256', BASE.base_sha256]); check('H01', 'hosted target without an authorization document is refused', r.json && r.json.refused && r.json.code === 'authorization', r.raw);
  let au = mk({}, 'ok'); r = exe(hargs(au)); check('H02', 'a valid authorization still refuses without the connection variable (and attempts no connection)', r.json && r.json.refused && r.json.code === 'hosted-guard', r.raw);
  au = mk({ project_ref: X.PROD_REF }, 'prod'); r = exe(hargs(au), { BPC_HOSTED_DEV_DATABASE_URL: 'x' }); check('H03', 'an authorization naming the Production project is refused', r.json && r.json.refused && r.json.code === 'hosted-guard', r.raw);
  au = mk({ expires_at: new Date(Date.now() - 1000).toISOString() }, 'exp'); r = exe(hargs(au)); check('H04', 'an expired authorization is refused', r.json && r.json.refused, r.raw);
  au = mk({ package_sha256: 'c'.repeat(64) }, 'pk'); r = exe(hargs(au)); check('H05', 'an authorization for a different package is refused', r.json && r.json.refused, r.raw);
  au = mk({ approved_withheld: [] }, 'wh'); r = exe(hargs(au)); check('H06', 'withheld October versions not released by the authorization are refused', r.json && r.json.refused && r.json.code === 'withheld', r.raw);
  au = mk({ versions: [V[0], V[2]] }, 'nc'); r = exe(hargs(au)); check('H07', 'a non-contiguous authorized set is refused', r.json && r.json.refused, r.raw);
  au = mk({ restore_point: null }, 'rp'); r = exe(hargs(au)); check('H08', 'an authorization without a restore point is refused', r.json && r.json.refused, r.raw);
  au = mk({}, 'tp'); r = exe(hargs(au).map((x) => (x === au.h ? 'd'.repeat(64) : x))); check('H09', 'a mistyped approval hash is refused', r.json && r.json.refused && r.json.code === 'approval', r.raw);
  r = exe(['run', ...common('bpc_exec_s01', a), '--authorization', au.f]); check('H10', 'an authorization document is refused for the local target', r.json && r.json.refused, r.raw);
  const urlTests = [['https://x', 'not a postgres host'], [`postgresql://postgres:p@db.${X.PROD_REF}.supabase.co:5432/postgres?sslmode=require`, 'production'], [`postgresql://postgres:p@db.${X.DEV_REF}.supabase.co:5432/postgres`, 'no sslmode']];
  const okUrl = (u) => { try { X.parseHostedUrl(u); return true; } catch (e) { return false; } };
  check('H11', 'the hosted connection string must identify the Development project with sslmode=require; Production, foreign hosts and plain connections are refused', urlTests.every(([u]) => !okUrl(u)) && okUrl(`postgresql://postgres:p@db.${X.DEV_REF}.supabase.co:5432/postgres?sslmode=require`));
}

// ---------------------------------------------------------------- V: violation x guard mutation matrix (script level)
if (want('V')) {
  const base = ['--package', PKG, '--expect-base-count', String(BASE.base_count), '--expect-base-sha256', BASE.base_sha256];
  const render = (step, db, extra = []) => exe(['render', ...base, '--step', String(step), '--db', db, ...extra]).json.script;
  const attempt = (db, script) => { const before = ledgerCount(db); const r = sql(db, script, ['-1']); return { stopped: r.code !== 0, recorded: ledgerCount(db) > before, err: r.err.split('\n').find((l) => /ERROR/.test(l)) || '' }; };
  const scenarios = [
    { id: 'V1', label: 'foreign row in the ledger', guards: ['no-base-check', 'no-count-check'], prep: (db) => sql(db, `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20990101000000','stray',ARRAY['-- stray'])`), step: 1 },
    { id: 'V2', label: 'unexpected function in the public schema', guards: ['no-pre-fingerprint', 'no-post-fingerprint'], prep: (db) => sql(db, `create function public.zz_unexpected() returns int language sql as 'select 1'`), step: 1 },
    { id: 'V3', label: 'anon holds USAGE on public (containment lost)', guards: ['no-containment-check', 'no-pre-fingerprint', 'no-post-fingerprint'], prep: (db) => sql(db, `grant usage on schema public to anon`), step: 1 },
    { id: 'V4', label: 'step 2 attempted while step 1 was never recorded', guards: ['no-predecessor-check', 'no-requires-check', 'no-pre-fingerprint', 'no-post-fingerprint', 'no-count-check'], prep: () => {}, step: 2 },
    { id: 'V5', label: 'ledger row for the same version already present', guards: ['no-version-check'], prep: (db) => sql(db, `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261007120000','x',ARRAY['-- x'])`), step: 1, backstop: 'primary key' },
    { id: 'V6', label: 'a trigger writes an extra ledger row at insert', guards: ['no-count-check'], prep: (db) => sql(db, `create function supabase_migrations.zz_extra() returns trigger language plpgsql as $$ begin insert into supabase_migrations.schema_migrations (version,name,statements) values ('29990101000000','x',ARRAY['-- x']); return new; end $$; create trigger zz_extra before insert on supabase_migrations.schema_migrations for each row when (new.version = '20261007120000') execute function supabase_migrations.zz_extra();`), step: 1 },
  ];
  for (const sc of scenarios) {
    const db = clone('v' + sc.id.slice(1)); sc.prep(db);
    // V5 and V1 prepared state changes the base: the script must be rendered with the APPROVED base (60 rows)
    const original = render(sc.step, db);
    const o = attempt(db, original);
    check(sc.id + 'a', `${sc.label}: the unmutated script stops and records nothing`, o.stopped && !o.recorded, o.err);
    for (const g of sc.guards) {
      const db1 = clone('v' + sc.id.slice(1)); sc.prep(db1);
      const m = attempt(db1, X.mutateScript(original.replace(/current_database\(\) <> '[^']+'/, `current_database() <> '${db1}'`), g));
      const redundant = m.stopped && !m.recorded;
      results.push({ id: sc.id + '-' + g, label: `${sc.label}: with ONLY ${g} removed`, pass: true, detail: redundant ? 'still stopped (another layer catches it): ' + m.err.slice(0, 120) : 'PASSED THROUGH: this guard is the sole catcher' });
      console.log('info ' + sc.id + ' ' + g + ' -> ' + (redundant ? 'stopped by another layer' : 'passes through (sole catcher)'));
    }
    const dbAll = clone('v' + sc.id.slice(1)); sc.prep(dbAll);
    const all = attempt(dbAll, X.mutateScript(original.replace(/current_database\(\) <> '[^']+'/, `current_database() <> '${dbAll}'`), sc.guards.join('+')));
    check(sc.id + 'z', `${sc.label}: with ALL of [${sc.guards.join(', ')}] removed the violation is not caught${sc.backstop ? ' (primary key still rejects the duplicate)' : ''}`, sc.backstop ? all.stopped : (!all.stopped || all.recorded), JSON.stringify(all));
  }
}

// ---------------------------------------------------------------- E: hosted-like privileges
if (want('E')) {
  const SETUP = `
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bpc_hostlike') THEN CREATE ROLE bpc_hostlike NOSUPERUSER BYPASSRLS CREATEROLE NOLOGIN; END IF; END $$;
ALTER ROLE bpc_hostlike NOSUPERUSER BYPASSRLS CREATEROLE;
GRANT postgres TO bpc_hostlike;            -- the hosted operator IS postgres: ownership of postgres-owned objects and DEFAULT PRIVILEGES FOR ROLE postgres are allowed
GRANT anon, authenticated, service_role TO bpc_hostlike;
GRANT USAGE ON SCHEMA supabase_migrations, auth, extensions, storage, realtime TO bpc_hostlike;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON auth.users TO bpc_hostlike;                 -- observed live for the hosted postgres role
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA storage TO bpc_hostlike; -- observed live (grants only; ownership stays with supabase_storage_admin)
-- NOT granted, as observed live: membership in supabase_admin, supabase_storage_admin, supabase_auth_admin; CREATE on schema storage; superuser`;
  const db = clone('e01'), a = auditDir();
  const su = sql(db, SETUP); check('E00', 'hosted-like operator role created from the live capability observations (not superuser, BYPASSRLS, CREATEROLE, member of postgres and of anon/authenticated/service_role, DML on auth.users and storage tables by grant, no membership in supabase_* roles, no ownership of storage tables)', su.code === 0, su.err);
  const rows = [];
  for (let k = 0; k < V.length; k++) {
    const probe = exe(['render', '--package', PKG, '--expect-base-count', String(BASE.base_count), '--expect-base-sha256', BASE.base_sha256, '--step', String(k + 1), '--db', db, '--emulate-hosted-role', 'bpc_hostlike']).json.script;
    // the rendered script ends with the ledger insert and a count check; roll everything back after the file ran under the emulated role
    const r = sql(db, probe + '\nROLLBACK;\n', ['-1']);
    const err = r.err.split('\n').find((l) => /ERROR/.test(l)) || '';
    // the base check counts rows outside the package: package rows of earlier steps are inserted by the real run below, so they are not "base"
    rows.push({ version: V[k], file: pkg.items[k].file, runnable_as_hosted_like_operator: r.code === 0 || !/must be owner|permission denied|must be member|insufficient/i.test(err), error: err.slice(0, 200) });
    // advance the state: first the same file under the emulated role (committed, so ownership stays realistic); if it failed, apply it as superuser to continue the chain
    const emu = exe(['render', '--package', PKG, '--expect-base-count', String(BASE.base_count), '--expect-base-sha256', BASE.base_sha256, '--step', String(k + 1), '--db', db, '--emulate-hosted-role', 'bpc_hostlike']).json.script;
    let ar = sql(db, emu, ['-1']);
    if (ar.code !== 0) {
      const adv = exe(['render', '--package', PKG, '--expect-base-count', String(BASE.base_count), '--expect-base-sha256', BASE.base_sha256, '--step', String(k + 1), '--db', db, '--no-fingerprint']).json.script;
      ar = sql(db, adv, ['-1']); rows[rows.length - 1].advanced_as = 'superuser';
      if (ar.code !== 0) { rows[rows.length - 1].advance_failed = ar.err.slice(0, 200); break; }
    } else rows[rows.length - 1].advanced_as = 'emulated-operator';
  }
  fs.writeFileSync(OUT.replace(/\.json$/, '') + '.hostlike.json', JSON.stringify(rows, null, 1));
  const blocked = rows.filter((x) => !x.runnable_as_hosted_like_operator);
  results.push({ id: 'E01', label: 'hosted-like operator: files that FAIL on a privilege/ownership error (hosted-only capability to verify before S5)', pass: true, detail: blocked.map((x) => x.version + ': ' + x.error).join(' || ').slice(0, 1500) || 'none' });
  console.log('info E01 blocked under hosted-like privileges:', blocked.map((x) => x.version).join(', ') || 'none');
}

// ---------------------------------------------------------------- G: stage-S11 gate checks (positive and negative controls)
if (want('G')) {
  const GATE = path.join(__dirname, '..', '..', '..', 'audit', 'step4', 's11-gate-checks.sql');
  const NL = String.fromCharCode(10);
  const gate = (db) => { const r = sql(db, fs.readFileSync(GATE, 'utf8')); const m = new Map(); for (const l of r.out.split(NL).filter(Boolean)) { const i = l.lastIndexOf('|'); m.set(l.slice(0, i), l.slice(i + 1).trim() === 't'); } return { code: r.code, rows: m, err: r.err }; };
  const g0 = clone('g00'), ga = auditDir(); const run = exe(['run', ...common(g0, ga)]);
  const base = gate(g0);
  check('G00', 'after the 28 files the gate returns 20 rows, all true', run.json && run.json.ok && base.code === 0 && base.rows.size === 20 && [...base.rows.values()].every(Boolean), run.raw + base.err);
  const muts = [
    ['G01', 'grant usage on schema public to anon'],
    ['G02', "delete from supabase_migrations.schema_migrations where version = '20261026120400'"],
    ['G03', 'create policy zz_anon on public.orders for select to anon using (true)'],
    ['G04', 'create policy "zz service role all" on public.units for all to public using (true)'],
    ['G05', "grant execute on function public.get_admin_analytics(timestamptz, timestamptz) to anon"],
    ['G06', 'grant select on public.orders to anon'],
    ['G07', 'grant usage on all sequences in schema public to anon'],
    ['G08', 'alter table public.units disable row level security'],
    ['G09', "create function public.zz_definer() returns int language sql security definer as 'select 1'"],
    ['G10', 'alter default privileges for role postgres in schema public grant select on tables to anon'],
    ['G11', "update storage.buckets set public = true where id = 'signed-waivers'"],
    ['G12', 'create policy zz_obj on storage.objects for insert to anon with check (true)'],
    ['G13', 'drop trigger trg_guard_booking_confirmation_columns on public.orders'],
    ['G14', 'grant usage on schema public to authenticated'],
    ['G15', 'drop trigger on_auth_user_created on auth.users'],
  ];
  for (const [id, mut] of muts) {
    const db = clone('g' + id.slice(1), g0); const m = sql(db, mut + ';');
    const r = gate(db); const hit = [...r.rows.entries()].filter(([k, v]) => k.startsWith(id + ' ') && !v); const others = [...r.rows.entries()].filter(([k, v]) => !k.startsWith(id + ' ') && !v).length;
    check('G-' + id, `negative control: "${mut.slice(0, 70)}" turns gate ${id} false`, m.code === 0 && hit.length === 1 && r.rows.size === 20, m.err || JSON.stringify([...r.rows.entries()].filter(([, v]) => !v)));
  }
  const dbE = clone('g16', g0); sql(dbE, "delete from supabase_migrations.schema_migrations where version = '20261026120100'");
  const rr = gate(dbE); check('G-G16', 'negative control: a missing Step 3B ledger row makes the ledger gate false', [...rr.rows.entries()].some(([k, v]) => k.startsWith('G02') && !v));
}

const failed = results.filter((x) => !x.pass).length;
fs.writeFileSync(OUT, JSON.stringify({ generated_by: 'scripts/dev/hosted-executor/rehearse.cjs', package_sha256: pkg.document_sha256, commit: pkg.commit, local_only: true, total: results.length, passed: results.length - failed, failed, results }, null, 1));
console.log(`rehearsal: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
