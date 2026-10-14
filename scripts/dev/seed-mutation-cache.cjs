// Fills the mutation result cache from the LOG of an earlier, complete, clean run, so the first incremental run after the cache scheme
// (or the cache) was lost does not have to redo everything.
//
//   node scripts/dev/seed-mutation-cache.cjs <mutants file> <log file> --since <local date-time, e.g. 2026-10-14T08:05>
//
// <since> is when that run STARTED. A log only says what the code was doing when it ran, so this refuses unless
//   - the log ends with a clean summary: no survivors, no errors, repository files untouched, and a baseline that passed;
//   - every mutant of the file appears in the log exactly once, as KILLED;
//   - no file under src, supabase or scripts (the files a run sees) was modified after <since>, so the tree is the one the run judged.
// It is a shortcut, not a proof: run with NO_CACHE=1 before a commit to rebuild every verdict from scratch.
const fs = require('fs');
const path = require('path');
const runner = require('./mutation-runner.cjs');

const ROOT = path.resolve(__dirname, '../..');
const [spec, logFile] = process.argv.slice(2);
const sinceArg = process.argv.indexOf('--since');
if (!spec || !logFile || sinceArg < 0 || !process.argv[sinceArg + 1]) {
  console.error('usage: node scripts/dev/seed-mutation-cache.cjs <mutants file> <log file> --since <local date-time>');
  process.exit(2);
}
const since = new Date(process.argv[sinceArg + 1]);
if (Number.isNaN(since.getTime())) { console.error('--since is not a date-time'); process.exit(2); }

const refuse = (why) => { console.error('REFUSED: ' + why); process.exit(1); };
const log = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);

const summary = log.find((l) => /^mutants: \d+ /.test(l));
if (!summary || !/survivors: 0 errors: 0 \| repository files untouched: true/.test(summary)) refuse(`the log does not end in a clean summary (${summary || 'no summary line'})`);
if (!log.some((l) => /^baseline (ok|reused)/.test(l))) refuse('the log has no passed baseline');
if (log.some((l) => /^BASELINE FAILS/.test(l))) refuse('the baseline failed in that run');

const mod = require(path.resolve(spec));
// A run prints one line per mutant, in the order of the mutants file, so the log is matched POSITION BY POSITION (names alone may repeat).
const lines = log.map((l) => l.match(/^(KILLED|SURVIVED|ERROR|ANCHOR ERROR)\s+(.*?)(?:\s{2}\[(.*)\])?$/)).filter(Boolean);
if (lines.length !== mod.M.length) refuse(`the log has ${lines.length} mutant lines but the file has ${mod.M.length} mutants (a filtered run cannot seed a full cache)`);
lines.forEach((l, i) => {
  if (l[1] !== 'KILLED') refuse(`mutant ${i + 1} (${mod.M[i][1]}) is ${l[1]} in the log`);
  if (l[2] !== mod.M[i][1]) refuse(`the log and the mutants file disagree at position ${i + 1}: "${l[2]}" against "${mod.M[i][1]}"`);
});
const killed = lines.map((l) => l[3] || '');

// the tree must be what the run saw (the tooling itself only decides HOW a verdict is stored and reused, never what a mutant does)
const TOOLING = new Set(['scripts/dev/mutation-runner.cjs', 'scripts/dev/seed-mutation-cache.cjs', 'scripts/dev/verify.cjs']);
const newer = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel);
    else if (!TOOLING.has(rel) && fs.statSync(path.join(ROOT, rel)).mtime > since) newer.push(rel);
  }
};
for (const d of ['src', 'supabase', 'scripts']) walk(d);
if (newer.length) refuse(`${newer.length} file(s) were modified after ${since.toISOString()}, for example ${newer.slice(0, 3).join(', ')}`);

const originals = {};
for (const f of new Set(mod.M.map((m) => m[0]))) originals[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
const testsFor = (file) => (typeof mod.tests === 'function' ? mod.tests(file) : mod.tests);
const { idOf, setDigest, valid } = runner.makeKeyer(testsFor, originals);
const cache = runner.loadCache(spec);
let seeded = 0;
let kept = 0;
for (const [i, m] of mod.M.entries()) {
  const id = idOf(m);
  if (!id) refuse(`an anchor of "${m[1]}" no longer matches`);
  // a verdict that is already recorded and still valid (it knows its killer) is more exact than anything a log can give: keep it
  if (valid(cache.data.entries[id], m)) { kept++; continue; }
  // the log does not say which test killed it, so the verdict is tied to the whole set of covering tests until the mutant is run again
  cache.data.entries[id] = { status: 'KILLED', detail: killed[i], setDigest: setDigest(m), seeded: true };
  seeded++;
}
cache.save();
console.log(`kept ${kept} exact verdict(s) already in the cache; seeded ${seeded} KILLED verdict(s) from ${path.basename(logFile)} (run started ${since.toISOString()}).`);
