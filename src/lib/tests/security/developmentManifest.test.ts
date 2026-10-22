// Canonical Development migration manifest (audit/development-migration-manifest.csv): structural invariants.
//
//   PURE      the manifest file only (committed); no database, no network.
//   EVIDENCE  the protected Stage B Development history (skipped, and reported as skipped, when that folder is not present).
//
// These assertions protect the classification rules of Step 2: a version is never "approved" by this file, withdrawn versions are never planned, SQL executes only for the two bucket-limit files and the
// 23 October files, aliases are not double counted, and every bookkeeping item is ordered after the versions it depends on.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/developmentManifest.test.ts

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
const rows: any[] = parseCsv(fs.readFileSync(path.join(ROOT, 'audit', 'development-migration-manifest.csv'), 'utf8'));
const byV = new Map<string, any>(rows.map((r) => [r.version, r]));
const REC = 'Already recorded';
const HIST = 'Evidence-backed history-only reconciliation candidate';
const ATT = 'Qualified owner-attestation candidate';
const XSQL = 'Actual SQL execution required';
const WITH = 'Withheld for the October deployment gate';
const WD = 'Withdrawn';
const UNR = 'Unresolved';
const EXCL = 'Excluded from plan (proposed; owner confirmation pending)';
const S3B = 'Step 3B corrective SQL (new; executes after the October block)';
const count = (c: string) => rows.filter((r) => r.proposed_disposition === c).length;

ok('393 unique versions (388 from Step 2 + the 5 Step 3B corrective migrations)', rows.length === 393 && byV.size === 393);
ok('categories are the nine allowed values', rows.every((r) => [REC, HIST, ATT, XSQL, WITH, WD, UNR, EXCL, S3B].includes(r.proposed_disposition)));
ok('counts: 59 recorded, 225 history-only, 58 attestation, 2 SQL, 40 withheld, 3 withdrawn, 1 excluded, 0 unresolved, 5 Step 3B', count(REC) === 59 && count(HIST) === 225 && count(ATT) === 58 && count(XSQL) === 2 && count(WITH) === 40 && count(WD) === 3 && count(EXCL) === 1 && count(UNR) === 0 && count(S3B) === 5);

// accounting: 389 active files (384 + 5 Step 3B) + 3 archived + 1 ledger-only alias version
const COMPAT_DOC = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'step4', 'compat-migrations.json'), 'utf8'));
const COMPAT_FILES: string[] = COMPAT_DOC.files.map((x: any) => x.filename);
const allSql = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((f: string) => f.endsWith('.sql'));
// the two Step 4A.7 compatibility files are declared, hash-pinned local proposals; they are never manifest rows, so they are excluded from the Step 2 accounting only by name
const ALIAS_FILES: string[] = (COMPAT_DOC.alias_files || []).map((x: any) => x.filename);
const DECLARED: string[] = COMPAT_FILES.concat(ALIAS_FILES);
const HORIZON: string = COMPAT_DOC.historical_horizon;
const sha = (f: string) => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8').split(String.fromCharCode(13)).join('')).digest('hex');
// historical = at or before the horizon (the last Step 3B version) and not a declared, hash-pinned exception; later = ordinary new migrations
const active = allSql.filter((f: string) => !DECLARED.includes(f) && f.slice(0, 14) <= HORIZON);
const later = allSql.filter((f: string) => f.slice(0, 14) > HORIZON);
ok('beyond the Step 2 accounting only the declared, hash-pinned files (two compatibility files and the comment-only alias file) exist at or before the horizon; an unreviewed historical-dated file is rejected here; no manifest row names them', HORIZON === '20261026120400' && allSql.length === active.length + DECLARED.length + later.length && COMPAT_FILES.length === 2 && ALIAS_FILES.length === 1 && COMPAT_DOC.files.concat(COMPAT_DOC.alias_files).every((x: any) => allSql.includes(x.filename) && sha(x.filename) === x.sha256_lf) && rows.every((r) => !DECLARED.includes(r.filename_or_archived_source)) && COMPAT_DOC.files.every((x: any) => !rows.some((r) => r.version === x.version)));
ok('ordinary new migrations (versions after the horizon) are allowed without editing the inventory: well-formed names, unique versions, none is a manifest, withdrawn or denied version', later.every((f: string) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f) && !rows.some((r) => r.version === f.slice(0, 14))) && new Set(allSql.map((f: string) => f.slice(0, 14))).size === allSql.length);
ok('every active migration file appears exactly once in the manifest', active.every((f: string) => rows.filter((r) => r.filename_or_archived_source === f).length === 1) && active.length === 389);
ok('exactly 389 rows point at an active file, 3 at the archive, 1 is ledger-only', rows.filter((r) => active.includes(r.filename_or_archived_source)).length === 389
  && rows.filter((r) => r.filename_or_archived_source.startsWith('audit/evidence/withdrawn-migrations/')).length === 3 && rows.filter((r) => r.filename_or_archived_source.startsWith('ledger-only')).length === 1);

// withdrawn cases and alias
const W = ['20260305203528', '20260407203226', '20260407211122'];
ok('Cases 41, 42, 43 are exactly the withdrawn rows, never planned, never in the active directory', rows.filter((r) => r.proposed_disposition === WD).map((r) => r.version).sort().join() === W.join()
  && W.every((v) => byV.get(v).plan_order === '' && byV.get(v).exact_required_operation.startsWith('none') && !active.some((f: string) => f.startsWith(v))));
