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
//   - the baseline runs once, on worker 0;
//   - KILL-MAP: the test that killed each mutant last time (and, failing that, the test that usually kills mutants of that file)
//     runs first. Order never changes a verdict, only how soon a kill happens;
//   - RESULT CACHE: a verdict is reused when nothing it could depend on changed (the mutant definition, the mutated file, the
//     covering tests and everything those tests import or read, and the migrations). Results are saved as they arrive, so an
//     interrupted run resumes instead of starting over. NO_CACHE=1 ignores the cache (do this for the final run before a commit);
//   - FAST FIRST PASS: the slow concurrent-database section of paymentOperations.test.ts is skipped on the first attempt
//     (MUTATION_SKIP_CONCURRENT=1). A mutant is only reported SURVIVED after a second, complete attempt, so no verdict is weakened.
//     FAST_PASS=0 turns the first pass off.
//
// More environment:
//   ONLY_FILE=<regex>  run only mutants whose target file path matches (e.g. \.sql$)
//   CHANGED=1          run only mutants whose file, or covering test, differs from HEAD (git diff + untracked files)
//   NO_CACHE=1         neither read nor write the result cache
//   MUTATION_TEST_TIMEOUT_MS=<ms>   how long one test file may run before it is stopped (default 300000)
//
// What makes a KILL trustworthy:
//   - every mutant runs in a PRISTINE worker database (dropped before each attempt), so a kill can never come from rows an earlier
//     mutant, an earlier run or an earlier killed test left behind;
//   - a kill needs a failed ASSERTION: a non-zero exit plus at least one "FAIL" line the test printed. A timeout, a crash before
//     any assertion, a spawn failure, a missing or unreachable database, or a full disk is an ERROR (reported, never counted as a
//     kill, never cached), and the run exits non-zero;
//   - the end of the run lists the check that killed each mutant and warns when one check killed mutants in several unrelated files.
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const WORK = path.join(os.tmpdir(), 'mutwork');
const PRELOAD = path.join(__dirname, 'mutation-preload.cjs');
const PSQL = process.env.PAY_DB_PSQL || (fs.existsSync('C:/Program Files/PostgreSQL/18/bin/psql.exe') ? 'C:/Program Files/PostgreSQL/18/bin/psql.exe' : 'psql');
const DB_HOST = process.env.ROLE_DB_HOST || process.env.CORE_DB_HOST || '127.0.0.1';
const DB_PORT = process.env.ROLE_DB_PORT || process.env.CORE_DB_PORT || '54329';

const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'mutation');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const readText = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };

// Every repository file a test file depends on: what it imports (relative specifiers) and the repository paths it names in
// string literals (migrations and sources it reads). Followed transitively. Anything missed would only make the cache reuse a
// verdict it should not have, so the migrations folder is always added below as well.
const closureMemo = new Map();
function closureOf(testRel) {
  if (closureMemo.has(testRel)) return closureMemo.get(testRel);
  const seen = new Set();
  const stack = [testRel];
  const exts = ['', '.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.tsx'];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const text = readText(rel);
    if (text === null) continue;
    seen.add(rel);
    if (!/\.(tsx?|[cm]?js)$/.test(rel)) continue;
    for (const m of text.matchAll(/(?:from|import|require)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      for (const e of exts) {
        const cand = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1] + e));
        if (readText(cand) !== null && fs.statSync(path.join(ROOT, cand)).isFile()) { stack.push(cand); break; }
      }
    }
    for (const m of text.matchAll(/['"`]((?:src|supabase|scripts)\/[A-Za-z0-9_.\-/]+\.(?:tsx?|sql|[cm]?js|json))['"`]/g)) stack.push(m[1]);
  }
  closureMemo.set(testRel, seen);
  return seen;
}
let migrationsDigest;
function migrations() {
  if (migrationsDigest) return migrationsDigest;
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const h = crypto.createHash('sha256');
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) h.update(n).update(fs.readFileSync(path.join(dir, n)));
  return (migrationsDigest = h.digest('hex'));
}
const testDigestMemo = new Map();
function testDigest(testRel) {
  if (!testDigestMemo.has(testRel)) {
    const h = crypto.createHash('sha256');
    for (const rel of [...closureOf(testRel)].sort()) h.update(rel).update(readText(rel));
    testDigestMemo.set(testRel, h.digest('hex'));
  }
  return testDigestMemo.get(testRel);
}

