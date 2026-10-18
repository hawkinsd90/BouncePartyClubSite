'use strict';
// Builds and drives the LOCAL scratch databases that the database-backed security tests need, and runs the Step 3 security ACCEPTANCE.
// It only talks to a loopback PostgreSQL (default 127.0.0.1:54329, user postgres) and only creates/drops databases named bpc_replay_*.
// It never contacts a Supabase project.
//
//   node scripts/dev/security-scratch.cjs build     (re)build the repository-chain scratch databases and remove the seed rows the migrations insert
//   node scripts/dev/security-scratch.cjs shapes    build the Production-shaped and Development-shaped databases (needs the protected Stage B captures and the two restored
//                                                   bases; see audit/evidence/tools/step3b_shapes.py)
//   node scripts/dev/security-scratch.cjs accept    THE Step 3 security acceptance. Always strict (see below). Takes no arguments.
//   node scripts/dev/security-scratch.cjs test [filter...]   DIAGNOSTIC mode for development: filters allowed, missing databases and missing tests are reported but
//                                                   tolerated. Its green result is NOT an acceptance result and says so.
//
// ACCEPTANCE (audit/security/step3-acceptance-manifest.json) fails with a nonzero exit if ANY of these holds:
//   - a required scratch database is missing or empty (checked before anything runs);
//   - a file listed in must_exist is absent, or fewer test files are discovered than min_discovered_test_files (the denominator may not shrink);
//   - a suite crashes, has no result line, reports a failed assertion, or reports any SKIPPED layer;
//   - a baseline run (the databases BEFORE Step 3B) does not fail EXACTLY as recorded in audit/security/step3b-baseline-expected.json:
//     the same assertions, with the same observed values, the same totals, and nothing else wrong (no crash, no extra failure, no skip).
// Totals are reported separately: required runs, executed, passed, failed, skipped, missing databases, missing tests, assertions.
//
// Why several databases: the executed layers of the tests apply "their" migration text themselves, so each needs a replay that stops
// at a different point. The shapes are the ones the test headers describe.
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const NL = String.fromCharCode(10);
const ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------------------------------------------------
// Pure helpers (exported for src/lib/tests/security/securityAcceptanceRunner.test.ts)
// ---------------------------------------------------------------------------------------------------------------------
const SUMMARY_RE = /(\d+) passed, (\d+) failed(?:, (\d+) skipped)?/;

function summaryOf(out) {
  let last = null;
  for (const line of String(out).split(NL)) {
    const m = SUMMARY_RE.exec(line);
    if (m) last = { passed: Number(m[1]), failed: Number(m[2]), skipped: m[3] === undefined ? 0 : Number(m[3]) };
  }
  return last;
}

function hasSkippedLayer(out) {
  const s = summaryOf(out);
  return /SKIPPED/.test(String(out)) || (s !== null && s.skipped > 0);
}

// A normal (non-baseline) run: pass only when the process exited 0, a result line says 0 failed, and nothing was skipped.
function classifyRun({ code, out }) {
  const s = summaryOf(out);
  const reasons = [];
  const skipped = hasSkippedLayer(out);
  if (skipped) reasons.push('a layer was SKIPPED');
  if (!s) reasons.push('no result line (crash or no assertions ran)');
  else if (s.failed > 0) reasons.push(`${s.failed} assertion(s) failed`);
  if (code !== 0) reasons.push(`exit code ${code}`);
  const status = skipped ? 'skipped' : reasons.length === 0 ? 'pass' : 'fail';
  return { status, reasons, passed: s ? s.passed : 0, failed: s ? s.failed : 0 };
}

// Failure lines of the form "FAIL: executed: <name> (got <value>)"; everything else starting with FAIL is "other".
function parseFailures(out) {
  const executed = [];
  const other = [];
  for (const line of String(out).split(NL)) {
    if (!line.startsWith('FAIL:')) continue;
    const m = /^FAIL: executed: (.*) \(got (.*)\)$/.exec(line);
    if (m) executed.push({ name: m[1], got: m[2] });
    else other.push(line);
  }
  return { executed, other };
}

const CRASH_RE = /(SyntaxError|ParseError|TypeError|ReferenceError|Cannot find module|ECONNREFUSED|could not connect|does not exist|ENOENT|Unexpected token)/;

