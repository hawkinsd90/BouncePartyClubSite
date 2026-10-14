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
//     interrupted run resumes instead of starting over. NO_CACHE=1 ignores the stored verdicts, runs everything and records the new ones (do this for the final run before a commit);
//   - FAST FIRST PASS: the slow concurrent-database section of paymentOperations.test.ts is skipped on the first attempt
//     (MUTATION_SKIP_CONCURRENT=1). A mutant is only reported SURVIVED after a second, complete attempt, so no verdict is weakened.
//     FAST_PASS=0 turns the first pass off.
//
// More environment:
//   ONLY_FILE=<regex>  run only mutants whose target file path matches (e.g. \.sql$)
//   CHANGED=1          run only mutants whose file, or covering test, differs from HEAD (git diff + untracked files)
//   NO_CACHE=1         ignore the stored verdicts and run everything; the results REPLACE the cache (nothing is written when ONLY, ONLY_FILE or CHANGED
//                      narrows the run, so a partial run cannot wipe the rest)
//   CACHE_OFF=1        neither read nor write the result cache
//   PLAN=1             say how many mutants this change would run (and for which files), without running anything
//   MUTATION_TEST_TIMEOUT_MS=<ms>   how long one test file may run before it is stopped (default 300000)
//
// Incremental: a KILLED verdict is reused while nothing it depends on changed (see "what a cached verdict depends on" below). The key is
// CONTENT: a moved or renamed file, or an edit that touches only the import lines pointing at it, keeps every verdict; a real edit
// of the mutated source, of a covering test, of anything those tests load, or (for tests that read them) of the migrations, reruns just
// the mutants it touches. NO_CACHE=1 runs everything from scratch and refreshes the cache with what it finds (the full run before a commit).
//
// Speed (measured on this machine; creating or dropping one scratch database takes 3-50 s, which used to be paid on every attempt):
//   - each worker builds its pristine databases AHEAD of time, in the background, from a private template nothing connects to, and
//     takes one that is already built (DB_SLOTS=<n>, default 3 per worker); the wait for one is shown by PROFILE=1 as dbwait;
//   - database work never blocks the runner, so one worker waiting on PostgreSQL does not stall the others;
//   - tests are ordered by (chance of killing) / (running time), learned from earlier runs and kept in the cache;
//   - PROFILE=1 prints, per mutant, how long each test file ran and whether it killed.
// MUT_NS=<name> runs a second runner beside the first: it gets its own worker databases, work folder, cache and lock. It needs its
// own pay_base_<name>_<n> databases (for example: CREATE DATABASE pay_base_<name>_0 TEMPLATE role_full).
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
// MUT_NS=<name> gives this run its own worker databases, work folder, cache and lock (to measure beside another run).
const NS = process.env.MUT_NS ? `${process.env.MUT_NS}_` : '';
const WORK = path.join(os.tmpdir(), NS ? `mutwork_${NS}` : 'mutwork');
const mutDb = (i) => `pay_mut_${NS}${i}`;
const PRELOAD = path.join(__dirname, 'mutation-preload.cjs');
const PSQL = process.env.PAY_DB_PSQL || (fs.existsSync('C:/Program Files/PostgreSQL/18/bin/psql.exe') ? 'C:/Program Files/PostgreSQL/18/bin/psql.exe' : 'psql');
const DB_HOST = process.env.ROLE_DB_HOST || process.env.CORE_DB_HOST || '127.0.0.1';
const DB_PORT = process.env.ROLE_DB_PORT || process.env.CORE_DB_PORT || '54329';

const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', NS ? `mutation_${NS}` : 'mutation');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const readText = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };

// ---- what a cached verdict depends on, written as CONTENT so that moving or renaming a file changes nothing ---------------------------
// A KILLED verdict is reused when nothing it depends on changed: the mutated source, and every file the covering tests load or read.
// A reference from one file to another (a relative import, or a repository path in a string) goes into the digest as the DIGEST OF
// THE TARGET'S CONTENT, never as a path. So moving a file, or editing only the import lines that point at it, changes no digest;
// pointing a reference at a different file, or editing any code, does. (A target's own references are blanked when it is used as a
// reference, so the digests are finite even for import cycles.) The mutated source itself is part of the key, so a changed anchor or
// replacement in a mutants file is a different mutant, not a stale verdict.
const KEY_VERSION = 'k3';
const EXTS = ['', '.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.tsx'];
const IMPORT_RE = /((?:from|import|require)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;
const PATH_RE = /(['"`])((?:src|supabase|scripts)\/[A-Za-z0-9_.\-/]+\.(?:tsx?|sql|[cm]?js|json))\1/g;
const CODE_RE = /\.(tsx?|[cm]?js)$/;
const lf = (t) => t.replace(/\r\n/g, '\n');
const isFile = (rel) => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch { return false; } };
const bn = (p) => String(p).replace(/\\/g, '/').split('/').pop();

function resolveImport(fromRel, spec) {
  for (const e of EXTS) {
    const cand = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec + e));
    if (isFile(cand)) return cand;
  }
  return null;
}
// the text with every reference to a repository file replaced by refToken(target)
function rewriteRefs(fromRel, text, refToken) {
  if (!CODE_RE.test(fromRel)) return text;
  return text
    .replace(IMPORT_RE, (all, pre, q, spec) => { const t = resolveImport(fromRel, spec); return t ? `${pre}${q}<${refToken(t)}>${q}` : all; })
    .replace(PATH_RE, (all, q, p) => (isFile(p) ? `${q}<${refToken(p)}>${q}` : all));
}
const anonMemo = new Map();
function anonDigest(rel) { // a file's content with all of its references blanked
  if (!anonMemo.has(rel)) anonMemo.set(rel, sha(rewriteRefs(rel, lf(readText(rel) ?? ''), () => 'ref')));
  return anonMemo.get(rel);
}
function textDigest(rel, text) { // content with each reference replaced by the target's blanked digest
  return sha(rewriteRefs(rel, lf(text), anonDigest));
}
const ndMemo = new Map();
const nd = (rel) => { if (!ndMemo.has(rel)) ndMemo.set(rel, textDigest(rel, readText(rel) ?? '')); return ndMemo.get(rel); };

// Every repository file a test file depends on: what it imports and the repository paths it names in strings (sources and migrations it
// reads), followed transitively.
const closureMemo = new Map();
function closureOf(testRel) {
  if (closureMemo.has(testRel)) return closureMemo.get(testRel);
  const seen = new Set();
  const stack = [testRel];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const text = readText(rel);
    if (text === null) continue;
    seen.add(rel);
    if (!CODE_RE.test(rel)) continue;
    for (const m of text.matchAll(IMPORT_RE)) { const t = resolveImport(rel, m[3]); if (t) stack.push(t); }
    for (const m of text.matchAll(PATH_RE)) stack.push(m[2]);
  }
  closureMemo.set(testRel, seen);
  return seen;
}
const closureDigestMemo = new Map();
function closureDigest(testRel) {
  if (!closureDigestMemo.has(testRel)) closureDigestMemo.set(testRel, sha(JSON.stringify([...closureOf(testRel)].map(nd).sort())));
  return closureDigestMemo.get(testRel);
}
// Only a test that mentions the migrations folder can depend on the migrations; the others keep their verdicts when one is added.
const needsMigrationsMemo = new Map();
function needsMigrations(testRel) {
  if (!needsMigrationsMemo.has(testRel)) needsMigrationsMemo.set(testRel, [...closureOf(testRel)].some((rel) => /migrations/.test(readText(rel) ?? '')));
  return needsMigrationsMemo.get(testRel);
}
let migrationsDigest;
function migrations() {
  if (migrationsDigest) return migrationsDigest;
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const h = crypto.createHash('sha256');
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) h.update(n).update(lf(fs.readFileSync(path.join(dir, n), 'utf8')));
  return (migrationsDigest = h.digest('hex'));
}

// A mutant is identified by what it IS: its name and the exact mutated source (so a changed anchor or replacement is a different mutant).
// Its KILLED verdict stays valid while the test that killed it is unchanged: that test failed on the mutant, so a kill depends on that one
// test's closure (and the migrations, when it reads them) and on nothing else; the other covering tests never mattered. An anchor that no
// longer matches gives no id (and is never cached). A verdict seeded from an old log does not know its killer, so it is tied to the whole
// set of covering tests instead.
function makeKeyer(testsFor, originals) {
  const mutatedSource = (m) => { let src = lf(originals[m[0]]); for (const fn of m[2]) src = fn(src); return src; };
  const idOf = (m) => {
    let mutated;
    try { mutated = mutatedSource(m); } catch { return null; }
    return sha(JSON.stringify([KEY_VERSION, m[1], textDigest(m[0], mutated), nd(m[0])]));
  };
  const killerDigest = (t) => sha(JSON.stringify([closureDigest(t), needsMigrations(t) ? migrations() : null]));
  const setDigest = (m) => { const tests = testsFor(m[0]); return sha(JSON.stringify([tests.map(closureDigest), tests.some(needsMigrations) ? migrations() : null])); };
  const valid = (entry, m) => {
    if (!entry || entry.status !== 'KILLED') return false;
    if (entry.killerDigest) {
      const t = testsFor(m[0]).find((x) => bn(x) === entry.test);
      return !!t && killerDigest(t) === entry.killerDigest;
    }
    return entry.setDigest === setDigest(m);
  };
  const entryFor = (killerTest, detail) => ({ status: 'KILLED', detail, test: bn(killerTest), killerDigest: killerDigest(killerTest) });
  const baselineKey = (tests) => sha(JSON.stringify([KEY_VERSION, [...new Set(tests)].map(closureDigest).sort(), tests.some(needsMigrations) ? migrations() : null]));
  return { idOf, valid, entryFor, setDigest, baselineKey };
}

