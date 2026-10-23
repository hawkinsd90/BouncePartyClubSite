'use strict';
// Remembers which test files passed, so a run only repeats the ones whose inputs changed.
//
// A test file is a script whose outcome depends on (a) its own text, (b) every repository file it imports or reads, (c) for tests that read
// the migrations folder, the migrations, (d) for tests that use a scratch database, WHICH databases those are (so rebuilding or replacing
// them runs the tests again), and (e) for tests that scan directories, every file of the directories they name. All of that goes into one
// key. A test is skipped only when its last run PASSED under the same key and not longer than TEST_CACHE_HOURS ago (default 24: a test
// that looks at the clock must not stay green forever). A failing test is never skipped; its failure is remembered, together with the key of
// its last pass, so a failure with UNCHANGED inputs can be labelled as flaky or environmental.
//
// Scanning (e): a file that calls readdirSync / walk / glob depends on the directories it names (string literals that are directories of the
// repository), not on the whole tree. A scan that names no directory is treated as whole-tree only when it is in a test or a test helper;
// in a tool script it is ignored (the directory is then a variable we cannot see). `git ls-files` and walk('.') are whole-tree.
//
// It is a shortcut, not a proof: it cannot see a file a test builds a path to at run time, or a change made to a scratch database by hand.
// `verify.cjs --full` / run-tests --full runs everything regardless and then records the results.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const VERSION = 't2';
const CACHE_FILE = path.join(ROOT, 'node_modules', '.cache', 'tests', 'results.json');
const MAX_AGE_MS = (Number(process.env.TEST_CACHE_HOURS) || 24) * 3600 * 1000;

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const lf = (t) => t.replace(/\r\n/g, '\n');
const readText = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
const isFile = (rel) => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch { return false; } };
const isDir = (rel) => { try { return fs.statSync(path.join(ROOT, rel)).isDirectory(); } catch { return false; } };

