// One command for the whole verification chain, with the independent checks overlapped.
//
//   node scripts/dev/verify.cjs              the default, INCREMENTAL: typecheck + lint + build in parallel with tests, then both mutation
//                                            suites, which rerun only the mutants whose inputs changed (a pure move or rename reruns none)
//   node scripts/dev/verify.cjs --quick      static checks and tests only (no mutants)
//   node scripts/dev/verify.cjs --plan       say how many mutants the current changes would rerun, without running anything
//   node scripts/dev/verify.cjs --full       everything from scratch: stored verdicts are ignored, then the new ones REPLACE the cache, so
//                                            the next default run is cheap again. The run before the final commit.
//   CHANGED=1  node scripts/dev/verify.cjs   only mutants whose file or test is in the current git diff (faster, less thorough)
//   PARALLEL=n node scripts/dev/verify.cjs   how many database-free test files run at once (default 3, measured best here; 1 = strictly serial)
//
// Typecheck, lint and build never touch the scratch databases, so they run alongside the database-backed chain. The tests and the
// two mutation suites share scratch databases and the same source copies, so they stay strictly one after another.
// Output of every step goes to a log file under the OS temp folder; only a summary is printed, with the tail of any failure.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LOGS = path.join(os.tmpdir(), 'verify-logs');
fs.mkdirSync(LOGS, { recursive: true });
const withMutants = !process.argv.includes('--no-mutants') && !process.argv.includes('--quick');
const full = process.argv.includes('--full');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// --full ignores the stored mutation verdicts and refreshes them with what it finds; everything else reuses verdicts whose inputs did not change.
const mutationEnv = full ? { ...process.env, NO_CACHE: '1' } : process.env;

if (process.argv.includes('--plan')) {
  const { spawnSync } = require('child_process');
  for (const suite of ['payment-mutants', 'pricing-mutants']) {
    console.log(`== ${suite}`);
    spawnSync('node', ['scripts/dev/mutation-runner.cjs', `scripts/dev/${suite}.cjs`], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PLAN: '1' } });
  }
  process.exit(0);
}

// --full asks for everything from scratch, but a from-scratch run is only worth repeating when one is due (full-gate.cjs): the tests and the
// mutation suites decide for themselves; the type check, lint and build decide here. Otherwise the run is incremental, and says why.
const fullGate = require('./full-gate.cjs');
let staticFull = full;
if (full) {
  const d = fullGate.decide('static');
  if (!d.full) { staticFull = false; console.log(d.note); }
}
// the label for a step that was asked to run from scratch but did not (its own log carries the NOTE)
const fromScratch = (text) => (full && !/^NOTE: a from-scratch run/m.test(text) ? ' (--full: cache ignored)' : '');

// The database-backed tests and the mutation suites need the scratch PostgreSQL and its bpc_replay_* databases. If a reboot or another session
// removed them, say so now (about a second) instead of failing 25 tests, or a mutation baseline, minutes into the run. SKIP_PREFLIGHT=1 skips it.
if (!process.env.SKIP_PREFLIGHT && !require('./scratch-env.cjs').requireScratch('verify')) process.exit(2);

