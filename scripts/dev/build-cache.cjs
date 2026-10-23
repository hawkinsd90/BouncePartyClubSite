'use strict';
// Has anything the production build (vite build) reads changed since it last SUCCEEDED here?
//
//   const bc = require('./build-cache.cjs');
//   const key = bc.key();                 // taken BEFORE the build starts, so an edit during the build is not mistaken for a built one
//   if (bc.unchanged(key)) { /* skip */ } else { /* build, then */ bc.record(key); }
//
// The build reads index.html, src/ (the tests under src/lib/tests are not bundled), public/, the vite/tailwind/postcss/tsconfig files, the
// package files, the production-backend guard that vite.config.ts imports, the .env files vite loads, and VITE_* variables of the
// environment. All of those are in the key, with the node version. The output folder must still exist. verify --full and BUILD_CACHE=0
// always build.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const STAMP = path.join(ROOT, 'node_modules', '.cache', 'build', 'stamp.json');
const FILES = ['index.html', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
  'package.json', 'package-lock.json', 'scripts/dev/production-backend-guard.mjs'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

function walk(rel, out) {
  let entries;
  try { entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel + '/' + e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || r === 'src/lib/tests') continue;
      walk(r, out);
    } else if (!/\.test\.[cm]?[jt]sx?$/.test(e.name)) out.push(r);
  }
}

function key() {
  const files = [...FILES];
  walk('src', files);
  walk('public', files);
  for (const n of fs.readdirSync(ROOT)) if (/^\.env($|\.)/.test(n) && !/SyncDevDataFromProd/.test(n)) files.push(n);
  const h = crypto.createHash('sha1');
  h.update(process.version);
  for (const f of files) {
    let data = null;
    try { data = fs.readFileSync(path.join(ROOT, f)); } catch { /* absent files count as absent */ }
    h.update(f + '\0').update(data ? crypto.createHash('sha1').update(data).digest('hex') : 'absent');
  }
  for (const k of Object.keys(process.env).filter((x) => x.startsWith('VITE_')).sort()) h.update(k + '=' + process.env[k] + '\0');
  return h.digest('hex');
}

function unchanged(k) {
  try {
    const s = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
    return s.key === k && fs.existsSync(path.join(ROOT, 'dist', 'index.html'));
  } catch { return false; }
}

function record(k) {
  try {
    fs.mkdirSync(path.dirname(STAMP), { recursive: true });
    fs.writeFileSync(STAMP, JSON.stringify({ key: k, builtAt: new Date().toISOString() }));
  } catch { /* only a shortcut */ }
}

module.exports = { key, unchanged, record };
