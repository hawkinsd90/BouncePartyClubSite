// Quality gate for the TypeScript / ESLint cleanup. Local development tool only (no application code, no network).
//
//   node scripts/dev/quality-gate.cjs snapshot <out.json>        tsc (tsconfig.app.json) + eslint counts per file and rule
//   node scripts/dev/quality-gate.cjs compare <before.json> [after.json]
//                                                                 no file may gain a tsc error or an ESLint finding (per rule);
//                                                                 prints totals and what was removed. Without after.json a fresh snapshot is taken.
//   node scripts/dev/quality-gate.cjs jsdiff <baseRef> [paths...]
//                                                                 for every changed .ts/.tsx file (git diff <baseRef> + working tree), transpile the
//                                                                 old and the new text with the TypeScript compiler (comments removed) and report
//                                                                 IDENTICAL (type-only change, cannot change behavior) or DIFFERS (printed, needs review)
//
// Exit code is non-zero when `compare` finds a regression.
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);
const norm = (p) => p.split(path.sep).join('/').replace(/\\/g, '/').replace(new RegExp('^' + ROOT.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?', 'i'), '');

function runTsc() {
  const r = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.app.json'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = (r.stdout || '') + (r.stderr || '');
  const byFile = {};
  let total = 0;
  for (const line of out.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/.exec(line);
    if (!m) continue;
    const f = norm(m[1]);
    byFile[f] = byFile[f] || {};
    byFile[f][m[4]] = (byFile[f][m[4]] || 0) + 1;
    total++;
  }
  return { total, byFile };
}

function runEslint() {
  const tmp = path.join(require('os').tmpdir(), `qg-eslint-${process.pid}.json`);
  spawnSync(process.execPath, [path.join(ROOT, 'node_modules/eslint/bin/eslint.js'), '.', '--ignore-pattern', '.SyncDevDataFromProd/**', '-f', 'json', '-o', tmp], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const data = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  const byFile = {};
  let errors = 0, warnings = 0;
  for (const f of data) {
    const k = norm(f.filePath);
    for (const m of f.messages) {
      const rule = m.ruleId || 'directive';
      byFile[k] = byFile[k] || {};
      byFile[k][rule] = (byFile[k][rule] || 0) + 1;
      if (m.severity === 2) errors++; else warnings++;
    }
  }
  return { errors, warnings, total: errors + warnings, byFile };
}

function snapshot() {
  return { takenAt: new Date().toISOString(), head: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(), tsc: runTsc(), eslint: runEslint() };
}

function compare(before, after) {
  let regressions = 0;
  const lines = [];
  for (const [tool, label] of [['tsc', 'TypeScript'], ['eslint', 'ESLint']]) {
    const b = before[tool].byFile, a = after[tool].byFile;
    const files = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const f of files) {
      const keys = new Set([...Object.keys(a[f] || {}), ...Object.keys(b[f] || {})]);
      for (const k of keys) {
        const d = ((a[f] || {})[k] || 0) - ((b[f] || {})[k] || 0);
        if (d > 0) { regressions++; lines.push(`REGRESSION ${label} ${f} ${k} +${d}`); }
      }
    }
  }
  const removedByRule = {};
  const b = before.eslint.byFile, a = after.eslint.byFile;
  for (const f of Object.keys(b)) for (const [k, n] of Object.entries(b[f])) { const d = n - ((a[f] || {})[k] || 0); if (d > 0) removedByRule[k] = (removedByRule[k] || 0) + d; }
  console.log(`TypeScript: ${before.tsc.total} -> ${after.tsc.total}`);
  console.log(`ESLint: ${before.eslint.total} (${before.eslint.errors} errors, ${before.eslint.warnings} warnings) -> ${after.eslint.total} (${after.eslint.errors} errors, ${after.eslint.warnings} warnings)`);
  console.log('ESLint findings removed by rule:', JSON.stringify(removedByRule));
  lines.forEach((l) => console.log(l));
  console.log(regressions === 0 ? 'GATE PASS: no file gained a TypeScript error or an ESLint finding' : `GATE FAIL: ${regressions} regression(s)`);
  return regressions === 0;
}

function transpile(text, file) {
  const out = ts.transpileModule(text, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, removeComments: true, importsNotUsedAsValues: undefined },
  }).outputText;
  return out.replace(/\r\n/g, '\n').trim();
}

function jsdiff(baseRef, only) {
  const names = execSync(`git diff --name-only ${baseRef} --`, { encoding: 'utf8' }).split('\n').filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'));
  const files = names.filter((f) => !only.length || only.some((p) => f.startsWith(p)));
  let identical = 0, differs = 0, added = 0, removed = 0;
  for (const f of files) {
    let before = null;
    try { before = execSync(`git show ${baseRef}:"${f}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }); } catch { /* new file */ }
    const exists = fs.existsSync(f);
    if (before === null) { added++; console.log(`NEW        ${f}`); continue; }
    if (!exists) { removed++; console.log(`DELETED    ${f}`); continue; }
    const a = transpile(before, f), b = transpile(fs.readFileSync(f, 'utf8'), f);
    if (a === b) { identical++; console.log(`IDENTICAL  ${f}`); continue; }
    differs++;
    console.log(`DIFFERS    ${f}`);
    const al = a.split('\n'), bl = b.split('\n');
    // a compact line diff (enough to review; not a full LCS)
    let i = 0, j = 0, shown = 0;
    while ((i < al.length || j < bl.length) && shown < 60) {
      if (al[i] === bl[j]) { i++; j++; continue; }
      const jn = bl.indexOf(al[i], j), in_ = al.indexOf(bl[j], i);
      if (i < al.length && (jn >= 0 && (in_ < 0 || jn - j <= in_ - i))) { while (j < jn) { console.log(`   + ${bl[j++]}`); shown++; } }
      else if (j < bl.length && in_ >= 0) { while (i < in_) { console.log(`   - ${al[i++]}`); shown++; } }
      else { if (i < al.length) { console.log(`   - ${al[i++]}`); shown++; } if (j < bl.length) { console.log(`   + ${bl[j++]}`); shown++; } }
    }
  }
  console.log(`JS equivalence vs ${baseRef}: ${identical} identical, ${differs} differ (review), ${added} new, ${removed} deleted`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'snapshot') {
  const s = snapshot();
  fs.writeFileSync(args[0], JSON.stringify(s));
  console.log(`snapshot ${s.head}: tsc ${s.tsc.total}, eslint ${s.eslint.total} (${s.eslint.errors} errors, ${s.eslint.warnings} warnings) -> ${args[0]}`);
} else if (cmd === 'compare') {
  const before = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const after = args[1] ? JSON.parse(fs.readFileSync(args[1], 'utf8')) : snapshot();
  process.exit(compare(before, after) ? 0 : 1);
} else if (cmd === 'jsdiff') {
  jsdiff(args[0], args.slice(1));
} else {
  console.log('usage: quality-gate.cjs snapshot <out.json> | compare <before.json> [after.json] | jsdiff <baseRef> [paths...]');
  process.exit(2);
}
