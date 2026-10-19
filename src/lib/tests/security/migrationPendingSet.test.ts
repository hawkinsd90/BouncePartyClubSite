// Pending-set calculator (scripts/dev/migration-pending-set.cjs): pending = local repository versions - recorded history versions (exact).
//
//   PURE         synthetic inputs only: no file, no database, no network.
//   STATIC       the source is checked to contain no network / database / process-spawning capability.
//   EVIDENCE     the real working tree plus the captured Stage B histories (skipped, and reported as skipped, when the protected
//                capture folder is not present on this machine). Expected counts are verified here, not hard-coded into the tool.
//
// A pending version is NOT proof that the SQL effects are missing from a schema; nothing here claims schema equivalence.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/migrationPendingSet.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit(code: number): never };
const fs = require('fs');
const calc = require('../../../../scripts/dev/migration-pending-set.cjs');
const replay = require('../../../../scripts/dev/migration-replay.cjs');

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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const f = (v: string, n = 'x') => `${v}_${n}.sql`;

// 1. normal calculation
const names = [f('20260101000001'), f('20260101000002'), f('20260101000003'), f('20260101000004')];
let local = calc.collectLocalVersions(names);
let rec = calc.collectRecordedVersions([{ version: '20260101000001' }, '20260101000003']);
ok('normal: no findings', local.findings.length === 0 && rec.findings.length === 0);
let r = calc.computePending(local.versions, rec.versions);
ok('normal: pending = local - recorded', same(r.pending, ['20260101000002', '20260101000004']) && r.recordedOnly.length === 0);

// 2. empty recorded history: everything is pending
r = calc.computePending(local.versions, calc.collectRecordedVersions([]).versions);
ok('empty history: every local version is pending', same(r.pending, local.versions));

// 3. fully reconciled history
r = calc.computePending(local.versions, local.versions);
ok('reconciled: nothing pending', r.pending.length === 0);

// 3b. recorded version without a local file is reported, never silently dropped
r = calc.computePending(local.versions, [...local.versions, '20260101000009']);
ok('recorded-only versions are listed', same(r.recordedOnly, ['20260101000009']) && r.pending.length === 0);

// 4. duplicate local versions: finding, not a silent choice
local = calc.collectLocalVersions([f('20260101000001', 'a'), f('20260101000001', 'b'), f('20260101000002')]);
ok('duplicate local version is a finding naming both files', local.findings.some((x: any) => x.kind === 'duplicate-local-version' && x.version === '20260101000001' && x.files.length === 2));

// 5. duplicate recorded versions
rec = calc.collectRecordedVersions([{ version: '20260101000001' }, { version: '20260101000001' }]);
ok('duplicate recorded version is a finding', rec.findings.some((x: any) => x.kind === 'duplicate-recorded-version' && x.version === '20260101000001' && x.rows === 2));

// 6. malformed filenames and version values
const badNames = ['notes.md', '2026010100000_short.sql', '202601010000011_long.sql', '20261301000000_bad_month.sql', '20260101000001.sql', '20260101000001_nodot', '20260132000000_bad_day.sql', '20260101256000_bad_hour.sql', '_x.sql', ''];
local = calc.collectLocalVersions(badNames);
ok('every malformed filename is a finding (none silently ignored)', local.findings.length === badNames.length && local.findings.every((x: any) => x.kind === 'malformed-local-filename'));
ok('malformed names yield no versions', local.versions.length === 0);
rec = calc.collectRecordedVersions(['abc', '2026', null, {}, { version: 20260101000001 }, { version: '20261301000000' }, { version: '20260101000001 ' }]);
ok('malformed recorded values are findings', rec.findings.length === 7 && rec.findings.every((x: any) => x.kind === 'malformed-recorded-version') && rec.versions.length === 0);
ok('recorded history that is not an array fails safely', calc.collectRecordedVersions({}).findings[0].kind === 'recorded-history-not-an-array');
local = calc.collectLocalVersions(['20260816221636_a_b.sql.sql']);
ok('a doubled .sql.sql extension is a warning with an exact version, not a malformed name', local.findings.length === 0 && same(local.versions, ['20260816221636']) && local.warnings[0].kind === 'double-sql-extension');

