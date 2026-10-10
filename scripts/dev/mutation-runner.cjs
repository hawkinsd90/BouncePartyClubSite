// Parallel mutation runner.
//
// A mutant breaks ONE safety property in ONE source file. A test must then fail ("KILLED"). A mutant that no test notices
// ("SURVIVED") is a gap in the tests.
//
// Each worker owns a private copy of the source tree (src, supabase, scripts) under the OS temp folder with node_modules linked
// in, so mutants never touch the real repository (a crash cannot leave a mutant behind) and several mutants run at once.
//
//   node scripts/dev/mutation-runner.cjs scripts/dev/payment-mutants.cjs
//
// Environment:
//   ONLY=<regex>       run only mutants whose name matches the regular expression (use this while developing; run everything before a commit)
//   WORKERS=<n>        worker count (default: cores - 1, at least 1)
//   SKIP_BASELINE=1    skip the unmutated baseline run (only when the tests were just run green)
//   LIST=1             print the mutant names and exit
//   PAY_DB_PSQL        path to psql for the scratch database (default: the Windows PostgreSQL 18 install, else psql on PATH)
//
// What makes a run fast without weakening it:
//   - tests run with fail-fast: the first FAIL line ends the test process (all a kill needs);
//   - a mutant's test files are ordered most-likely-to-kill first (SQL mutants: SQL tests first; code mutants: handler tests
//     first), so most mutants die in the first file;
//   - a worker's scratch database is dropped and re-created only for mutants that edit a SQL migration (schema mutants such as
//     "remove an index" need a clean database); code mutants reuse it;
//   - the baseline runs once, on worker 0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const WORK = path.join(os.tmpdir(), 'mutwork');
const PRELOAD = path.join(__dirname, 'mutation-preload.cjs');
const PSQL = process.env.PAY_DB_PSQL || (fs.existsSync('C:/Program Files/PostgreSQL/18/bin/psql.exe') ? 'C:/Program Files/PostgreSQL/18/bin/psql.exe' : 'psql');
const DB_HOST = process.env.ROLE_DB_HOST || process.env.CORE_DB_HOST || '127.0.0.1';
const DB_PORT = process.env.ROLE_DB_PORT || process.env.CORE_DB_PORT || '54329';

function sync(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const dir of ['src', 'supabase', 'scripts']) {
    // robocopy exit codes below 8 mean success
    const r = spawnSync('robocopy', [path.join(ROOT, dir), path.join(dest, dir), '/MIR', '/XD', 'node_modules', '.git', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'], { encoding: 'utf8' });
    if (r.status >= 8) throw new Error(`robocopy failed for ${dir}: ${r.stdout}`);
  }
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dest, 'package.json'));
  const link = path.join(dest, 'node_modules');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(ROOT, 'node_modules'), link, 'junction');
}

const dropDb = (name) =>
  spawnSync(PSQL, ['-h', DB_HOST, '-p', DB_PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-c', `DROP DATABASE IF EXISTS ${name}`], { encoding: 'utf8' });

function runTests(cwd, tests, idx) {
  const env = {
    ...process.env,
    MUTATION_FAILFAST: '1',
    PAY_DB_BASE: `pay_base_${idx}`,
    PAY_DB_FULL: `pay_mut_${idx}`,
    ROLE_DB_REQUIRE: '1',
    CORE_DB_NAME: 'clean_new',
    CORE_DB_PORT: DB_PORT,
    CORE_DB_HOST: DB_HOST,
    CORE_DB_REQUIRE: '1',
  };
  return new Promise((resolve) => {
    let stderr = '';
    let i = 0;
    const next = () => {
      if (i >= tests.length) return resolve({ killed: false, stderr });
      const t = tests[i++];
      const p = spawn('node', ['--require', PRELOAD, 'node_modules/jiti/bin/jiti.js', t], { cwd, env });
      p.stderr.on('data', (d) => { stderr += d; });
      p.stdout.on('data', () => {});
      const timer = setTimeout(() => p.kill(), 300000);
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return resolve({ killed: true, stderr, test: t });
        next();
      });
    };
    next();
  });
}

