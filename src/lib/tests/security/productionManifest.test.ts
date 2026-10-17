// Canonical PRODUCTION migration-recovery manifest (audit/production-migration-manifest.csv): structural invariants.
//
//   PURE      committed files only; no database, no network.
//   EVIDENCE  the protected Stage B Production history (skipped, and reported as skipped, when that folder is not present).
//
// Production and Development legitimately record different histories; this test protects Production's own accounting: 277 recorded versions, the rehearsed 58 executable files, the nine history-only omissions,
// 40 baseline files that are never executed, and the three withdrawn cases. Nothing in the manifest is an approval.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/productionManifest.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('../../../../scripts/dev/local-executor/build-allowlist.cjs');

let passed = 0;
let failed = 0;
let skipped = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const rows: any[] = parseCsv(fs.readFileSync(path.join(ROOT, 'audit', 'production-migration-manifest.csv'), 'utf8'));
const byV = new Map<string, any>(rows.map((r) => [r.version, r]));
const e2c: any[] = parseCsv(fs.readFileSync(path.join(ROOT, 'audit', 'evidence', 'e2c-proposed-execution-manifest.csv'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'production-verification-rules.json'), 'utf8'));
const disp = (d: string) => rows.filter((r) => r.proposed_disposition.startsWith(d));
const exec = disp('SQL execution');

ok('387 unique versions: 277 recorded + 58 executable + 9 omissions + 40 baseline + 3 withdrawn', rows.length === 387 && byV.size === 387 && disp('Already recorded').length === 277 && exec.length === 58 && disp('History-only').length === 9
  && disp('Baseline').length === 40 && disp('Withdrawn').length === 3);
ok('executable set equals the rehearsed E2C manifest (58) and the nine omissions equal its history-only rows', e2c.filter((r) => r.proposed_action === 'execute').map((r) => r.version).sort().join() === exec.map((r) => r.version).sort().join()
  && e2c.filter((r) => r.proposed_action !== 'execute').map((r) => r.version).sort().join() === disp('History-only').map((r) => r.version).sort().join());
const active = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((f: string) => f.endsWith('.sql'));
ok('every one of the 384 active files appears exactly once; the 3 archived originals are the withdrawn rows', active.length === 384 && active.every((f: string) => rows.filter((r) => r.filename_or_archived_source === f).length === 1)
  && disp('Withdrawn').every((r) => r.filename_or_archived_source.startsWith('audit/evidence/withdrawn-migrations/') && fs.existsSync(path.join(ROOT, r.filename_or_archived_source))));
const W = ['20260305203528', '20260407203226', '20260407211122'];
ok('Cases 41, 42, 43 are exactly the withdrawn rows and are never in the active directory', disp('Withdrawn').map((r) => r.version).sort().join() === W.join() && W.every((v) => !active.some((f: string) => f.startsWith(v))));
ok('SQL is required only for the 58 executable rows', rows.every((r) => (r.required_sql_execution.startsWith('yes')) === r.proposed_disposition.startsWith('SQL execution')));
ok('baseline files are never executed and nothing is described as approved', disp('Baseline').every((r) => /NEVER execute/.test(r.proposed_disposition) && r.required_sql_execution.startsWith('no')) && rows.every((r) => r.owner_approval === 'not approved'));
ok('the Development alias ledger row does not exist in Production; the contact-inquiry file is an ordinary executable here', !byV.has('20260814002658') && byV.get('20260814120000').proposed_disposition.startsWith('SQL execution'));
const planned = rows.filter((r) => r.plan_order !== '').sort((a, b) => Number(a.plan_order) - Number(b.plan_order));
ok('plan_order is 1..67 over the 58 executables and 9 omissions', planned.length === 67 && planned.every((r, i) => Number(r.plan_order) === i + 1));
ok('every predecessor of an executable is an executable that comes earlier', exec.every((r) => r.required_predecessor_versions.split(';').filter(Boolean).every((p) => byV.get(p) && byV.get(p).proposed_disposition.startsWith('SQL execution') && Number(byV.get(p).plan_order) < Number(r.plan_order))));
ok('the 23 October files are in the plan (22 executable + 1 omission)', rows.filter((r) => r.group === 'october').length === 23 && rows.filter((r) => r.group === 'october' && r.proposed_disposition.startsWith('SQL')).length === 22);
ok('older-than-latest executables carry the open application-method question', exec.filter((r) => r.version < '20260928172217').every((r) => /application method/.test(r.unresolved_differences)));
ok('verification rules cover all 58 executables; rule SQL is a single read-only SELECT', Object.keys(rules).length === 58 && Object.values(rules).every((x: any) => ['pre_state_sql', 'post_state_sql'].every((k) => x[k] === '' || (/^SELECT /.test(x[k]) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|CALL|EXECUTE)\b/i.test(x[k].replace(/'(?:[^']|'')*'/g, "''"))))));
ok('rule status values are DEFINED or SEQUENCE-LEVEL ONLY and DEFINED rules have a post-state or pre-state', Object.values(rules).every((x: any) => (x.status === 'DEFINED' && (x.pre_state_sql || x.post_state_sql)) || x.status === 'SEQUENCE-LEVEL ONLY'));
const hp = 'C:\\Users\\vikki\\migration-evidence\\stage-b-20261016\\prod_catalog_history.json';
if (fs.existsSync(hp)) {
  const h: string[] = JSON.parse(fs.readFileSync(hp, 'utf8')).map((r: any) => r.version);
  ok('evidence: the recorded rows are exactly the 277 captured Production ledger versions', disp('Already recorded').map((r) => r.version).sort().join() === [...h].sort().join() && h.length === 277);
} else {
  skipped++;
  console.log('SKIPPED: EVIDENCE layer - the protected Stage B capture folder is not present (environment limitation, not a pass)');
}
console.log(`production manifest: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed) process.exit(1);
