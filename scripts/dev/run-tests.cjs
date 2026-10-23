// Runs the repository's *.test.ts files (each is a stand-alone script run through jiti).
//
//   node scripts/dev/run-tests.cjs                 every test file (the full suite); files whose inputs did not change since they last PASSED are skipped
//   node scripts/dev/run-tests.cjs payment         only files whose path contains "payment"
//   node scripts/dev/run-tests.cjs payment edge    several filters (any match)
//   node scripts/dev/run-tests.cjs --full          ignore the stored results and run everything (then record the new ones)
//   node scripts/dev/run-tests.cjs --changed       only the tests a change can affect: those that depend on a file git sees as changed since
//                                                  HEAD (or --changed=<ref>), plus the tests whose last run failed
//   node scripts/dev/run-tests.cjs --failed        only the tests whose last recorded run failed (the fix-and-rerun loop)
//   PARALLEL=n node scripts/dev/run-tests.cjs      files that use no database n at a time (default 3; PARALLEL=1 = strictly serial, in file order)
//
// --changed / --failed only NARROW the list; a selected test whose inputs did not change since it last passed is still skipped.
//
// While developing, run a filter. Before a commit, run the full suite once (--full).
//
// SKIPPED TESTS (scripts/dev/test-cache.cjs): a file is skipped only if its last run PASSED, under the same key: its own text, every
// repository file it imports or reads, the migrations (for tests that read them), the scratch databases it uses (so a rebuilt database runs
// it again) and the directories it scans; and not longer than TEST_CACHE_HOURS (24) ago. A failing test is never skipped, and a failure that
// happens with the SAME inputs as an earlier pass is labelled as flaky or environmental. NO_CACHE=1 / --full runs everything and records the
// results; CACHE_OFF=1 neither reads nor writes them (use it only to measure: a run with the cache off helps no later run).
//
// Parallel (PARALLEL=n > 1) runs three kinds of files at once:
//   - files that use no database: n at a time;
//   - files that use the SHARED scratch databases: one at a time. They apply their migration text inside transactions that are rolled back,
//     which takes table locks, so two of them on the same database must not overlap;
//   - the syncDevDataFromProd files: SYNC_PARALLEL (default 2) at a time. Each builds its own devrefresh_<name>_* databases and only reads
//     the shared one (a schema dump), so they cannot interfere with anything.
//
// The scratch-database layers need a local PostgreSQL with the bpc_replay_* databases. Which database each test file uses comes from
// scripts/dev/scratch-env.cjs (the Step 3 security acceptance's mapping); the server is the pipeline's own (scripts/dev/scratch-server.cjs),
// started here when it is not running. A check at the start fails in seconds, with the fix, when the databases are missing.
//
// A few tests need the "shape" databases (bpc_replay_prodpre, _prodshape, _devpre4, _devshape) that are built from protected evidence outside
// Git. When those are absent the tests are reported as SKIPPED (needs the evidence-derived databases), never as passed, and listed by name;
// the Step 3 acceptance (scripts/dev/security-scratch.cjs accept) remains the authority for them.
// Nothing here talks to a Supabase project or to Stripe.
const { spawn, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);

const argv = process.argv.slice(2);
if (argv.includes('--full')) process.env.NO_CACHE = '1';
const changedArg = argv.find((a) => a === '--changed' || a.startsWith('--changed='));
const failedOnly = argv.includes('--failed');
const filters = argv.filter((a) => !a.startsWith('--'));

// A from-scratch request (--full, NO_CACHE=1) over the whole suite only runs from scratch when one is due (full-gate.cjs); otherwise it runs
// incrementally and says why. Runs limited to some files, or with the cache off, are left as asked.
const fullGate = require('./full-gate.cjs');
let recordFull = false;
if (process.env.NO_CACHE && !process.env.CACHE_OFF && !filters.length && !changedArg && !failedOnly) {
  const d = fullGate.decide('tests', { cacheFile: 'node_modules/.cache/tests/results.json' });
  if (d.full) recordFull = true;
  else { delete process.env.NO_CACHE; console.log(d.note); }
}

const scratch = require('./scratch-env.cjs');
const testCache = require('./test-cache.cjs');

