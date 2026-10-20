// Step 3B migration plan: how the five corrective migrations sit next to the Step 2 recovery plan, and that their read-only
// verification rules are true or false exactly when they should be on every database shape.
//
//   STATIC     manifests (Development 393 rows, Production 392 rows), ordering, deny list, no edit to an applied migration (always runs).
//   EXECUTED   audit/security/step3b-verification-rules.json run as single read-only SELECTs against local scratch databases:
//                 repository chain      bpc_replay_full25 (before) / bpc_replay_full (after)           built by scripts/dev/security-scratch.cjs build
//                 Production-shaped     bpc_replay_prodpre / bpc_replay_prodshape                       built by audit/evidence/tools/step3b_shapes.py prod
//                 Development-shaped    bpc_replay_devpre4 / bpc_replay_devshape                        built by audit/evidence/tools/step3b_shapes.py dev
//              A shape that is not present is reported as SKIPPED (the Production and Development shapes need the protected Stage B captures,
//              which are outside Git); STEP3B_SHAPES_REQUIRE=1 makes a missing shape a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/step3bMigrationPlan.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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
const VERSIONS = ['20261026120000', '20261026120100', '20261026120200', '20261026120300', '20261026120400'];
const LAST_OCTOBER = '20261025120000';
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'security', 'step3b-verification-rules.json'), 'utf8'));
const migrations: string[] = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((f: string) => f.endsWith('.sql')).sort();