const EXTS = ['', '.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '/index.ts', '/index.tsx'];
const IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
// any quoted string that looks like a repository file path (a folder, a slash and a known extension)
const PATH_RE = /['"`]([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+\.(?:tsx?|sql|[cm]?js|json|md|csv|py|ya?ml|html|txt))['"`]/g;
const CODE_RE = /\.(tsx?|[cm]?js)$/;
const SCAN_RE = /readdirSync|\bwalk\(|globSync|\bglob\(|\.readdir\(/;
const GIT_RE = /ls-files/;
const SCAN_CALL_RE = /(?:readdirSync|walk|readdir|globSync|glob)\(\s*['"`]([^'"`\n]+)['"`]/g;
const QUOTED_RE = /['"`]([^'"`\n]{1,200})['"`]/g;
// Does this text LIST the migrations folder (so a new migration file changes what it sees)? A test that reads one named migration file has that
// file in its closure already, and a test that only runs against the scratch databases depends on them through the database fingerprint.
const MIGRATIONS_DIR_RE = /['"`]migrations['"`]|supabase[\/\\]migrations[\/\\]?['"`]|supabase[\/\\]migrations[\/\\]?\$\{/;
const DB_RE =/(PAY|CORE|ROLE|HARD|SWEEP|POSTURE|DEVREFRESH)_DB|_DB_NAME|ensurePayDatabase|bpc_replay|psql|PSQL/;
const isTestOrHelper = (rel) => /(^|\/)tests\//.test(rel) || /\.test\.[cm]?[jt]sx?$/.test(rel);

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
    for (const m of text.matchAll(IMPORT_RE)) {
      for (const e of EXTS) {
        const cand = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1] + e));
        if (isFile(cand)) { stack.push(cand); break; }
      }
    }
    for (const m of text.matchAll(PATH_RE)) if (!m[1].startsWith('node_modules/') && isFile(m[1])) stack.push(m[1]);
  }
  closureMemo.set(testRel, seen);
  return seen;
}

const fileDigestMemo = new Map();
const fileDigest = (rel) => {
  if (!fileDigestMemo.has(rel)) fileDigestMemo.set(rel, sha(lf(readText(rel) ?? '')));
  return fileDigestMemo.get(rel);
};

let migrationsMemo;
function migrationsDigest() {
  if (migrationsMemo) return migrationsMemo;
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const h = crypto.createHash('sha256');
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) h.update(n).update(lf(fs.readFileSync(path.join(dir, n), 'utf8')));
  return (migrationsMemo = h.digest('hex'));
}

// every file of the repository that git knows or would add (the same set a directory scan can see, minus ignored files)
let allFilesMemo;
function allFiles() {
  if (!allFilesMemo) {
    allFilesMemo = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\n').filter(Boolean).sort();
  }
  return allFilesMemo;
}
const dirDigestMemo = new Map();
function dirDigest(dir) { // '' or '.' = the whole tree
  if (!dirDigestMemo.has(dir)) {
    const prefix = dir === '' || dir === '.' ? '' : dir.replace(/\/+$/, '') + '/';
    const h = crypto.createHash('sha256');
    for (const f of allFiles()) if (f.startsWith(prefix)) h.update(f).update(isFile(f) ? fileDigest(f) : 'gone');
    dirDigestMemo.set(dir, h.digest('hex'));
  }
  return dirDigestMemo.get(dir);
}

// A test that makes its own folders under the system temp directory and lists THEM is not reading the repository. It counts as such only
// when none of its scan calls mentions a repository root (ROOT, process.cwd(), __dirname ...).
const TMP_RE = /mkdtempSync\(|\btmpdir\(\)/;
const REPO_ROOT_RE = /\bROOT\b|process\.cwd\(\)|__dirname|import\.meta|repoRoot|\bREPO\b/;
function scansOnlyTempFolders(text) {
  if (!TMP_RE.test(text)) return false;
  for (const m of text.matchAll(/(?:readdirSync|\bwalk|\.readdir|globSync|\bglob)\(([^\n]*)/g)) if (REPO_ROOT_RE.test(m[1])) return false;
  return true;
}

// what a test depends on beyond the files it imports or names
const analysisMemo = new Map();
function analysis(testRel) {
  if (analysisMemo.has(testRel)) return analysisMemo.get(testRel);
  const files = [...closureOf(testRel)].sort();
  const texts = files.map((f) => readText(f) ?? '');
  const dirs = new Set();
  let wholeTree = false;
  files.forEach((rel, i) => {
    const text = texts[i];
    if (GIT_RE.test(text)) wholeTree = true;
    if (!SCAN_RE.test(text)) return;
    let found = false;
    for (const m of text.matchAll(SCAN_CALL_RE)) {
      const d = m[1].replace(/^\.\//, '').replace(/\/+$/, '');
      if (d === '.' || d === '') { wholeTree = true; found = true; } else if (isDir(d) && !d.startsWith('node_modules')) { dirs.add(d); found = true; }
    }
    for (const m of text.matchAll(QUOTED_RE)) { // the directory may be held in a constant: any quoted directory in a file that scans counts
      const d = m[1].replace(/^\.\//, '').replace(/\/+$/, '');
      if (d && d !== '.' && !d.startsWith('node_modules') && /^[A-Za-z0-9_.\-/]+$/.test(d) && isDir(d)) { dirs.add(d); found = true; }
    }
    if (!found && isTestOrHelper(rel) && !scansOnlyTempFolders(text)) wholeTree = true; // a test that scans something we cannot see: be safe
  });
  const a = {
    files,
    usesDb: texts.some((t) => DB_RE.test(t)),
    readsMigrations: texts.some((t) => MIGRATIONS_DIR_RE.test(t)),
    wholeTree,
    dirs: [...dirs].sort(),
  };
  analysisMemo.set(testRel, a);
  return a;
}

// identity of the scratch databases a DB-backed test depends on: their object ids change whenever one is rebuilt or the server is replaced
let scratchMemo;
function scratchFingerprint() {
  if (scratchMemo !== undefined) return scratchMemo;
  try {
    const sec = require('./scratch-env.cjs');
    const names = sec.REQUIRED.map((n) => `'${n}'`).join(',');
    const r = spawnSync(
      require('./security-scratch.cjs').psqlPath,
      ['-h', sec.PG.host, '-p', sec.PG.port, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-w', '-Atc', `select datname||':'||oid from pg_database where datname in (${names}) order by 1`],
      { encoding: 'utf8', timeout: 20000 },
    );
    scratchMemo = r.status === 0 ? sha(sec.PG.port + '|' + r.stdout) : 'unavailable';
  } catch { scratchMemo = 'unavailable'; }
  return scratchMemo;
}

const forgetScratchFingerprint = () => { scratchMemo = undefined; };

function keyOf(testRel) {
  const a = analysis(testRel);
  return sha(JSON.stringify([
    VERSION, testRel, a.files.map((f) => [f, fileDigest(f)]), process.version,
    fileDigest('package.json'), isFile('package-lock.json') ? fileDigest('package-lock.json') : null,
    a.usesDb ? scratchFingerprint() : null,
    a.readsMigrations ? migrationsDigest() : null,
    a.wholeTree ? dirDigest('') : null,
    a.dirs.map((d) => [d, dirDigest(d)]),
  ]));
}

// Does this test depend on `relFile`? (the same dependencies keyOf digests; used to pick the tests a change can affect)
function dependsOn(testRel, relFile) {
  const a = analysis(testRel);
  if (relFile === testRel || a.files.includes(relFile)) return true;
  if (relFile === 'package.json' || relFile === 'package-lock.json') return true;
  if (a.readsMigrations && relFile.startsWith('supabase/migrations/')) return true;
  if (a.wholeTree) return true;
  return a.dirs.some((d) => relFile === d || relFile.startsWith(d + '/'));
}

// files that differ from `ref` (default HEAD) in the working tree, plus files git has not seen yet
function changedFiles(ref = 'HEAD') {
  const run = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\n').filter(Boolean);
  return new Set([...run(['diff', '--name-only', ref]), ...run(['ls-files', '--others', '--exclude-standard'])]);
}

function load() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return { version: VERSION, tests: {} }; }
}

// -> { isFresh, prepare, record, recordFailure, flaky, failed, save }
function open() {
  const data = load();
  if (data.version !== VERSION) { data.version = VERSION; data.tests = {}; }
  const read = !process.env.NO_CACHE && !process.env.CACHE_OFF;
  const write = !process.env.CACHE_OFF;
  const pending = new Map();
  const mine = new Map(); // what this run recorded
  return {
    isFresh(testRel) {
      if (!read) return false;
      const e = data.tests[testRel];
      if (!e || !e.ok || Date.now() - e.at > MAX_AGE_MS) return false;
      return e.key === keyOf(testRel);
    },
    recordedMs(testRel) { const e = data.tests[testRel]; return e && e.ok ? e.ms || 0 : 0; },
    // remember the key as it was BEFORE the run started: a test that changes its own inputs must not look fresh afterwards
    prepare(testRel) { if (write) pending.set(testRel, keyOf(testRel)); },
    record(testRel, ms) {
      if (!write || !pending.has(testRel)) return;
      const key = pending.get(testRel);
      data.tests[testRel] = { ok: true, at: Date.now(), ms, key, lastPassKey: key, lastPassAt: Date.now() };
      mine.set(testRel, data.tests[testRel]);
    },
    // a failure is kept (never reused as a pass) with the key of the last pass, so "failed although nothing changed" can be told apart
    recordFailure(testRel, ms) {
      if (!write || !pending.has(testRel)) return;
      const prev = data.tests[testRel] || {};
      data.tests[testRel] = { ok: false, at: Date.now(), ms, key: pending.get(testRel), lastPassKey: prev.lastPassKey || null, lastPassAt: prev.lastPassAt || null };
      mine.set(testRel, data.tests[testRel]);
    },
    // true when this failure happened with exactly the inputs of an earlier PASS
    flaky(testRel) { const e = data.tests[testRel]; return !!(e && e.ok === false && e.lastPassKey && e.lastPassKey === e.key); },
    // the tests whose most recent recorded run failed
    failed() { return Object.entries(data.tests).filter(([, e]) => e && e.ok === false).map(([t]) => t); },
    save() {
      if (!write) return;
      // never let saving the cache stop a run (Windows can refuse a rename while a scanner holds the file)
      try {
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        // Every session on this machine shares this file, so write only what THIS run changed into whatever is on disk NOW: saving the
        // copy loaded at the start would erase the results another run recorded in the meantime.
        const disk = load();
        if (disk.version !== VERSION) { disk.version = VERSION; disk.tests = {}; }
        for (const [k, v] of mine) { if (v === null) delete disk.tests[k]; else disk.tests[k] = v; }
        fs.writeFileSync(CACHE_FILE + '.tmp', JSON.stringify(disk));
        try { fs.renameSync(CACHE_FILE + '.tmp', CACHE_FILE); } catch { fs.copyFileSync(CACHE_FILE + '.tmp', CACHE_FILE); }
      } catch (e) { console.error(`WARNING: could not save the test cache (${e.code || e.message}); continuing.`); }
    },
  };
}

module.exports = { open, keyOf, closureOf, analysis, dependsOn, changedFiles, scratchFingerprint, forgetScratchFingerprint, MIGRATIONS_DIR_RE, DB_RE };