const allTests = execSync('git ls-files --cached --others --exclude-standard "*.test.ts"', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)));
let files = allTests;
let selection = '';
if (changedArg || failedOnly) {
  const sel = testCache.open();
  const wanted = new Set(sel.failed().filter((f) => allTests.includes(f))); // the tests whose last run failed always come along
  let byChange = 0;
  if (changedArg) {
    const ref = changedArg.includes('=') ? changedArg.split('=')[1] : 'HEAD';
    const changed = [...testCache.changedFiles(ref)];
    for (const f of allTests) if (!wanted.has(f) && changed.some((c) => testCache.dependsOn(f, c))) { wanted.add(f); byChange++; }
    selection = `--changed=${ref}: ${changed.length} changed file(s) -> ${byChange} test(s) that depend on them + ${wanted.size - byChange} that failed last time`;
  } else {
    selection = `--failed: ${wanted.size} test(s) failed last time`;
  }
  files = allTests.filter((f) => wanted.has(f));
  if (!files.length) { console.log(selection); console.log('nothing to run'); process.exit(0); }
}

const closureText = (f) => [...testCache.closureOf(f)].map((rel) => { try { return fs.readFileSync(rel, 'utf8'); } catch { return ''; } });
const memo = (fn) => { const m = new Map(); return (f) => { if (!m.has(f)) m.set(f, fn(f)); return m.get(f); }; };
// a file that names a scratch database anywhere in what it loads
const usesDatabase = memo((f) => closureText(f).some((t) => /(PAY|CORE|ROLE|HARD|SWEEP|POSTURE|DEVREFRESH)_DB|_DB_NAME|ensurePayDatabase|bpc_replay|psql|PSQL/.test(t)));
// a file that builds and drops its own devrefresh_* databases and only reads the shared one
const selfContainedDb = memo((f) => [...testCache.closureOf(f)].some((rel) => /syncDevDataFromProdScratch\.mjs$/.test(rel)));
// the evidence-derived shape databases, and the test files that really connect to them (other files only MENTION the names in text).
// Add a file here when it starts requiring them.
const SHAPES = ['bpc_replay_prodpre', 'bpc_replay_prodshape', 'bpc_replay_devpre4', 'bpc_replay_devshape'];
const SHAPE_TESTS = /(^|\/)defaultPrivilegeMigration\.test\.ts$/;
const needsShapes = (f) => SHAPE_TESTS.test(f);

// 3 and 2 were measured on this 2-core / 4-thread machine: 487 s for the whole suite against 519 s at 6 and 3, and no file near the time limit
const parallel = Math.max(1, Number(process.env.PARALLEL) || 3);
const syncParallel = Math.max(1, Number(process.env.SYNC_PARALLEL) || 2);

// Tell whoever runs this (people and sessions alike) when the way it was started throws away the speed-ups. See scripts/dev/PIPELINE.md.
if (process.env.CACHE_OFF) console.log('TIP: CACHE_OFF=1 reuses nothing AND records nothing, so it helps no later run. To run everything from scratch use --full (it also records the results).');
if (parallel > 3) console.log(`TIP: PARALLEL=${parallel} measured slower than the default of 3 on this 2-core machine (519 s against 487 s) and makes the heavy files several times slower each. Leave PARALLEL unset.`);

function shapeDatabasesPresent() {
  const sec = require('./security-scratch.cjs');
  return SHAPES.every((d) => {
    const r = spawnSync(sec.psqlPath, ['-h', scratch.PG.host, '-p', scratch.PG.port, '-U', 'postgres', '-d', d, '-X', '-q', '-w', '-Atc', "select to_regclass('public.orders') is not null"], { encoding: 'utf8', timeout: 20000 });
    return r.status === 0 && r.stdout.trim() === 't';
  });
}

// Output kept for a failing file: its first failed assertions
const failures = new Map();

function runOne(f) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn('node', ['node_modules/jiti/bin/jiti.js', f], { env: { ...process.env, ...scratch.envFor(f) } });
    let tail = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => { if (tail.length < 20000) tail += d; });
    // a file that is merely slow because the machine is busy (several sessions share it) must not be killed and reported as a failure
    const timer = setTimeout(() => p.kill(), Number(process.env.TEST_TIMEOUT_MS) || 600000);
    p.on('close', (code) => {
      clearTimeout(timer);
      const ok = code === 0;
      if (!ok) failures.set(f, tail.split('\n').filter((l) => /^FAIL|Error|Cannot find/.test(l)).slice(0, 3).map((l) => l.slice(0, 200)));
      resolve({ f, ok, ms: Date.now() - t0, status: ok ? 'pass' : 'fail' });
    });
  });
}