// 7. aliases are annotations: they never remove a version from the pending set and contradictions are findings
local = calc.collectLocalVersions([f('20260305203528'), f('20260305205811'), f('20260814120000')]);
const aliasDoc = {
  aliases: [
    { env: 'prod', local_version: '20260305203528', recorded_version: '20260305205811', kind: 'case-41', note: 'n' },
    { env: 'dev', local_version: '20260814120000', recorded_version: '20260814002658', kind: 'dev', note: 'n' },
  ],
  withdrawn: [{ version: '20260407211122', note: 'case 43' }],
};
let env = calc.calculateEnvironment('prod', local.versions, [{ version: '20260305205811' }], aliasDoc, null);
ok('alias: still pending (not removed)', env.pending_versions.includes('20260305203528') && env.pending_count === 2);
ok('alias: annotated with its related recorded version', env.alias_annotations.length === 1 && env.alias_annotations[0].related_recorded_version === '20260305205811' && /still listed as pending/.test(env.alias_annotations[0].effect_on_pending_set));
ok('alias: no findings when consistent', env.findings.length === 0);
env = calc.calculateEnvironment('dev', local.versions, [{ version: '20260814002658' }], aliasDoc, null);
ok('dev alias: recorded-only version listed, local version still pending', same(env.recorded_without_local_file, ['20260814002658']) && env.pending_versions.includes('20260814120000') && env.alias_annotations.length === 1);
env = calc.calculateEnvironment('prod', local.versions, [{ version: '20260101000000' }], aliasDoc, null);
ok('alias whose recorded version is not in the history is a finding', env.findings.some((x: any) => x.kind === 'alias-contradicts-data'));
env = calc.calculateEnvironment('prod', local.versions, [{ version: '20260305203528' }, { version: '20260305205811' }], aliasDoc, null);
ok('alias whose local version is not pending is a finding', env.findings.some((x: any) => x.kind === 'alias-contradicts-data'));
env = calc.calculateEnvironment('prod', local.versions, [{ version: '20260305205811' }], { aliases: [{ env: 'prod', local_version: 'bad', recorded_version: '20260305205811' }] }, null);
ok('malformed alias is a finding', env.findings.some((x: any) => x.kind === 'malformed-alias'));

// 8. withdrawn Case 43
local = calc.collectLocalVersions([f('20260407203226'), f('20260407211122', 'case43')]);
env = calc.calculateEnvironment('prod', local.versions, [{ version: '20260407203226' }], aliasDoc, null);
ok('withdrawn version present in the repository is a finding', env.findings.some((x: any) => x.kind === 'withdrawn-version-present-in-repository' && x.version === '20260407211122'));
local = calc.collectLocalVersions([f('20260407203226')]);
env = calc.calculateEnvironment('prod', local.versions, [{ version: '20260407203226' }, { version: '20260407211122' }], aliasDoc, null);
ok('withdrawn version recorded in a history is a finding', env.findings.some((x: any) => x.kind === 'withdrawn-version-recorded-in-history'));
env = calc.calculateEnvironment('prod', local.versions, [{ version: '20260407203226' }], { aliases: [], withdrawn: aliasDoc.withdrawn }, null);
ok('withdrawn version absent everywhere: not pending, no finding', !env.pending_versions.includes('20260407211122') && env.findings.length === 0);

// 9. deterministic ordering regardless of input order
const shuffled = ['20260101000004', '20260101000001', '20260101000003', '20260101000002'].map((v) => f(v));
const a = calc.computePending(calc.collectLocalVersions(shuffled).versions, calc.collectRecordedVersions(['20260101000003', '20260101000001']).versions);
const b = calc.computePending(calc.collectLocalVersions(shuffled.slice().reverse()).versions, calc.collectRecordedVersions(['20260101000001', '20260101000003']).versions);
ok('output is sorted and independent of input order', same(a, b) && same(a.pending, ['20260101000002', '20260101000004']));

// classification summary is an annotation and reports rows that are no longer pending
const cls = calc.summarizeClassification(['20260101000002'], calc.parseCsv('version,class\n20260101000002,PENDING_EXPECTED\n20260407211122,X\n'));
ok('classification: counts the current pending set and lists rows no longer pending', cls.counts.PENDING_EXPECTED === 1 && same(cls.noLongerPending, ['20260407211122']) && cls.unclassified.length === 0);

// 10. replay-tool safety rules preserved (same module, same exports and behaviour)
ok('replay tool: database-name guard unchanged', replay.validateDbName('postgres').ok === false && replay.validateDbName('bpc_replay_ok').ok === true);
ok('replay tool: loopback guard unchanged', replay.validateHost('db.srxunxiytojjsuhcmzjg.supabase.co').ok === false && replay.validateHost('127.0.0.1').ok === true);
ok('replay tool: confirmation guard unchanged', replay.validateEnvironment({}).ok === false);
ok('replay tool: strict mode needs no adjustment flag', replay.parseArgs(['--mode', 'strict']).adjust === '');
ok('pending-set tool does not touch the replay tool', !/migration-replay/.test(fs.readFileSync('scripts/dev/migration-pending-set.cjs', 'utf8').replace(/^\/\/.*$/gm, '')));