ok('alias: file 20260814120000 and ledger version 20260814002658 are both Already recorded and unplanned', ['20260814120000', '20260814002658'].every((v) => byV.get(v).proposed_disposition === REC && byV.get(v).plan_order === ''));

// SQL execution
const sqlRows = rows.filter((r) => r.sql_executes === 'yes');
ok('SQL executes only for the two bucket files, the 23 October files and the 5 Step 3B files', sqlRows.length === 30 && rows.filter((r) => r.proposed_disposition === XSQL).map((r) => r.version).sort().join() === '20260325231044,20260517221038'
  && sqlRows.filter((r) => r.proposed_disposition === S3B).length === 5 && sqlRows.filter((r) => r.proposed_disposition === WITH).every((r) => r.version >= '20261007000000') && sqlRows.filter((r) => r.proposed_disposition === WITH).length === 23);
ok('no bookkeeping row (history-only, attestation, recorded, withdrawn, unresolved) executes SQL', rows.filter((r) => [HIST, ATT, REC, WD, UNR, EXCL].includes(r.proposed_disposition)).every((r) => r.sql_executes === 'no'));
ok('every October file is withheld and in phase P3', rows.filter((r) => r.version >= '20261007000000' && r.version < '20261026000000' && active.includes(r.filename_or_archived_source)).every((r) => r.proposed_disposition === WITH && r.plan_phase.startsWith('P3')));
const demo = byV.get('20251003170350');
ok('the demo-admin migration is never executed and is not planned for execution', demo.sql_executes === 'no' && !/execute/i.test(demo.exact_required_operation.replace(/no SQL runs/i, '')) && demo.step3_dependency.startsWith('yes'));
ok('no version is unresolved; the only exclusion is update_pricing_rules (20260611184401), never executed', rows.filter((r) => r.proposed_disposition === EXCL).map((r) => r.version).join() === '20260611184401' && byV.get('20260611184401').sql_executes === 'no' && byV.get('20260611184401').plan_order === '');
ok('every attestation row requires a per-version owner signature; nothing is marked approved', rows.filter((r) => r.proposed_disposition === ATT).every((r) => r.owner_attestation_needed.startsWith('yes')) && !rows.some((r) => /approved/i.test(r.proposed_disposition)));
ok('history-only is never described as proof of execution', rows.filter((r) => r.proposed_disposition === HIST).every((r) => /not proof of execution/.test(r.history_only_justified)));

// ordering
const plan = rows.filter((r) => r.plan_order !== '').sort((a, b) => Number(a.plan_order) - Number(b.plan_order));
ok('plan_order is 1..N without gaps or duplicates', plan.every((r, i) => Number(r.plan_order) === i + 1) && plan.length === 259);
ok('only phases P1 and P2 carry a plan order', plan.every((r) => /^P[12]/.test(r.plan_phase)) && rows.filter((r) => /^P[12]/.test(r.plan_phase)).length === plan.length);
let predOk = true;
let predExist = true;
for (const r of rows) {
  for (const p of r.required_predecessor_versions.split(';').filter(Boolean)) {
    if (!byV.has(p)) predExist = false;
    if (r.plan_order !== '' && byV.get(p) && byV.get(p).plan_order !== '' && Number(byV.get(p).plan_order) >= Number(r.plan_order)) predOk = false;
    if (r.plan_order !== '' && byV.get(p) && byV.get(p).plan_order === '') predOk = false; // a planned item may not depend on an unplanned (withheld, unresolved) version
  }
}
ok('predecessors exist and precede their dependents in plan order; no planned item depends on a withheld or unresolved version', predExist && predOk);
// no cycles
const seen = new Map<string, number>();
let cyc = false;
const visit = (v: string) => {
  if (seen.get(v) === 2) return;
  if (seen.get(v) === 1) { cyc = true; return; }
  seen.set(v, 1);
  for (const p of byV.get(v).required_predecessor_versions.split(';').filter(Boolean)) visit(p);
  seen.set(v, 2);
};
for (const r of rows) visit(r.version);
ok('predecessor graph has no cycle', !cyc);
ok('items deferred behind October carry a P4 phase', rows.filter((r) => r.required_predecessor_versions.split(';').filter(Boolean).some((p: string) => byV.get(p) && byV.get(p).proposed_disposition === WITH) && [HIST, ATT].includes(r.proposed_disposition)).every((r) => r.plan_phase.startsWith('P4')));

// EVIDENCE layer: the 58 recorded Development versions
const hp = 'C:\\Users\\vikki\\migration-evidence\\stage-b-20261016\\dev_catalog_history.json';
if (fs.existsSync(hp)) {
  const hist: string[] = JSON.parse(fs.readFileSync(hp, 'utf8')).map((r: any) => r.version);
  const recorded = rows.filter((r) => r.development_ledger_status === 'recorded').map((r) => r.version).sort();
  ok('evidence: the manifest rows marked recorded are exactly the 58 captured Development ledger versions', recorded.join() === [...hist].sort().join() && hist.length === 58);
} else {
  skipped++;
  console.log('SKIPPED: EVIDENCE layer - the protected Stage B capture folder is not present (environment limitation, not a pass)');
}

console.log(`development manifest: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed) process.exit(1);