(async () => {
  const started = Date.now();
  // Stop at once, with the fix, when the scratch server or its databases are gone (otherwise every database test fails confusingly).
  // This also starts the pipeline's own server when it is simply not running, and must come before the cache looks at the databases.
  const needsDb = files.some(usesDatabase);
  if (!process.env.SKIP_PREFLIGHT && needsDb && !scratch.requireScratch('run-tests')) process.exit(2);

  const shapesOk = files.some(needsShapes) ? shapeDatabasesPresent() : true;
  const noShapes = shapesOk ? [] : files.filter(needsShapes);

  let cache = testCache.open();
  let reused = [];
  let todo = [];
  const decide = () => {
    reused = files.filter((f) => !noShapes.includes(f) && cache.isFresh(f));
    todo = files.filter((f) => !noShapes.includes(f) && !reused.includes(f));
    todo.forEach((f) => cache.prepare(f));
  };
  decide();
  // Database-backed files create and drop databases with fixed names, so two runs at once (two sessions share this machine) delete each
  // other's databases and fail for no reason of their own. Runs that have database work to do take turns. After a wait the world is looked at
  // again: the run ahead has usually recorded results this one can now reuse. NO_QUEUE=1 skips the queue.
  if (!process.env.NO_QUEUE && todo.some(usesDatabase)) {
    if (await require('./queue-lock.cjs').acquire('db-tests', 'another run of the database tests')) {
      console.log('it is this run\'s turn; reading the results and the files again');
      cache = testCache.open();
      decide();
    }
  }
  const done = reused.map((f) => ({ f, ok: true, ms: 0, status: 'reused' }));

  const finish = (r) => {
    done.push(r);
    if (r.ok) cache.record(r.f, r.ms); else cache.recordFailure(r.f, r.ms);
    cache.save();
  };

  if (parallel === 1) {
    // strictly serial, in the order of the file list
    for (const f of todo) finish(await runOne(f));
  } else {
    const independent = todo.filter(selfContainedDb);
    const shared = todo.filter((f) => !selfContainedDb(f) && usesDatabase(f));
    const plain = todo.filter((f) => !usesDatabase(f));
    const queue = (list, width) => {
      let i = 0;
      return Array.from({ length: Math.min(width, Math.max(1, list.length)) }, async () => {
        while (i < list.length) finish(await runOne(list[i++]));
      });
    };
    await Promise.all([...queue(plain, parallel), ...queue(shared, 1), ...queue(independent, syncParallel)]);
  }

  const fails = done.filter((d) => !d.ok);
  const ran = done.filter((d) => d.status !== 'reused');
  if (selection) console.log(selection);
  console.log(`files ${files.length} pass ${done.length - fails.length} fail ${fails.length}${noShapes.length ? ` skipped ${noShapes.length}` : ''}`);
  const savedMs = reused.reduce((sum, f) => sum + cache.recordedMs(f), 0);
  console.log(`reused from the cache ${reused.length}${savedMs ? ` (about ${Math.round(savedMs / 1000)} s of recorded run time not spent)` : ''}, ran ${ran.length}`);
  if (process.env.CACHE_OFF) console.log('NOTE: the result cache was OFF (CACHE_OFF): nothing was reused and nothing was recorded, so this run helps no later run. Use --full to run everything AND record it.');
  if (noShapes.length) {
    console.log(`SKIPPED (needs the evidence-derived databases ${SHAPES.join(', ')}; not built here, so these did NOT run):`);
    noShapes.forEach((f) => console.log('     ' + f));
  }
  fails.forEach((d) => {
    console.log('FAIL', d.f);
    (failures.get(d.f) || []).forEach((l) => console.log('     ' + l));
    if (cache.flaky(d.f)) console.log('     ^ failed with the SAME inputs as an earlier pass: flaky or environmental (load, a collision with another run, the scratch databases), not a code change');
  });
  const slow = ran.slice().sort((a, b) => b.ms - a.ms);
  console.log('slowest:', slow.slice(0, 10).map((d) => `${path.basename(d.f)} ${Math.round(d.ms / 1000)}s`).join(', '));
  console.log(`elapsed ${Math.round((Date.now() - started) / 1000)}s`);
  // every file's time and outcome, for finding what got slow
  try {
    const out = path.join(ROOT, 'node_modules', '.cache', 'tests', 'last-run.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), elapsedMs: Date.now() - started, files: done.map((d) => ({ file: d.f, status: d.status, ms: d.ms })).concat(noShapes.map((f) => ({ file: f, status: 'skipped-needs-shapes', ms: 0 }))).sort((a, b) => b.ms - a.ms) }, null, 1));
  } catch { /* the report is a convenience */ }
  if (recordFull) fullGate.record('tests');
  process.exit(fails.length ? 1 : 0);
})();
