// Runs the repository's *.test.ts files one after another (each is a stand-alone script run through jiti).
//
//   node scripts/dev/run-tests.cjs                 every test file (the full suite)
//   node scripts/dev/run-tests.cjs payment         only files whose path contains "payment"
//   node scripts/dev/run-tests.cjs payment edge    several filters (any match)
//
// While developing, run a filter. Before a commit, run the full suite once.
//
// The scratch-database layers of the tests need a local PostgreSQL (see the headers of the *.test.ts files); the defaults below
// match the scratch setup used for this repository and can be overridden through the environment. Nothing here talks to a
// Supabase project or to Stripe.
const { spawnSync, execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);

const env = {
  ROLE_DB_REQUIRE: '1',
  CORE_DB_NAME: 'clean_new',
  CORE_DB_PORT: '54329',
  CORE_DB_HOST: '127.0.0.1',
  CORE_DB_REQUIRE: '1',
  ...process.env,
};

const filters = process.argv.slice(2);
const files = execSync('git ls-files --cached --others --exclude-standard "*.test.ts"', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)));

let pass = 0;
const fails = [];
const timings = [];
const started = Date.now();
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync('node', ['node_modules/jiti/bin/jiti.js', f], { encoding: 'utf8', timeout: 300000, maxBuffer: 50 * 1024 * 1024, env });
  timings.push([f, Date.now() - t0]);
  if (r.status === 0) pass++;
  else fails.push(f);
}
console.log(`files ${files.length} pass ${pass} fail ${fails.length}`);
fails.forEach((f) => console.log('FAIL', f));
console.log('slowest:', timings.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, ms]) => `${path.basename(f)} ${Math.round(ms / 1000)}s`).join(', '));
console.log(`elapsed ${Math.round((Date.now() - started) / 1000)}s`);