function loadCache(spec) {
  const file = path.join(CACHE_DIR, path.basename(spec).replace(/\W/g, '_') + '.json');
  const empty = () => ({ keyVersion: KEY_VERSION, entries: {}, killers: {}, fileKillers: {}, testStats: {}, baseline: null });
  let data = empty();
  if (!process.env.NO_CACHE && !process.env.CACHE_OFF) {
    try {
      const read = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (read.keyVersion === KEY_VERSION) data = { ...data, ...read }; // an older key scheme's entries could never match: start empty
    } catch { /* no cache yet, or unreadable: start empty */ }
  }
  const save = () => {
    // CACHE_OFF=1 writes nothing. NO_CACHE=1 starts from an empty cache and RECORDS what the run finds (replacing the old file), but only
    // when it runs every mutant: with ONLY / ONLY_FILE / CHANGED it would wipe the verdicts of the mutants it skipped, so it writes nothing.
    const partial = !!(process.env.ONLY || process.env.ONLY_FILE || process.env.CHANGED);
    if (process.env.CACHE_OFF || (process.env.NO_CACHE && partial)) return;
    // Saving the cache must NEVER stop a verification run. On Windows, renaming over a file that something else briefly holds open
    // (a virus scanner, the indexer) fails with EPERM/EBUSY now and then, so retry a few times, then copy, and if even that fails keep going:
    // the verdicts are only a shortcut, and the run's own results are unaffected.
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data));
      const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(file + '.tmp', file); break; } catch (e) {
          if (attempt >= 6) { fs.copyFileSync(file + '.tmp', file); try { fs.unlinkSync(file + '.tmp'); } catch { /* left behind: harmless */ } break; }
          pause(50 * (attempt + 1));
        }
      }
    } catch (e) {
      if (!save.warned) { save.warned = true; console.error(`WARNING: could not save the mutation cache (${e.code || e.message}); continuing without it.`); }
    }
  };
  return { data, save };
}

// Test order for one mutant: the test with the best chance of killing it PER SECOND OF RUNNING goes first. The chance comes from how
// often a test killed mutants of this file before (the last test to kill THIS mutant counts as a near certainty), the cost from how
// long it ran. A cheap test that kills now and then runs before a slow test that kills slightly more often; with no history the order
// given by the mutant file is kept. Order never changes a verdict, only how soon the kill comes.
const DEFAULT_TEST_MS = 30000;
function orderTests(cache, file, name, tests) {
  const stats = cache.data.testStats || {};
  const fileStats = stats[bn(file)] || {};
  const last = cache.data.killers[name];
  const anywhere = (t) => {
    let ms = 0;
    let n = 0;
    for (const perFile of Object.values(stats)) if (perFile[bn(t)] && perFile[bn(t)].runs) { ms += perFile[bn(t)].ms; n += perFile[bn(t)].runs; }
    return n ? ms / n : null;
  };
  const score = (t) => {
    const x = fileStats[bn(t)];
    const p = bn(t) === last ? 0.9 : x && x.runs ? (x.kills + 1) / (x.runs + 2) : 0.5;
    const ms = Math.max(500, x && x.runs ? x.ms / x.runs : anywhere(t) ?? DEFAULT_TEST_MS);
    return p / ms;
  };
  return tests.map((t, i) => [t, i, score(t)]).sort((x, y) => y[2] - x[2] || x[1] - y[1]).map((x) => x[0]);
}

