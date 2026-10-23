'use strict';
// Decides whether a request to run something "from scratch" (--full, NO_CACHE=1) is actually due.
//
//   const gate = require('./full-gate.cjs');
//   const d = gate.decide('tests', { cacheFile: 'node_modules/.cache/tests/results.json' });
//   if (!d.full) { delete process.env.NO_CACHE; console.log(d.note); }     // run incrementally instead
//   ... a complete from-scratch run, when d.full ...   gate.record('tests');
//
// Why: every stored result is keyed by the exact content it depends on, so a normal run is as correct as a from-scratch one while nothing
// outside those keys has changed. A from-scratch run is the safety net for what the keys cannot see, and that only needs repeating when:
//   - none has been completed yet, or the cache it left behind is gone,
//   - the last one is older than FULL_MAX_HOURS (default 24),
//   - the node version, package-lock.json or the pipeline's own tooling changed since (a changed tool can change what a key means).
// Requests that are not due run incrementally, and say why. FORCE_FULL=1 always runs from scratch.
// Kinds are separate ('tests', 'payment-mutants', 'pricing-mutants', 'static'): a complete from-scratch run of one does not excuse another.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.join(ROOT, 'node_modules', '.cache', 'full');
const TOOLS = ['run-tests', 'test-cache', 'mutation-runner', 'verify', 'scratch-env', 'scratch-server', 'security-scratch', 'queue-lock', 'build-cache', 'full-gate']
  .map((n) => `scripts/dev/${n}.cjs`);

function environment() {
  const h = crypto.createHash('sha1');
  h.update(process.version);
  for (const f of ['package-lock.json', ...TOOLS]) {
    try { h.update(f + '\0').update(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')); } catch { h.update(f + '\0absent'); }
  }
  return h.digest('hex');
}

const stampFile = (kind) => path.join(DIR, kind.replace(/\W/g, '_') + '.json');
const hours = () => Number(process.env.FULL_MAX_HOURS) || 24;

// -> { full: boolean, why: string, note: string }
function decide(kind, { cacheFile } = {}) {
  if (process.env.FORCE_FULL) return { full: true, why: 'FORCE_FULL is set', note: '' };
  let stamp = null;
  try { stamp = JSON.parse(fs.readFileSync(stampFile(kind), 'utf8')); } catch { /* none yet */ }
  const due = (why) => ({ full: true, why, note: '' });
  if (!stamp) return due('no complete from-scratch run of this kind has been recorded yet');
  if (cacheFile && !fs.existsSync(path.join(ROOT, cacheFile))) return due('the stored results it left behind are gone');
  const ageH = (Date.now() - new Date(stamp.at).getTime()) / 3600000;
  if (!(ageH >= 0) || ageH > hours()) return due(`the last one finished ${ageH > 48 ? Math.round(ageH / 24) + ' days' : Math.round(ageH) + ' h'} ago (limit ${hours()} h)`);
  if (stamp.env !== environment()) return due('node, package-lock.json or the pipeline tooling changed since the last one');
  const when = new Date(stamp.at).toLocaleString('sv').slice(0, 16);
  return {
    full: false,
    why: 'not due',
    note: `NOTE: a from-scratch run of ${kind} was requested but is not due: the last complete one finished ${ageH < 1 ? Math.round(ageH * 60) + ' min' : ageH.toFixed(1) + ' h'} ago (${when}) and neither node, package-lock.json nor the pipeline tooling changed since. Running incrementally: every stored result is matched to the exact content it depends on, and the output below says how many were reused. FORCE_FULL=1 runs from scratch anyway; one is due again after ${hours()} h or when the tooling changes.`,
  };
}

function record(kind) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(stampFile(kind), JSON.stringify({ at: new Date().toISOString(), env: environment() }));
  } catch { /* only a shortcut */ }
}

module.exports = { decide, record, environment };