function loadCache(spec) {
  const file = path.join(CACHE_DIR, path.basename(spec).replace(/\W/g, '_') + '.json');
  let data = { entries: {}, killers: {}, fileKillers: {}, baseline: null };
  if (!process.env.NO_CACHE) {
    try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* no cache yet, or unreadable: start empty */ }
  }
  const save = () => {
    if (process.env.NO_CACHE) return;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data));
    fs.renameSync(file + '.tmp', file);
  };
  return { data, save };
}

// Kill-map ordering: last killer of this mutant, then the usual killer of this file, then the given order.
function orderTests(cache, file, name, tests) {
  const last = cache.data.killers[file + '|' + name];
  const counts = cache.data.fileKillers[file] || {};
  const rank = (t) => (t === last ? -1 : -(counts[t] || 0));
  return tests.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

function changedFiles() {
  const run = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  return new Set([...run(['diff', '--name-only', 'HEAD']), ...run(['ls-files', '--others', '--exclude-standard'])]);
}

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

const TEST_TIMEOUT_MS = Number(process.env.MUTATION_TEST_TIMEOUT_MS) || 300000;
// Output that means the ENVIRONMENT failed, not that a mutant was caught.
const INFRA_OUTPUT = /ECONNREFUSED|could not connect to server|connection to server at .* failed|Connection refused|ENOSPC|No space left on device|EMFILE|too many connections|spawn .* ENOENT|(role|database) "[^"]+" does not exist/i;
// The labels the tests print when the scratch database they require cannot be found (ROLE_DB_REQUIRE / CORE_DB_REQUIRE / HARD_DB_REQUIRE).
const INFRA_LABEL = /(scratch database|scratch databases)[^\n]*(is|are) available[^\n]*REQUIRE|probe could not reach/i;

// exit code + output -> { killed } for a kill, { error } for anything that is not a failed assertion.
function judge(code, signal, timedOut, stderr) {
  if (timedOut) return { error: `TIMEOUT after ${Math.round(TEST_TIMEOUT_MS / 1000)}s (the test was stopped, so nothing was asserted)` };
  if (signal) return { error: `test process ended by signal ${signal}` };
  const fail = stderr.split('\n').find((l) => /^FAIL/.test(l));
  if (!fail) return { error: `exit code ${code} with no failed assertion (setup or infrastructure failure): ${(stderr.trim().split('\n')[0] || 'no output').slice(0, 120)}` };
  if (INFRA_OUTPUT.test(stderr) || INFRA_LABEL.test(fail)) return { error: `infrastructure failure, not a kill: ${fail.slice(0, 120)}` };
  return { killed: true };
}

function runTests(cwd, tests, idx, fast) {
  const env = {
    ...process.env,
    MUTATION_FAILFAST: '1',
    ...(fast ? { MUTATION_SKIP_CONCURRENT: '1' } : {}),
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
      let timedOut = false;
      let settled = false;
      p.stderr.on('data', (d) => { stderr += d; });
      p.stdout.on('data', () => {});
      const timer = setTimeout(() => { timedOut = true; p.kill(); }, TEST_TIMEOUT_MS);
      const finish = (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0 && !signal && !timedOut) return next();
        const v = judge(code, signal, timedOut, stderr);
        resolve({ ...v, stderr, test: t });
      };
      p.on('error', (e) => { stderr += `\nSPAWN ERROR ${e.message}`; finish(1, null); });
      p.on('close', finish);
    };
    next();
  });
}