// `tests` is a list, or a function (mutated file) -> list.
exports.runMutants = async function runMutants({ M, tests }) {
  const started = Date.now();
  const testsFor = (file) => (typeof tests === 'function' ? tests(file) : tests);
  const workers = Math.max(1, Number(process.env.WORKERS) || os.cpus().length - 1);
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const originals = {};
  for (const f of new Set(M.map((m) => m[0]))) originals[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

  const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
  const todo = M.map((m, index) => ({ m, index })).filter(({ m }) => !only || only.test(m[1]));
  if (process.env.LIST) {
    todo.forEach(({ m }) => console.log(`${m[0]}  ${m[1]}`));
    return;
  }
  const used = Math.min(workers, Math.max(1, todo.length));
  const dirs = Array.from({ length: used }, (_, i) => path.join(WORK, `w${i}`));
  for (const d of dirs) sync(d);

  if (!process.env.SKIP_BASELINE) {
    dropDb('pay_mut_0');
    const base = await runTests(dirs[0], [...new Set(M.flatMap((m) => testsFor(m[0])))], 0);
    if (base.killed) {
      console.log('BASELINE FAILS in ' + base.test + '\n' + base.stderr.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 8).join('\n'));
      process.exit(1);
    }
  }
  console.log(`baseline ok; ${todo.length} mutants on ${used} worker(s)`);

  const results = new Array(M.length);
  let cursor = 0;
  const worker = async (dir, idx) => {
    while (cursor < todo.length) {
      const { m, index } = todo[cursor++];
      const [file, name, muts] = m;
      let src = norm(originals[file]);
      try {
        for (const fn of muts) src = fn(src);
      } catch (e) {
        results[index] = { name, status: 'ANCHOR ERROR', detail: e.message };
        continue;
      }
      const target = path.join(dir, file);
      fs.writeFileSync(target, originals[file].includes('\r\n') ? src.replace(/\n/g, '\r\n') : src);
      const t0 = Date.now();
      // Only a migration mutant can change the schema, so only it needs a pristine scratch database.
      if (file.endsWith('.sql')) dropDb(`pay_mut_${idx}`);
      const r = await runTests(dir, testsFor(file), idx);
      fs.writeFileSync(target, originals[file]);
      // ...and a mutated schema must not leak into the next mutant either.
      if (file.endsWith('.sql')) dropDb(`pay_mut_${idx}`);
      const first = r.stderr.split('\n').find((l) => /^FAIL/.test(l)) || '';
      results[index] = { name, status: r.killed ? 'KILLED' : 'SURVIVED', detail: first.slice(0, 110), seconds: Math.round((Date.now() - t0) / 1000) };
    }
  };
  await Promise.all(dirs.map((d, i) => worker(d, i)));

  let survivors = 0;
  for (const r of results) {
    if (!r) continue;
    if (r.status !== 'KILLED') survivors++;
    console.log(`${r.status.padEnd(8)} ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
  }
  const intact = Object.keys(originals).every((f) => fs.readFileSync(path.join(ROOT, f), 'utf8') === originals[f]);
  console.log(`mutants: ${todo.length} survivors: ${survivors} | repository files untouched: ${intact} | elapsed ${Math.round((Date.now() - started) / 1000)}s on ${used} worker(s)`);
};

if (require.main === module) {
  const spec = process.argv[2];
  if (!spec) {
    console.error('usage: node scripts/dev/mutation-runner.cjs <mutants file>   (the file exports { M, tests })');
    process.exit(2);
  }
  const mod = require(path.resolve(spec));
  if (process.env.DRY) {
    // every anchor must exist exactly once
    let bad = 0;
    for (const [file, name, muts] of mod.M) {
      let src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
      try { for (const fn of muts) src = fn(src); } catch (e) { bad++; console.log('ANCHOR ERROR:', name, '->', e.message); }
    }
    console.log(`${mod.M.length} mutants; anchor errors: ${bad}`);
  } else {
    exports.runMutants({ M: mod.M, tests: mod.tests });
  }
}
