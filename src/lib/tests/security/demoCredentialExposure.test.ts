// Demo master account credential exposure (Step 3B: SEC-005), code-level controls only.
//
// Migration 20251003170350_015 creates a `master` login and embeds its password. Rotating or disabling that account in Supabase is an
// OWNER action (audit/security/step3b-owner-actions.md); this test never prints, stores or tries the value. It reads the literal from the
// migration at run time and proves that (1) it appears in no other file of the working tree, so the exposure cannot spread, and (2) the
// migration can never be executed by the Development or Production plans.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
const fs = require('fs');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}

const MIGRATION = 'supabase/migrations/20251003170350_015_create_demo_admin_user.sql';
const VERSION = '20251003170350';
const sql: string = fs.readFileSync(MIGRATION, 'utf8');
const start = sql.indexOf("crypt('");
const literal = start >= 0 ? sql.slice(start + 7, sql.indexOf("'", start + 7)) : '';
ok('the credential literal can be located in the migration (so this scan is meaningful)', literal.length >= 6);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.netlify', '__pycache__']);
const hits: string[] = [];
let scanned = 0;
function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p);
    } else if (e.isFile()) {
      let size = 0;
      try { size = fs.statSync(p).size; } catch { continue; }
      if (size > 3_000_000) continue;
      let text = '';
      try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      scanned++;
      if (literal && text.includes(literal) && p !== MIGRATION) hits.push(p);
    }
  }
}
walk('.');
ok(`the credential appears in no file other than its own migration (scanned ${scanned} files; offending files: ${hits.join(', ') || 'none'})`, hits.length === 0);

const deny = JSON.parse(fs.readFileSync('audit/development-execution-deny.json', 'utf8'));
const denied: string[] = JSON.stringify(deny).match(/20\d{12}/g) ?? [];
ok('the demo-admin migration is on the Development execution deny list', denied.includes(VERSION));

const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n') : []);
const rowFor = (p: string) => read(p).filter((l: string) => l.includes(VERSION));
const devExec = rowFor('audit/development-execution-manifest.csv');
ok('the Development execution manifest never schedules the demo-admin migration for SQL execution', devExec.every((l: string) => !/sql-execute/.test(l)));
const prodExec = rowFor('audit/production-migration-manifest.csv');
ok('the Production manifest classifies the demo-admin migration as a baseline file that is never executed', prodExec.length === 1 && prodExec[0].includes('NEVER execute') && !prodExec[0].includes('sql-execute'));
ok('no later migration creates an auth user for the demo account (one later file only upgrades its role)', fs.readdirSync('supabase/migrations').filter((f: string) => f > MIGRATION.split('/').pop()! && /insert into auth\.users/i.test(fs.readFileSync(`supabase/migrations/${f}`, 'utf8')) && fs.readFileSync(`supabase/migrations/${f}`, 'utf8').includes('admin@bouncepartyclub.com')).length === 0);

console.log(`Demo credential exposure tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} demo credential exposure test(s) failed`);