function recordTimings(cache, file, timings) {
  const perFile = ((cache.data.testStats = cache.data.testStats || {})[bn(file)] = (cache.data.testStats || {})[bn(file)] || {});
  for (const x of timings || []) {
    if (x.error) continue; // a timed-out or crashed test says nothing about cost
    const e = (perFile[bn(x.test)] = perFile[bn(x.test)] || { runs: 0, kills: 0, ms: 0 });
    e.runs++;
    e.ms += x.ms;
    if (x.killed) e.kills++;
  }
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

// Creating or dropping a scratch database takes seconds (3-50 s measured on this machine) and every attempt needs a pristine one. So the
// next pristine database is built in the background while the current attempt runs, from a private template nothing connects to
// (a test connects to its pay_base_N database, and a database cannot be copied while someone is connected to it).
const psqlAsync = (sql) =>
  new Promise((resolve) => {
    const p = spawn(PSQL, ['-h', DB_HOST, '-p', DB_PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-c', sql], { stdio: 'ignore' });
    p.on('error', () => resolve(1));
    p.on('close', (code) => resolve(code));
  });
const dropDbAsync = (name) => psqlAsync(`DROP DATABASE IF EXISTS ${name}`);
const createDbAsync = (name, template) => psqlAsync(`CREATE DATABASE ${name} TEMPLATE ${template}`);

// Only a test that goes through the payment harness (or names PAY_DB_FULL) uses the worker database; the others need none prepared.
const usesFullDbMemo = new Map();
function usesFullDb(testRel) {
  if (!usesFullDbMemo.has(testRel)) {
    usesFullDbMemo.set(testRel, [...closureOf(testRel)].some((rel) => /ensurePayDatabase|PAY_DB_FULL/.test(readText(rel) || '')));
  }
  return usesFullDbMemo.get(testRel);
}

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

function runTests(cwd, tests, idx, fast, dbFull) {
  const env = {
    ...process.env,
    MUTATION_FAILFAST: '1',
    ...(fast ? { MUTATION_SKIP_CONCURRENT: '1' } : {}),
    PAY_DB_BASE: `pay_base_${NS}${idx}`,
    PAY_DB_FULL: dbFull || mutDb(idx),
    ROLE_DB_REQUIRE: '1',
    CORE_DB_NAME: 'clean_new',
    CORE_DB_PORT: DB_PORT,
    CORE_DB_HOST: DB_HOST,
    CORE_DB_REQUIRE: '1',
  };
  return new Promise((resolve) => {
    let stderr = '';
    let i = 0;
    const timings = [];
    const next = () => {
      if (i >= tests.length) return resolve({ killed: false, stderr, timings });
      const t = tests[i++];
      const tStart = Date.now();
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
        const ms = Date.now() - tStart;
        if (code === 0 && !signal && !timedOut) { timings.push({ test: t, ms, killed: false, fast }); return next(); }
        const v = judge(code, signal, timedOut, stderr);
        timings.push({ test: t, ms, killed: !!v.killed, error: !!v.error, fast });
        resolve({ ...v, stderr, test: t, timings });
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
  const { idOf, valid, entryFor, baselineKey: baselineKeyOf } = makeKeyer(testsFor, originals);
  const todo = [];
  let reused = 0;
  for (const item of selected) {
    const id = process.env.NO_CACHE ? null : idOf(item.m);
    const hit = id ? cache.data.entries[id] : null;
    if (valid(hit, item.m)) {
      results[item.index] = { name: item.m[1], status: 'KILLED', detail: hit.detail, cached: true };
      reused++;
    } else {
      todo.push(item);
    }
  }
  if (reused) console.log(`${reused} mutant(s) reused from the cache (unchanged inputs); ${todo.length} to run`);
  if (process.env.PLAN) {
    // what this change would cost, without running anything
    const perFile = {};
    for (const { m } of todo) perFile[m[0]] = (perFile[m[0]] || 0) + 1;
    console.log(`PLAN: ${todo.length} of ${selected.length} mutant(s) would run, ${reused} reused`);
    for (const [file, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${file}`);
    return;
  }
  if (todo.length) {
    // The worker databases have fixed names, so two runners at once would drop and fill each other's databases and every verdict
    // would be debris. Refuse to start beside another runner of this tool.
    const lock = path.join(require('os').tmpdir(), NS ? `bpc-mutation-runner-${NS}.lock` : 'bpc-mutation-runner.lock');
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
  // (and only for the tests the mutants that will run use: a verdict that is reused needs no baseline)
  const baselineTests = [...new Set(todo.flatMap(({ m }) => testsFor(m[0])))];
  const baselineKey = baselineKeyOf(baselineTests);
  if (todo.length && !process.env.SKIP_BASELINE && !process.env.NO_CACHE && cache.data.baseline === baselineKey) {
    console.log('baseline reused (no input changed since it last passed)');
  } else if (todo.length && !process.env.SKIP_BASELINE) {
    dropDb(mutDb(0));
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
  for (let i = 0; i < used; i++) dropDb(mutDb(i));

  // Per worker: a private template (a copy of its pay_base database, made while nothing is connected) and DB_SLOTS (default 3) rotating databases.
  // An attempt takes one that is already built; as soon as it ends that one is dropped and rebuilt in the background.
  const SLOTS = Math.max(2, Number(process.env.DB_SLOTS) || 3);
  const pools = dirs.map((_, i) => ({ tmpl: `${mutDb(i)}_t`, slots: Array.from({ length: SLOTS }, (__, k) => `${mutDb(i)}_${k}`), ready: Array.from({ length: SLOTS }, () => Promise.resolve()), next: 0 }));
  if (todo.some(({ m }) => testsFor(m[0]).some(usesFullDb))) {
    await Promise.all(
      pools.map(async (p, i) => {
        await dropDbAsync(p.tmpl);
        await createDbAsync(p.tmpl, `pay_base_${NS}${i}`);
        p.ready = p.slots.map((slot) => dropDbAsync(slot).then(() => createDbAsync(slot, p.tmpl)));
      }),
    );
  }

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
      const usesDb = testsFor(file).some(usesFullDb);
      let waitMs = 0;
      const pool = pools[idx];
      const acquire = async () => {
        if (!usesDb) return { name: mutDb(idx), release: () => {} };
        const k = pool.next++ % SLOTS;
        const w0 = Date.now();
        await pool.ready[k];
        waitMs += Date.now() - w0;
        return { name: pool.slots[k], release: () => { pool.ready[k] = dropDbAsync(pool.slots[k]).then(() => createDbAsync(pool.slots[k], pool.tmpl)); } };
      };
      let db = await acquire();
      let r = await runTests(dir, ordered, idx, fastPass, db.name);
      db.release();
      // A mutant is only SURVIVED after a complete attempt: the fast first pass skips the slow concurrent section, so retry in full.
      if (fastPass && !r.killed && !r.error) {
        const first = r;
        db = await acquire();
        r = await runTests(dir, ordered, idx, false, db.name);
        db.release();
        r.timings = [...(first.timings || []), ...(r.timings || [])];
      }
      fs.writeFileSync(target, originals[file]);
      recordTimings(cache, file, r.timings);
      if (process.env.PROFILE) console.log(`PROFILE ${Math.round((Date.now() - t0) / 1000)}s dbwait=${waitMs}ms ${name.slice(0, 50)} | ${(r.timings || []).map((x) => `${path.basename(x.test)} ${(x.ms / 1000).toFixed(1)}s${x.killed ? ' KILL' : x.error ? ' ERR' : ''}${x.fast ? ' fast' : ''}`).join(' ; ')}`);
      const first = r.stderr.split('\n').find((l) => /^FAIL/.test(l)) || '';
      if (r.error) {
        // An error is neither a kill nor a survivor and is never cached.
        results[index] = { name, status: 'ERROR', detail: r.error, seconds: Math.round((Date.now() - t0) / 1000) };
        continue;
      }
      results[index] = { name, status: r.killed ? 'KILLED' : 'SURVIVED', detail: first.slice(0, 110), seconds: Math.round((Date.now() - t0) / 1000), file, test: r.test };
      cache.save();
      if (r.killed) {
        const id = idOf(m);
        if (id) cache.data.entries[id] = entryFor(r.test, first.slice(0, 110));
        cache.data.killers[name] = bn(r.test);
        const counts = (cache.data.fileKillers[bn(file)] = cache.data.fileKillers[bn(file)] || {});
        counts[bn(r.test)] = (counts[bn(r.test)] || 0) + 1;
        cache.save();
      }
    }
  };
  await Promise.all(dirs.map((d, i) => worker(d, i)));

  await Promise.all(
    pools.map(async (p) => {
      await Promise.all(p.ready);
      for (const name of [...p.slots, p.tmpl]) await dropDbAsync(name);
    }),
  );
  for (let i = 0; i < used; i++) dropDb(mutDb(i));
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

exports.makeKeyer = makeKeyer;
exports.digests = { closureOf, nd, closureDigest, needsMigrations, migrations };
exports.loadCache = loadCache;

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