// A baseline run is the "before" demonstration. It is accepted ONLY when it fails exactly as recorded.
function compareBaseline({ code, out }, expected) {
  const problems = [];
  const s = summaryOf(out);
  if (hasSkippedLayer(out)) problems.push('a layer was SKIPPED');
  if (code === 0) problems.push('the baseline passed, so it does not demonstrate the vulnerabilities');
  if (!s) problems.push('no result line (crash or no assertions ran)');
  else {
    if (s.passed !== expected.passed || s.failed !== expected.failed) problems.push(`totals ${s.passed} passed / ${s.failed} failed, expected ${expected.passed} / ${expected.failed}`);
  }
  const f = parseFailures(out);
  if (f.other.length) problems.push(`unexpected failure line(s): ${f.other.slice(0, 2).join(' | ')}`);
  const want = new Map(expected.failures.map((x) => [x.name, x.got]));
  const seen = new Map(f.executed.map((x) => [x.name, x.got]));
  for (const [name, got] of seen) {
    if (!want.has(name)) problems.push(`unexpected failing assertion: ${name} (got ${got})`);
    else if (want.get(name) !== got) problems.push(`assertion failed with a different value: ${name} (got ${got}, expected ${want.get(name)})`);
  }
  for (const name of want.keys()) if (!seen.has(name)) problems.push(`expected finding was not demonstrated: ${name}`);
  // any crash-like text other than the one summary error the test throws at its end
  for (const line of String(out).split(NL)) {
    if (CRASH_RE.test(line) && !/^FAIL:/.test(line)) { problems.push(`crash-like output: ${line.trim().slice(0, 120)}`); break; }
  }
  return { ok: problems.length === 0, problems };
}

function tally(results) {
  const t = { required: results.length, executed: 0, passed: 0, failed: 0, skipped: 0, baselineAccepted: 0, baselineRejected: 0, assertions: 0 };
  for (const r of results) {
    if (r.status === 'not-run') continue;
    t.executed++;
    if (r.baseline) { if (r.status === 'pass') t.baselineAccepted++; else t.baselineRejected++; continue; }
    if (r.status === 'pass') { t.passed++; t.assertions += r.passed || 0; }
    else if (r.status === 'skipped') t.skipped++;
    else t.failed++;
  }
  return t;
}

// The acceptance verdict. Separate counts, one rule: anything but a perfect run is a failure.
function verdict({ strict, results, missingDatabases, missingTests, discovered, minDiscovered }) {
  const t = tally(results);
  const problems = [];
  if (missingDatabases.length) problems.push(`${missingDatabases.length} required database(s) missing: ${missingDatabases.join(', ')}`);
  if (missingTests.length) problems.push(`${missingTests.length} required test file(s) missing: ${missingTests.join(', ')}`);
  if (discovered < minDiscovered) problems.push(`only ${discovered} test files discovered, the manifest requires at least ${minDiscovered}`);
  if (t.failed) problems.push(`${t.failed} run(s) failed`);
  if (t.skipped) problems.push(`${t.skipped} run(s) skipped a layer`);
  if (t.baselineRejected) problems.push(`${t.baselineRejected} baseline run(s) did not fail exactly as recorded`);
  const tolerated = !strict ? problems.filter((p) => /required database|required test file|only \d+ test files/.test(p)) : [];
  const blocking = problems.filter((p) => !tolerated.includes(p));
  return { ok: blocking.length === 0, problems, blocking, tally: t, missingDatabases, missingTests };
}

module.exports = { summaryOf, hasSkippedLayer, classifyRun, parseFailures, compareBaseline, tally, verdict };
if (require.main !== module) return;

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------
process.chdir(ROOT);

const DATABASES = [
  // name, replay stops after this version (omit = everything), purpose
  ['bpc_replay_oct12', '20261012120000', 'core lockdown applied; nothing later (evidence/photo/media tests)'],
  ['bpc_replay_rolepre', '20261015123000', 'everything before the role/signup repair (role and booking-confirmation tests)'],
  ['bpc_replay_hardpre', '20261017120000', 'everything before the three database-hardening migrations'],
  ['bpc_replay_oct18', '20261018120200', 'repository chain through the hardening migrations (core access, classification, role, payment base)'],
  ['bpc_replay_full25', '20261025120000', 'the chain WITHOUT the Step 3B migrations (baseline for the posture test)'],
  ['bpc_replay_full', null, 'the complete repository chain (final-posture tests)'],
];

const PG = { host: process.env.PGHOST || '127.0.0.1', port: process.env.PGPORT || '54329' };
const psqlPath = process.env.CORE_DB_PSQL || (fs.existsSync('C:/Program Files/PostgreSQL/18/bin/psql.exe') ? 'C:/Program Files/PostgreSQL/18/bin/psql.exe' : 'psql');

if (!['127.0.0.1', 'localhost', '::1'].includes(PG.host)) {
  console.error(`refusing: host "${PG.host}" is not a loopback address`);
  process.exit(2);
}

function psql(db, sql) {
  return spawnSync(psqlPath, ['-h', PG.host, '-p', PG.port, '-U', 'postgres', '-d', db, '-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8' });
}