// ---------------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------------
const COMPAT_DOC_3B = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'step4', 'compat-migrations.json'), 'utf8'));
const HORIZON_3B: string = COMPAT_DOC_3B.historical_horizon;
const historicalMigs = migrations.filter((f) => f.slice(0, 14) <= HORIZON_3B);
ok('exactly the five Step 3B migrations follow the last October file (ordinary migrations after the horizon are not historical and are checked separately)', HORIZON_3B === VERSIONS[VERSIONS.length - 1] && historicalMigs.slice(historicalMigs.findIndex((f) => f.startsWith(LAST_OCTOBER)) + 1).map((f) => f.slice(0, 14)).join() === VERSIONS.join());
ok('ordinary new migrations after the horizon are strictly later than the last Step 3B version and keep the repository naming convention', migrations.filter((f) => f.slice(0, 14) > HORIZON_3B).every((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f) && f.slice(0, 14) > VERSIONS[VERSIONS.length - 1]));
ok('they are named with the repository convention and are not doubly suffixed', migrations.filter((f) => f >= '20261026').every((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)));
ok('rules exist for exactly those five versions', Object.keys(rules).filter((k) => !k.startsWith('_')).join() === VERSIONS.join());
const sqlRules: Array<[string, string, string]> = [];
for (const v of VERSIONS) {
  for (const k of ['pre_work_remaining', 'post_effect_present']) {
    const text: string = rules[v][k];
    sqlRules.push([v, k, text]);
    ok(`rule ${v}.${k} is one read-only SELECT returning a boolean`, /^SELECT /.test(text) && !/;/.test(text) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|CALL|DO)\b/i.test(text.replace(/'[^']*'/g, '')));
  }
}

// designated for the coordinated Step 4 rollout, never for ad hoc manual execution
for (const v of VERSIONS) {
  const f = migrations.find((m) => m.startsWith(v))!;
  const head = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8').split('*/')[0];
  ok(`header of ${v} names the coordinated Step 4 rollout, the approved mechanism and the verification rules, and never says to apply it manually`, /coordinated Step 4/.test(head) && /Step 4/.test(head) && /step3b-verification-rules\.json/.test(head) && !/apply manually|NOT APPLIED BY THIS CHANGE/i.test(head));
}
// The Step 2 recovery plan is compared with the ACCEPTED STEP 2 CHECKPOINT, not with HEAD, so these checks give the same answer before and after the
// Step 3 commits are made. The checkpoint is the commit the Step 2 hand-off names (0658fdd); at that commit the manifests, execution package, deny
// list, verification rules, migrations, scripts and tests are identical to the ones later commits carried forward (later commits only pruned evidence).
const STEP2_CHECKPOINT = '0658fdd08ecdb4d3939e5625ec05eaf6b0dcdd12';
const NL = String.fromCharCode(10);
const git = (...args: string[]) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const checkpointPresent = git('cat-file', '-e', `${STEP2_CHECKPOINT}^{commit}`).status === 0;
ok('the accepted Step 2 checkpoint commit is present in this repository (a shallow clone cannot run the acceptance)', checkpointPresent);
{
  const atCheckpoint = checkpointPresent ? git('ls-tree', '--name-only', STEP2_CHECKPOINT, 'supabase/migrations/').stdout.split(NL).filter(Boolean).map((f: string) => f.replace('supabase/migrations/', '')) : [];
  const changedFiles = checkpointPresent ? git('diff', '--name-status', STEP2_CHECKPOINT, '--', 'supabase/migrations').stdout.split(NL).filter(Boolean).filter((l: string) => !l.startsWith('A')) : ['unknown'];
  ok(`no migration present at the Step 2 checkpoint was modified, renamed or deleted (${changedFiles.join('; ') || 'none'})`, changedFiles.length === 0);
  // Step 4A.7: two declared, hash-pinned compatibility proposals (audit/step4/compat-migrations.json) are the only other additions
  const compatDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'step4', 'compat-migrations.json'), 'utf8'));
  const compatNames: string[] = compatDoc.files.map((x: any) => x.filename);
  const aliasNames: string[] = (compatDoc.alias_files || []).map((x: any) => x.filename);
  const declaredNames: string[] = compatNames.concat(aliasNames);
  const added = migrations.filter((f) => !atCheckpoint.includes(f) && !declaredNames.includes(f) && f.slice(0, 14) <= HORIZON_3B).map((f) => f.slice(0, 14));
  ok(`exactly the five Step 3B files are new relative to the Step 2 checkpoint (${added.join(', ')})`, atCheckpoint.length === 384 && added.join() === VERSIONS.join());
  ok('the only other historical-dated additions are the declared files (two compatibility files and the comment-only alias file), each unchanged from its pinned hash and absent from the checkpoint', compatNames.length === 2 && aliasNames.length === 1 && declaredNames.every((f) => migrations.includes(f) && !atCheckpoint.includes(f)) && compatDoc.files.concat(compatDoc.alias_files).every((x: any) => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', x.filename), 'utf8').split(String.fromCharCode(13)).join('')).digest('hex') === x.sha256_lf));
}

const dev: any[] = parseCsv(fs.readFileSync(path.join(ROOT, 'audit', 'development-migration-manifest.csv'), 'utf8'));
const prod: any[] = parseCsv(fs.readFileSync(path.join(ROOT, 'audit', 'production-migration-manifest.csv'), 'utf8'));
const dByV = new Map<string, any>(dev.map((r) => [r.version, r]));
const pByV = new Map<string, any>(prod.map((r) => [r.version, r]));
ok('Development manifest: 393 rows, the five Step 3B rows are phase P5, run SQL, are unplanned in the bookkeeping order and need owner approval of the SQL',
  dev.length === 393 && VERSIONS.every((v) => { const r = dByV.get(v); return r && r.plan_phase.startsWith('P5') && r.sql_executes === 'yes' && r.plan_order === '' && /owner approval/.test(r.owner_attestation_needed) && r.history_only_justified === 'no'; }));
ok('Development manifest: the Step 3B rows chain onto the last October file in version order',
  VERSIONS.every((v, i) => dByV.get(v).required_predecessor_versions === (i === 0 ? LAST_OCTOBER : VERSIONS[i - 1])) && dByV.get(LAST_OCTOBER).proposed_disposition === 'Withheld for the October deployment gate');
ok('Production manifest: 392 rows, the five Step 3B rows are SQL, unplanned in the 67-item order and chained after the last October file',
  prod.length === 392 && VERSIONS.every((v, i) => { const r = pByV.get(v); return r && r.group === 'step3b' && r.required_sql_execution.startsWith('yes') && r.plan_order === '' && r.required_predecessor_versions === (i === 0 ? LAST_OCTOBER : VERSIONS[i - 1]) && r.owner_approval === 'not approved'; }));
ok('the Step 3B rows never appear in the 58-item executor allowlist input (plan_order stays 1..67)', prod.filter((r) => r.plan_order !== '').length === 67 && !VERSIONS.some((v) => pByV.get(v).plan_order !== ''));
const deny = JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'development-execution-deny.json'), 'utf8')));
ok('the Step 2 deny list is unchanged in kind: still names the demo-admin migration and update_pricing_rules, and no Step 3B version', deny.includes('20251003170350') && deny.includes('20260611184401') && !VERSIONS.some((v) => deny.includes(v)));
ok('the Development execution manifest (259 bookkeeping and bucket operations) does not contain any Step 3B version', !VERSIONS.some((v) => fs.readFileSync(path.join(ROOT, 'audit', 'development-execution-manifest.csv'), 'utf8').includes(v)));