function step(name, cmd, args, env = process.env) {
  const log = path.join(LOGS, `${name}.log`);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const out = fs.openSync(log, 'w');
    const p = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', out, out], shell: process.platform === 'win32' });
    p.on('close', (code) => {
      fs.closeSync(out);
      const seconds = Math.round((Date.now() - t0) / 1000);
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${name} (${seconds}s)`);
      resolve({ name, ok: code === 0, seconds, log });
    });
  });
}

// The production build is skipped when nothing it reads changed since it last succeeded here (build-cache.cjs); --full and BUILD_CACHE=0 always build.
function buildStep() {
  const bc = require('./build-cache.cjs');
  const key = bc.key();
  if (!staticFull && process.env.BUILD_CACHE !== '0' && bc.unchanged(key)) {
    const log = path.join(LOGS, 'build.log');
    fs.writeFileSync(log, 'build skipped: nothing it reads changed since it last succeeded (BUILD_CACHE=0 or --full builds anyway)\n');
    console.log('ok   build (0s, reused: nothing it reads changed)');
    return Promise.resolve({ name: 'build', ok: true, seconds: 0, log });
  }
  return step('build', npm, ['run', 'build']).then((r) => { if (r.ok) bc.record(key); return r; });
}

(async () => {
  const started = Date.now();
  // Type check and lint keep a cache in node_modules/.cache (incremental tsc, eslint --cache). Measured on this repository the diagnostics are
  // byte-for-byte the same as the plain commands, and a warm run takes 45 s / 15 s instead of 125 s / 112 s. --full (and STATIC_CACHE=0) run the
  // plain commands from scratch.
  const cachedStatic = !staticFull && process.env.STATIC_CACHE !== '0';
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const staticChecks = Promise.all([
    cachedStatic
      ? step('typecheck', npx, ['tsc', '--noEmit', '-p', 'tsconfig.app.json', '--incremental', '--tsBuildInfoFile', 'node_modules/.cache/tsc/app.tsbuildinfo'])
      : step('typecheck', npm, ['run', 'typecheck']),
    cachedStatic
      ? step('lint', npx, ['eslint', '.', '--cache', '--cache-location', 'node_modules/.cache/eslint/'])
      : step('lint', npm, ['run', 'lint']),
    buildStep(),
  ]);
  const chain = (async () => {
    // The test files that touch no scratch database run three at a time (PARALLEL=1 for strictly serial); the database tests stay serial.
    // --full means everything from scratch, the tests too (it used to reach only the mutation suites, so a "full" run still skipped cached tests)
    const results = [await step('tests', 'node', ['scripts/dev/run-tests.cjs'], { ...process.env, PARALLEL: process.env.PARALLEL || '3', ...(full ? { NO_CACHE: '1' } : {}) })];
    if (withMutants) {
      results.push(await step('payment-mutants', 'node', ['scripts/dev/mutation-runner.cjs', 'scripts/dev/payment-mutants.cjs'], mutationEnv));
      results.push(await step('pricing-mutants', 'node', ['scripts/dev/mutation-runner.cjs', 'scripts/dev/pricing-mutants.cjs'], mutationEnv));
    }
    return results;
  })();
  const all = [...(await staticChecks), ...(await chain)];

  // The test runner and the mutation runner report problems in their output, and the mutation runner exits 0 with survivors.
  const problems = [];
  for (const r of all) {
    const text = fs.readFileSync(r.log, 'utf8');
    if (!r.ok) problems.push(`${r.name} failed`);
    else if (r.name === 'tests' && /^FAIL /m.test(text)) problems.push('tests: ' + text.split('\n').filter((l) => l.startsWith('FAIL ')).join(', '));
    else if (/mutants$/.test(r.name)) {
      const m = text.match(/survivors: (\d+)/);
      if (!m) problems.push(`${r.name}: no summary line (see ${r.log})`);
      else if (m[1] !== '0') problems.push(`${r.name}: ${m[1]} survivor(s)`);
      if (/BASELINE FAILS/.test(text)) problems.push(`${r.name}: baseline fails`);
    }
  }
  for (const r of all.filter((x) => /mutants$/.test(x.name))) {
    const m = fs.readFileSync(r.log, 'utf8').match(/^mutants: (\d+) \((\d+) from cache\)/m);
    if (m) console.log(`${r.name}: ${m[1]} mutants, ${m[2]} reused from the cache, ${Number(m[1]) - Number(m[2])} run${fromScratch(fs.readFileSync(r.log, 'utf8'))}`);
  }
  // What did NOT run is reported, never hidden: tests skipped for lack of the evidence-derived databases, and how many were reused.
  const testsLog = all.find((x) => x.name === 'tests');
  const warnings = [];
  if (testsLog) {
    const text = fs.readFileSync(testsLog.log, 'utf8');
    const skipped = text.match(/^SKIPPED \(needs[^\n]*\n((?:     [^\n]+\n?)+)/m);
    if (skipped) warnings.push('tests SKIPPED, not passed (they need the evidence-derived databases, see run-tests.cjs): ' + skipped[1].split('\n').map((l) => l.trim()).filter(Boolean).join(', '));
    const reusedTests = text.match(/^reused from the cache (\d+), ran (\d+)/m);
    if (reusedTests) console.log(`tests: ${reusedTests[1]} reused from the cache, ${reusedTests[2]} run${fromScratch(text)}`);
  }
  console.log(`\nelapsed ${Math.round((Date.now() - started) / 1000)}s; logs in ${LOGS}`);
  if (staticFull) fullGate.record('static');
  if (warnings.length) console.log('WARNINGS:\n  ' + warnings.join('\n  '));
  if (problems.length) {
    console.log('PROBLEMS:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(warnings.length ? 'ALL CLEAR (with the warnings above)' : 'ALL CLEAR');
})();