// Rows the migrations insert (the demo account and its CRM rows). The executed scenarios count rows exactly, so scratch databases start without them.
const CLEAN_SQL = `set session_replication_role = replica;
delete from public.user_permissions_changelog; delete from public.user_roles; delete from public.customer_profiles;
delete from public.contacts; delete from public.customers; delete from auth.users;`;

function build() {
  for (const [name, upto, purpose] of DATABASES) {
    const args = ['scripts/dev/migration-replay.cjs', '--db', name, '--mode', 'strict', '--stub-skips', '--adjust', 's1,s2'];
    if (upto) args.push('--upto', upto);
    const r = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, BPC_REPLAY_CONFIRM_LOCAL: 'yes' } });
    const ok = r.status === 0 && /REPLAY COMPLETED/.test(r.stdout);
    console.log(`${ok ? 'built  ' : 'FAILED '} ${name}  (${purpose})`);
    if (!ok) { console.error((r.stdout || '').split(NL).slice(-8).join(NL) + (r.stderr || '')); process.exit(1); }
    const c = psql(name, CLEAN_SQL);
    if (c.status !== 0) { console.error(c.stderr); process.exit(1); }
  }
}

function shapes() {
  for (const which of ['prod', 'dev']) {
    const r = spawnSync('python', ['-I', 'audit/evidence/tools/step3b_shapes.py', which], { encoding: 'utf8', stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
}

function envFor(file, strict) {
  const e = {
    ...process.env,
    CORE_DB_NAME: 'bpc_replay_oct18', CORE_DB_PORT: PG.port, CORE_DB_HOST: PG.host, CORE_DB_PSQL: psqlPath,
    CORE_DB_REQUIRE: '1', ROLE_DB_REQUIRE: '1', HARD_DB_REQUIRE: '1',
    ROLE_DB_PRE: 'bpc_replay_rolepre', ROLE_DB_FULL: 'bpc_replay_oct18',
    HARD_DB_PRE: 'bpc_replay_hardpre', HARD_DB_FULL: 'bpc_replay_oct18',
    PAY_DB_BASE: 'bpc_replay_rolepre', PAY_DB_FULL: 'bpc_replay_payfull', DEVREFRESH_TEMPLATE_DB: 'bpc_replay_full',
  };
  if (strict) e.STEP3B_SHAPES_REQUIRE = '1';
  if (/orderEvidenceAccess|customerPhotoAccess|privateMediaAccess/.test(file)) e.CORE_DB_NAME = 'bpc_replay_oct12';
  if (/securityPosture/.test(file)) { e.CORE_DB_NAME = 'bpc_replay_full'; e.POSTURE_DB_NAME = 'bpc_replay_full'; }
  return e;
}

function dbReady(name) {
  const r = spawnSync(psqlPath, ['-h', PG.host, '-p', PG.port, '-U', 'postgres', '-d', name, '-X', '-q', '-w', '-Atc', "select to_regclass('public.orders') is not null"], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 't';
}

function runJob(job) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn('node', ['node_modules/jiti/bin/jiti.js', job.file], { env: job.env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => p.kill(), 280000);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - t0 }); });
  });
}

