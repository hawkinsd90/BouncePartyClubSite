// Type-checks the Supabase Edge Functions with Deno, locally, with no hosted access.
//
//   node scripts/dev/deno-check.cjs                 check every function entry point and every _shared module, print a summary
//   node scripts/dev/deno-check.cjs --json out.json also write the per-file error list (for before/after comparison)
//   node scripts/dev/deno-check.cjs <path>...       check only these files / function folders
//
// Why the flag: supabase/functions/deno.json sets "nodeModulesDir": "auto" and the repository has a package.json, so a plain
// `deno check` looks for the `openai` types that @supabase/functions-js's edge-runtime.d.ts references inside the project's node_modules,
// does not find them, and stops ("Could not find a matching package for npm:openai"). `--node-modules-dir=none` makes Deno resolve npm
// packages from its own global cache instead; nothing in the repository or its node_modules is touched. The first run downloads the packages
// Deno needs into that cache.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
process.chdir(ROOT);

function findDeno() {
  const candidates = [process.env.DENO_BIN, 'deno', path.join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages/DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe/deno.exe')].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  throw new Error('deno not found (set DENO_BIN)');
}

const argv = process.argv.slice(2);
const jsonIdx = argv.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null;
const paths = argv.filter((a, i) => !a.startsWith('--') && (jsonIdx < 0 || i !== jsonIdx + 1));

function targets() {
  if (paths.length) {
    return paths.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => f === 'index.ts').map((f) => path.join(p, f)) : [p]));
  }
  const fnRoot = 'supabase/functions';
  const entries = fs.readdirSync(fnRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '_shared' && fs.existsSync(path.join(fnRoot, d.name, 'index.ts'))).map((d) => `${fnRoot}/${d.name}/index.ts`);
  const shared = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) shared.push(p);
    }
  })(`${fnRoot}/_shared`);
  return [...entries, ...shared];
}

const deno = findDeno();
const files = targets();
const result = {};
let total = 0;
for (const f of files) {
  const r = spawnSync(deno, ['check', '--node-modules-dir=none', f], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
  const errs = [];
  for (const m of out.matchAll(/(TS\d+) \[ERROR\]: ([^\n]*)\n([\s\S]*?)at file:\/\/\/[^\n]*?(supabase\/functions\/[^\n:]*):(\d+):(\d+)/g)) errs.push(`${m[4]}:${m[5]} ${m[1]} ${m[2].slice(0, 120)}`);
  if (r.status !== 0 && errs.length === 0) errs.push(`CHECK FAILED: ${out.split('\n').find((l) => /error:/.test(l)) || out.slice(0, 160)}`);
  if (errs.length) { result[f] = errs; total += errs.length; }
  process.stdout.write(errs.length ? `x ${f} (${errs.length})\n` : `. ${f}\n`);
}
console.log(`\nchecked ${files.length} files, ${Object.keys(result).length} with errors, ${total} errors`);
for (const [f, e] of Object.entries(result)) e.forEach((x) => console.log(`  ${x}`));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ files: files.length, total, result }, null, 1));
process.exit(total === 0 ? 0 : 1);
