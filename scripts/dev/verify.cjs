// One command for the whole verification chain, with the independent checks overlapped.
//
//   node scripts/dev/verify.cjs              the default, INCREMENTAL: typecheck + lint + build in parallel with tests, then both mutation
//                                            suites, which rerun only the mutants whose inputs changed (a pure move or rename reruns none)
//   node scripts/dev/verify.cjs --quick      static checks and tests only (no mutants)
//   node scripts/dev/verify.cjs --plan       say how many mutants the current changes would rerun, without running anything
//   node scripts/dev/verify.cjs --full       everything from scratch: stored verdicts are ignored, then the new ones REPLACE the cache, so
//                                            the next default run is cheap again. The run before the final commit.
//   CHANGED=1  node scripts/dev/verify.cjs   only mutants whose file or test is in the current git diff (faster, less thorough)
//   PARALLEL=n node scripts/dev/verify.cjs   how many database-free test files run at once (default 6; 1 = strictly serial)
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

(async () => {
  const started = Date.now();
  const staticChecks = Promise.all([
    step('typecheck', npm, ['run', 'typecheck']),
    step('lint', npm, ['run', 'lint']),
    step('build', npm, ['run', 'build']),
  ]);
  const chain = (async () => {
    // The test files that touch no scratch database run six at a time (PARALLEL=1 for strictly serial); the database tests stay serial.
    const results = [await step('tests', 'node', ['scripts/dev/run-tests.cjs'], { ...process.env, PARALLEL: process.env.PARALLEL || '6' })];
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
    if (m) console.log(`${r.name}: ${m[1]} mutants, ${m[2]} reused from the cache, ${Number(m[1]) - Number(m[2])} run${full ? ' (--full: cache ignored)' : ''}`);
  }
  console.log(`\nelapsed ${Math.round((Date.now() - started) / 1000)}s; logs in ${LOGS}`);
  if (problems.length) {
    console.log('PROBLEMS:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('ALL CLEAR');
})();