// STATIC: no hosted or local database / network capability
const src: string = fs.readFileSync('scripts/dev/migration-pending-set.cjs', 'utf8');
const code = src.replace(/^\/\/.*$/gm, '');
for (const banned of ['child_process', "require('net')", "require('http", "require('https", "require('tls')", "require('dns')", 'spawn', 'execSync', 'execFile', 'fetch(', 'psql', 'supabase ', 'pg_', 'process.env']) {
  ok(`static: no ${banned}`, !code.includes(banned));
}
ok('static: only fs and path are required', same((code.match(/require\('[^']+'\)/g) || []).sort(), ["require('fs')", "require('path')"]));
ok('static: the only write is the optional --out report', (code.match(/writeFileSync/g) || []).length === 1 && !/appendFileSync|unlink|rename|rmSync|mkdirSync/.test(code));

// EVIDENCE: the real working tree and the captured Stage B histories
const PROT = 'C:/Users/vikki/migration-evidence/stage-b-20261016';
if (fs.existsSync(`${PROT}/prod_catalog_history.json`) && fs.existsSync(`${PROT}/dev_catalog_history.json`)) {
  const names2: string[] = fs.readdirSync('supabase/migrations');
  const loc = calc.collectLocalVersions(names2);
  const prod = JSON.parse(fs.readFileSync(`${PROT}/prod_catalog_history.json`, 'utf8'));
  const dev = JSON.parse(fs.readFileSync(`${PROT}/dev_catalog_history.json`, 'utf8'));
  const aliases = JSON.parse(fs.readFileSync('audit/evidence/version-aliases.json', 'utf8'));
  const P = calc.calculateEnvironment('prod', loc.versions, prod, aliases, null);
  const D = calc.calculateEnvironment('dev', loc.versions, dev, aliases, null);
  ok('evidence: no findings in the repository or either history', loc.findings.length === 0 && P.findings.length === 0 && D.findings.length === 0);
  // Step 4A.7: the two declared local compatibility proposals add two repository versions, and two pending versions to each environment (they are older than both ledger heads)
  const compat47: string[] = JSON.parse(fs.readFileSync('audit/step4/compat-migrations.json', 'utf8')).files.map((x: any) => x.version);
  ok('evidence: 391 repository versions (389 at Step 3B plus the two declared Step 4A.7 compatibility proposals)', loc.versions.length === 391 && compat47.length === 2 && compat47.every((v: string) => loc.versions.includes(v)));
  ok('evidence: 277 Production and 58 Development recorded', P.recorded_count === 277 && D.recorded_count === 58);
  ok('evidence: Production pending 114, Development pending 334 (112 and 332 before the two compatibility proposals; 107 and 327 before the 5 Step 3B migrations)', P.pending_count === 114 && D.pending_count === 334);
  ok('evidence: Case 43 is not pending anywhere and not in the repository', !P.pending_versions.includes('20260407211122') && !D.pending_versions.includes('20260407211122') && !loc.versions.includes('20260407211122'));
  ok('evidence: cases 41 and 42 are withdrawn: not in the repository, not pending anywhere, no alias annotation', ['20260305203528', '20260407203226'].every((v: string) => !loc.versions.includes(v) && !P.pending_versions.includes(v) && !D.pending_versions.includes(v)) && P.alias_annotations.length === 0);
  ok('evidence: Development 20260814120000 stays pending; 20260814002658 is recorded without a local file', D.pending_versions.includes('20260814120000') && same(D.recorded_without_local_file, ['20260814002658']));
  const octo = loc.versions.filter((v: string) => v >= '20261007000000' && v < '20261026000000');
  const s3b = loc.versions.filter((v: string) => v >= '20261026000000');
  ok('evidence: the 23 October migrations are pending in both environments', octo.length === 23 && octo.every((v: string) => P.pending_versions.includes(v) && D.pending_versions.includes(v)));
  ok('evidence: the 5 Step 3B migrations are pending in both environments', s3b.length === 5 && s3b.every((v: string) => P.pending_versions.includes(v) && D.pending_versions.includes(v)));
  ok('evidence: Production recorded versions all have local files', P.recorded_without_local_file_count === 0);
} else {
  skipped++;
  console.log('SKIPPED: EVIDENCE layer - the protected Stage B capture folder is not present (environment limitation, not a pass)');
}

console.log(`migration pending set: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed) process.exit(1);
