// Runs the repository's *.test.ts files one after another (each is a stand-alone script run through jiti).
//
//   node scripts/dev/run-tests.cjs                 every test file (the full suite)
//   node scripts/dev/run-tests.cjs payment         only files whose path contains "payment"
//   node scripts/dev/run-tests.cjs payment edge    several filters (any match)
//   PARALLEL=6 node scripts/dev/run-tests.cjs      run the files that do not touch a database six at a time (default 1 = strictly serial)
//
// While developing, run a filter. Before a commit, run the full suite once.
//
// The scratch-database layers of the tests need a local PostgreSQL with the bpc_replay_* databases. Which database each test file uses
// comes from scripts/dev/scratch-env.cjs (the same mapping as the Step 3 security acceptance), and a check at the start fails in
// about a second, with the fix, when the server or the databases are missing. Nothing here talks to a Supabase project or to Stripe.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);

const scratch = require('./scratch-env.cjs');
const envFor = (file) => ({ ...process.env, ...scratch.envFor(file) });

const filters = process.argv.slice(2);
const files = execSync('git ls-files --cached --others --exclude-standard "*.test.ts"', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)));

// Files that name a scratch database always run one at a time, after the rest, so they never share a database.
const usesDatabase = (f) => /(PAY|CORE|ROLE|HARD|SWEEP|POSTURE|DEVREFRESH)_DB|_DB_NAME|ensurePayDatabase|bpc_replay|psql|PSQL/.test(fs.readFileSync(f, 'utf8'));
const parallel = Math.max(1, Number(process.env.PARALLEL) || 1);

const runOne = (f) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn('node', ['node_modules/jiti/bin/jiti.js', f], { env: envFor(f) });
    p.stdout.on('data', () => {});
    p.stderr.on('data', () => {});
    const timer = setTimeout(() => p.kill(), 300000);
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ f, ok: code === 0, ms: Date.now() - t0 });
    });
  });

(async () => {
  const started = Date.now();
  // Stop at once, with the fix, when the scratch server or its databases are gone (otherwise every database test fails confusingly).
  if (!process.env.SKIP_PREFLIGHT && files.some(usesDatabase) && !scratch.requireScratch('run-tests')) process.exit(2);
  const serialFiles = parallel > 1 ? files.filter(usesDatabase) : files;
  const poolFiles = parallel > 1 ? files.filter((f) => !serialFiles.includes(f)) : [];
  const done = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, Math.max(1, poolFiles.length)) }, async () => {
      while (cursor < poolFiles.length) done.push(await runOne(poolFiles[cursor++]));
    }),
  );
  for (const f of serialFiles) done.push(await runOne(f));

  const fails = done.filter((d) => !d.ok).map((d) => d.f);
  console.log(`files ${files.length} pass ${done.length - fails.length} fail ${fails.length}`);
  fails.forEach((f) => console.log('FAIL', f));
  console.log('slowest:', done.sort((a, b) => b.ms - a.ms).slice(0, 5).map((d) => `${path.basename(d.f)} ${Math.round(d.ms / 1000)}s`).join(', '));
  console.log(`elapsed ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(fails.length ? 1 : 0);
})();