async function run({ strict, filters }) {
  const manifestPath = process.env.SECURITY_ACCEPT_MANIFEST ? path.resolve(process.env.SECURITY_ACCEPT_MANIFEST) : path.join(ROOT, 'audit', 'security', 'step3-acceptance-manifest.json');
  const isDefault = !process.env.SECURITY_ACCEPT_MANIFEST;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expectedPath = path.resolve(ROOT, manifest.baseline_expected || 'audit/security/step3b-baseline-expected.json');
  const baselineExpected = manifest.baseline_runs && manifest.baseline_runs.length ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')).databases : {};
  console.log(strict
    ? `STEP 3 SECURITY ACCEPTANCE (strict)${isDefault ? '' : '  *** SELF-TEST MANIFEST ' + manifestPath + ': NOT an acceptance result ***'}`
    : 'DIAGNOSTIC RUN (not an acceptance result: missing databases and tests are tolerated and filters are allowed)');

  // 1. required databases
  const missingDatabases = manifest.databases.filter((d) => !dbReady(d.name)).map((d) => d.name);
  if (strict && missingDatabases.length) {
    const v = verdict({ strict, results: [], missingDatabases, missingTests: [], discovered: 0, minDiscovered: 0 });
    return finish(v, [], manifestPath, isDefault, 0);
  }

  // 2. discovery and required files
  const tracked = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.test.ts'], { encoding: 'utf8' }).stdout.split(NL).filter(Boolean);
  const scope = manifest.discover_globs || null;
  let discovered = tracked.filter((f) => !scope || scope.some((g) => f.includes(g)));
  const missingTests = (manifest.must_exist || []).filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (filters.length) discovered = discovered.filter((f) => filters.some((x) => f.includes(x)));
  const totalDiscovered = discovered.length;
  if (strict && (missingTests.length || totalDiscovered < (manifest.min_discovered_test_files || 0))) {
    const v = verdict({ strict, results: [], missingDatabases, missingTests, discovered: totalDiscovered, minDiscovered: manifest.min_discovered_test_files || 0 });
    return finish(v, [], manifestPath, isDefault, totalDiscovered);
  }

  // 3. jobs
  const jobs = discovered.map((f) => ({ file: f, label: f, env: envFor(f, strict) }));
  for (const x of manifest.extra_runs || []) {
    if (filters.length && !filters.some((y) => x.file.includes(y))) continue;
    jobs.push({ file: x.file, label: `${x.file} @ ${x.db}`, db: x.db, env: { ...envFor(x.file, strict), ...(x.env || {}) } });
  }
  for (const x of manifest.baseline_runs || []) {
    if (filters.length && !filters.some((y) => x.file.includes(y))) continue;
    jobs.push({ file: x.file, label: `${x.file} @ ${x.db}  [baseline]`, db: x.db, baseline: x.baseline, env: { ...envFor(x.file, strict), ...(x.env || {}) } });
  }

  const results = [];
  for (const job of jobs) {
    if (job.db && missingDatabases.includes(job.db)) { results.push({ label: job.label, status: 'not-run', baseline: !!job.baseline }); console.log(`MISSING  ${job.label}`); continue; }
    const r = await runJob(job);
    let res;
    if (job.baseline) {
      const exp = baselineExpected[job.baseline];
      const cmp = exp ? compareBaseline(r, exp) : { ok: false, problems: [`no expected baseline recorded for ${job.baseline}`] };
      res = { label: job.label, baseline: true, status: cmp.ok ? 'pass' : 'fail', problems: cmp.problems };
      console.log(`${cmp.ok ? 'ok  ' : 'FAIL'} [baseline fails exactly as recorded: ${exp ? exp.failed + ' findings' : '?'}] ${job.label}  ${((r.ms) / 1000).toFixed(0)}s`);
      cmp.problems.slice(0, 6).forEach((p) => console.log('     ' + p));
    } else {
      const c = classifyRun(r);
      res = { label: job.label, status: c.status, passed: c.passed, failed: c.failed, problems: c.reasons };
      const summary = (String(r.out).split(NL).filter((l) => SUMMARY_RE.test(l)).pop() || '').trim();
      console.log(`${c.status === 'pass' ? 'ok  ' : c.status === 'skipped' ? 'SKIP' : 'FAIL'} ${job.label}  ${summary}  ${(r.ms / 1000).toFixed(0)}s`);
      if (c.status !== 'pass') {
        c.reasons.forEach((p) => console.log('     ' + p));
        String(r.out).split(NL).filter((l) => /^FAIL|^ERROR|SKIPPED/.test(l)).slice(0, 5).forEach((l) => console.log('     ' + l.slice(0, 240)));
      }
    }
    results.push(res);
  }
  const v = verdict({ strict, results, missingDatabases, missingTests, discovered: totalDiscovered, minDiscovered: manifest.min_discovered_test_files || 0 });
  return finish(v, results, manifestPath, isDefault, totalDiscovered);
}

function finish(v, results, manifestPath, isDefault, discovered) {
  const t = v.tally;
  console.log(NL + '---------------------------------------------------------------------------------------');
  console.log(`test files discovered: ${discovered}`);
  console.log(`required runs: ${t.required}   executed: ${t.executed}   passed: ${t.passed}   failed: ${t.failed}   skipped: ${t.skipped}`);
  console.log(`baseline runs accepted: ${t.baselineAccepted}   rejected: ${t.baselineRejected}`);
  console.log(`missing databases: ${v.missingDatabases.length}${v.missingDatabases.length ? ' (' + v.missingDatabases.join(', ') + ')' : ''}   missing tests: ${v.missingTests.length}${v.missingTests.length ? ' (' + v.missingTests.join(', ') + ')' : ''}`);
  console.log(`assertions executed and passed in the required runs: ${t.assertions}`);
  v.problems.forEach((p) => console.log('PROBLEM: ' + p));
  const label = isDefault ? 'STEP 3 SECURITY ACCEPTANCE' : 'SELF-TEST (not an acceptance result)';
  console.log(`${label}: ${v.ok ? 'PASS' : 'FAIL'}`);
  process.exit(v.ok ? 0 : 1);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'build') build();
else if (cmd === 'shapes') shapes();
else if (cmd === 'accept') {
  if (rest.length) { console.error('accept takes no arguments: filters would shrink the denominator'); process.exit(2); }
  run({ strict: true, filters: [] });
} else if (cmd === 'test') run({ strict: false, filters: rest });
else { console.error('usage: security-scratch.cjs build | shapes | accept | test [filter...]'); process.exit(2); }