// `tests` is a list, or a function (mutated file) -> list.
exports.runMutants = async function runMutants({ M, tests, spec = 'mutants' }) {
  const started = Date.now();
  const testsFor = (file) => (typeof tests === 'function' ? tests(file) : tests);
  const workers = Math.max(1, Number(process.env.WORKERS) || os.cpus().length - 1);
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const originals = {};
  for (const f of new Set(M.map((m) => m[0]))) originals[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

  const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
  let selected = M.map((m, index) => ({ m, index })).filter(({ m }) => !only || only.test(m[1]));
  if (process.env.ONLY_FILE) {
    const onlyFile = new RegExp(process.env.ONLY_FILE, 'i');
    selected = selected.filter(({ m }) => onlyFile.test(m[0]));
  }
  if (process.env.CHANGED) {
    const changed = changedFiles();
    selected = selected.filter(({ m }) => changed.has(m[0]) || testsFor(m[0]).some((t) => changed.has(t)));
  }
  if (process.env.LIST) {
    selected.forEach(({ m }) => console.log(`${m[0]}  ${m[1]}`));
    return;
  }

  // Reuse a KILLED verdict when nothing it depends on changed. SURVIVED is never reused: survivors are the thing to look at.
  const cache = loadCache(spec);
  const results = new Array(M.length);
  const keyOf = ({ m }) => {
    const [file, name, muts] = m;
    return sha(JSON.stringify([file, name, muts.map(String), originals[file], migrations(), testsFor(file).map(testDigest)]));
  };
  const todo = [];
  let reused = 0;
  for (const item of selected) {
    const hit = process.env.NO_CACHE ? null : cache.data.entries[keyOf(item)];
    if (hit && hit.status === 'KILLED') {
      results[item.index] = { name: item.m[1], status: 'KILLED', detail: hit.detail, cached: true };
      reused++;
    } else {
      todo.push(item);
    }
  }
  if (reused) console.log(`${reused} mutant(s) reused from the cache (unchanged inputs); ${todo.length} to run`);
  if (todo.length) {
    // The worker databases have fixed names, so two runners at once would drop and fill each other's databases and every verdict
    // would be debris. Refuse to start beside another runner of this tool.
    const lock = path.join(require('os').tmpdir(), 'bpc-mutation-runner.lock');
    let other = 0;
    try { other = Number(fs.readFileSync(lock, 'utf8')); } catch { /* no lock */ }
    if (other && other !== process.pid) {
      let alive = true;
      try { process.kill(other, 0); } catch { alive = false; }
      if (alive) {
        console.error(`ANOTHER mutation runner (pid ${other}) is using the scratch worker databases; wait for it or stop it. Refusing to run.`);
        process.exit(2);
      }
    }
    fs.writeFileSync(lock, String(process.pid));
    process.on('exit', () => { try { if (Number(fs.readFileSync(lock, 'utf8')) === process.pid) fs.unlinkSync(lock); } catch { /* gone */ } });
  }
  const used = Math.min(workers, Math.max(1, todo.length));
  const dirs = Array.from({ length: used }, (_, i) => path.join(WORK, `w${i}`));
  if (todo.length) for (const d of dirs) sync(d);

  // The baseline only has to run when something will actually run, and not again while every input is as it was when it last passed.
  const baselineTests = [...new Set(M.flatMap((m) => testsFor(m[0])))];
  const baselineKey = sha(JSON.stringify([migrations(), baselineTests.map(testDigest), Object.values(originals)]));
  if (todo.length && !process.env.SKIP_BASELINE && !process.env.NO_CACHE && cache.data.baseline === baselineKey) {
    console.log('baseline reused (no input changed since it last passed)');
  } else if (todo.length && !process.env.SKIP_BASELINE) {
    dropDb('pay_mut_0');
    const base = await runTests(dirs[0], baselineTests, 0);
    if (base.killed || base.error) {
      console.log('BASELINE FAILS in ' + base.test + (base.error ? '\n' + base.error : '') + '\n' + base.stderr.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 8).join('\n'));
      process.exit(1);
    }
    cache.data.baseline = baselineKey;
    cache.save();
  }
  console.log(`baseline ok; ${todo.length} mutants on ${used} worker(s)`);
  // Whatever an earlier run, a killed test or a skipped baseline left in the worker databases is gone before the first mutant; each
  // mutant then gets its own pristine database below.
  for (let i = 0; i < used; i++) dropDb(`pay_mut_${i}`);

  const fastPass = process.env.FAST_PASS !== '0';
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
      // EVERY attempt starts from a pristine scratch database. A killed test exits before it cleans up, so reusing the database
      // would hand its rows to the next mutant (and a schema mutant's schema too); a kill must come from the check that guards the
      // property, never from debris. Creating the database costs seconds; the tests then create it from the unmutated template.
      const ordered = orderTests(cache, file, name, testsFor(file));
      dropDb(`pay_mut_${idx}`);
      let r = await runTests(dir, ordered, idx, fastPass);
      // A mutant is only SURVIVED after a complete attempt: the fast first pass skips the slow concurrent section, so retry in full.
      if (fastPass && !r.killed && !r.error) {
        dropDb(`pay_mut_${idx}`);
        r = await runTests(dir, ordered, idx, false);
      }
      fs.writeFileSync(target, originals[file]);
      const first = r.stderr.split('\n').find((l) => /^FAIL/.test(l)) || '';
      if (r.error) {
        // An error is neither a kill nor a survivor and is never cached.
        results[index] = { name, status: 'ERROR', detail: r.error, seconds: Math.round((Date.now() - t0) / 1000) };
        continue;
      }
      results[index] = { name, status: r.killed ? 'KILLED' : 'SURVIVED', detail: first.slice(0, 110), seconds: Math.round((Date.now() - t0) / 1000), file, test: r.test };
      if (r.killed) {
        cache.data.entries[keyOf({ m })] = { status: 'KILLED', detail: first.slice(0, 110), test: r.test };
        cache.data.killers[file + '|' + name] = r.test;
        const counts = (cache.data.fileKillers[file] = cache.data.fileKillers[file] || {});
        counts[r.test] = (counts[r.test] || 0) + 1;
        cache.save();
      }
    }
  };
  await Promise.all(dirs.map((d, i) => worker(d, i)));

  for (let i = 0; i < used; i++) dropDb(`pay_mut_${i}`);
  let survivors = 0;
  let errors = 0;
  const killers = new Map();
  for (const r of results) {
    if (!r) continue;
    if (r.status === 'ERROR' || r.status === 'ANCHOR ERROR') errors++;
    else if (r.status !== 'KILLED') survivors++;
    console.log(`${r.status.padEnd(8)} ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
    if (r.status === 'KILLED' && r.file && r.detail) {
      if (!killers.has(r.detail)) killers.set(r.detail, new Set());
      killers.get(r.detail).add(r.file);
    }
  }
  // One check that kills mutants in many unrelated files is suspicious (debris or an environment problem looks exactly like that).
  for (const [label, files] of killers) {
    if (files.size >= 4) console.log(`WARNING: one check killed mutants in ${files.size} different files - confirm it guards all of them: ${label}`);
  }
  const intact = Object.keys(originals).every((f) => fs.readFileSync(path.join(ROOT, f), 'utf8') === originals[f]);
  console.log(`mutants: ${selected.length} (${reused} from cache) survivors: ${survivors} errors: ${errors} | repository files untouched: ${intact} | elapsed ${Math.round((Date.now() - started) / 1000)}s on ${used} worker(s)`);
  if (errors) {
    console.log(`${errors} mutant(s) could not be judged (see ERROR lines): the run is NOT valid until they are fixed.`);
    process.exitCode = 1;
  }
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
    exports.runMutants({ M: mod.M, tests: mod.tests, spec });
  }
}