// ---- Step 2 compatibility: nothing that existed changed ----
{
  const versions = migrations.map((f) => f.slice(0, 14));
  ok('every migration version is unique and the file list is in version order', new Set(versions).size === versions.length && versions.every((v, i) => i === 0 || versions[i - 1] < v));
  const W = ['20260305203528', '20260407203226', '20260407211122'];
  ok('the three withdrawn originals are not in the active directory and no Step 3B version reuses one', W.every((v) => !versions.includes(v)) && VERSIONS.every((v) => !W.includes(v)));
  const atCheckpoint = (file: string): string | null => {
    const r = git('show', `${STEP2_CHECKPOINT}:${file}`);
    return r.status === 0 ? r.stdout : null;
  };
  for (const [file, cur] of [['audit/development-migration-manifest.csv', dev], ['audit/production-migration-manifest.csv', prod]] as Array<[string, any[]]>) {
    const old = atCheckpoint(file);
    ok(`${file} exists at the Step 2 checkpoint`, old !== null);
    if (old === null) continue;
    const before: any[] = parseCsv(old);
    const byKey = new Map<string, any>(cur.map((r) => [r.version, r]));
    const changed = before.filter((r) => { const c = byKey.get(r.version); return !c || Object.keys(r).some((k) => c[k] !== r[k]); });
    ok(`${file}: all ${before.length} rows of the Step 2 checkpoint are identical in every column (no recovery classification, order or predecessor changed; only the five Step 3B rows were added)`, changed.length === 0 && cur.length === before.length + 5);
  }
  for (const file of ['audit/development-execution-deny.json', 'audit/development-execution-manifest.csv', 'audit/development-verification-rules.json', 'audit/production-verification-rules.json', 'audit/development-execution-batches.json', 'audit/evidence/e2c-proposed-execution-manifest.csv']) {
    const d = git('diff', '--quiet', STEP2_CHECKPOINT, '--', file);
    ok(`${file} is unchanged from the Step 2 checkpoint (deny list, execution package, verification rules, executor input untouched)`, d.status === 0);
  }
  ok('the default-privilege migration remains an explicit Step 4 preflight gate in the rules and in the deployment dependencies', /STEP 4 GATE/.test(rules['20261026120400'].hosted_note) && /Default-privilege gate/.test(fs.readFileSync(path.join(ROOT, 'audit', 'security', 'step3-step4-deployment-dependencies.md'), 'utf8')));
}

// ---------------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------------
const port = process.env.CORE_DB_PORT || '54329';
const host = process.env.CORE_DB_HOST || '127.0.0.1';
const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
function run(db: string, sql: string): string | null {
  for (const c of candidates) {
    const r = spawnSync(c, ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-At', '-X', '-q', '-w', '-v', 'ON_ERROR_STOP=1'], { input: `BEGIN READ ONLY;\n${sql};\nROLLBACK;\n`, encoding: 'utf8', timeout: 30000 });
    if (r.status === 0) return r.stdout.split('\n')[0].trim();
    if (/does not exist/.test(r.stderr ?? '')) return null;
  }
  return null;
}
const must = !!process.env.STEP3B_SHAPES_REQUIRE;
// expectation per shape and version: [pre_work_remaining, post_effect_present] on the BEFORE shape and the AFTER shape
type Expect = { before: Record<string, 't' | 'f'>; after: Record<string, 't' | 'f'> };
const SHAPES: Array<{ name: string; before: string; after: string; expect: Expect }> = [
  { name: 'repository chain (stub with hosted-style default privileges)', before: 'bpc_replay_full25', after: 'bpc_replay_full',
    expect: { before: { '20261026120000': 't', '20261026120100': 'f', '20261026120200': 't', '20261026120300': 't', '20261026120400': 'f' }, after: { '20261026120000': 't', '20261026120100': 't', '20261026120200': 't', '20261026120300': 't', '20261026120400': 't' } } },
  { name: 'Production-shaped (Production schema snapshot + the 67 upgrade files)', before: 'bpc_replay_prodpre', after: 'bpc_replay_prodshape',
    expect: { before: { '20261026120000': 't', '20261026120100': 'f', '20261026120200': 't', '20261026120300': 't', '20261026120400': 't' }, after: { '20261026120000': 't', '20261026120100': 't', '20261026120200': 't', '20261026120300': 't', '20261026120400': 't' } } },
  { name: 'Development-shaped (Development schema snapshot + bucket files + October files + containment end-state)', before: 'bpc_replay_devpre4', after: 'bpc_replay_devshape',
    expect: { before: { '20261026120000': 't', '20261026120100': 't', '20261026120200': 't', '20261026120300': 't', '20261026120400': 'f' }, after: { '20261026120000': 't', '20261026120100': 't', '20261026120200': 't', '20261026120300': 't', '20261026120400': 't' } } },
];
for (const shape of SHAPES) {
  const probe = run(shape.after, 'SELECT 1');
  const probeB = run(shape.before, 'SELECT 1');
  if (probe === null || probeB === null) {
    if (must) ok(`executed: the ${shape.name} databases are available (STEP3B_SHAPES_REQUIRE is set)`, false);
    else { skipped++; console.log(`SKIPPED: ${shape.name}: databases ${shape.before} / ${shape.after} not present (see the header of this file)`); }
    continue;
  }
  for (const v of VERSIONS) {
    const pre = run(shape.before, rules[v].pre_work_remaining);
    const preAfter = run(shape.after, rules[v].pre_work_remaining);
    const postBefore = run(shape.before, rules[v].post_effect_present);
    const post = run(shape.after, rules[v].post_effect_present);
    ok(`executed [${shape.name}] ${v}: before the file, work remains = ${shape.expect.before[v]} (got ${pre})`, pre === shape.expect.before[v]);
    ok(`executed [${shape.name}] ${v}: after the file, nothing remains to do (got ${preAfter})`, preAfter === 'f');
    ok(`executed [${shape.name}] ${v}: after the file, its effect is present (got ${post})`, post === shape.expect.after[v]);
    if (shape.expect.before[v] === 't') ok(`executed [${shape.name}] ${v}: before the file, its effect is NOT yet present (got ${postBefore})`, postBefore === 'f');
  }
}

console.log(`step 3B migration plan: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) throw new Error(`${failed} step 3B migration plan test(s) failed`);
