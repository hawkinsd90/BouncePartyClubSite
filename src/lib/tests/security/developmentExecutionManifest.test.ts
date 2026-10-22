// Operational execution manifest (audit/development-execution-manifest.csv) and verification rules (audit/development-verification-rules.json): structural invariants.
// PURE: committed files only; no database, no network. The rules themselves are exercised on scratch PostgreSQL by audit/evidence/tools/test_execution_scripts.py.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/security/developmentExecutionManifest.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { exit(code: number): never };
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('../../../../scripts/dev/local-executor/build-allowlist.cjs');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const ops: any[] = parseCsv(fs.readFileSync(path.join(ROOT, 'audit', 'development-execution-manifest.csv'), 'utf8'));
const man: any[] = parseCsv(fs.readFileSync(path.join(ROOT, 'audit', 'development-migration-manifest.csv'), 'utf8'));
const manBy = new Map<string, any>(man.map((r) => [r.version, r]));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'development-verification-rules.json'), 'utf8'));
const byV = new Map<string, any>(ops.map((r) => [r.version, r]));

ok('259 unique operations, one per P1/P2 plan item', ops.length === 259 && byV.size === 259 && man.filter((r) => /^P[12]/.test(r.plan_phase)).every((r) => byV.has(r.version)));
ok('operation types: 201 history-only, 56 attestation, 2 SQL', ops.filter((o) => o.operation_type === 'history-only').length === 201 && ops.filter((o) => o.operation_type === 'attestation').length === 56 && ops.filter((o) => o.operation_type === 'sql-execute').length === 2);
ok('nothing is approved', ops.every((o) => o.approval_status === 'not approved'));
ok('no withheld, withdrawn, excluded or alias version is an operation', ops.every((o) => ['Evidence-backed history-only reconciliation candidate', 'Qualified owner-attestation candidate', 'Actual SQL execution required'].includes(manBy.get(o.version).proposed_disposition))
  && !['20260814120000', '20260611184401', '20251229223230'].some((v) => byV.has(v)));
const REAL = ['20260305203528', '20260407203226', '20260407211122'];
ok('Cases 41, 42, 43 never appear', REAL.every((v) => !byV.has(v)));
ok('every operation has a 64-hex source hash and the source file exists', ops.every((o) => /^[0-9a-f]{64}$/.test(o.sha256_lf) && fs.existsSync(path.join(ROOT, 'supabase', 'migrations', o.source_file))));
ok('every operation has expected change, post-operation verification and recovery text', ops.every((o) => o.expected_change && o.post_operation_verification && o.failure_and_recovery));
ok('rule status values: DEFINED, WEAK or BLOCKED only; DEFINED/WEAK rules have SQL, BLOCKED rules do not', ops.every((o) => ['DEFINED', 'WEAK', 'BLOCKED'].includes(o.rule_status)) && ops.every((o) => (o.rule_status === 'BLOCKED') === (rules[o.version].sql === '' || o.batch_class.startsWith('BLOCKED'))));
ok('rule SQL is a single SELECT without write keywords', Object.values(rules).every((r: any) => r.sql === '' || (/^SELECT /.test(r.sql) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|CALL|EXECUTE)\b/i.test(r.sql.replace(/'(?:[^']|'')*'/g, "''")))));
ok('BLOCKED and WEAK operations are never in an approvable batch class', ops.filter((o) => o.rule_status !== 'DEFINED').every((o) => /WEAK|BLOCKED/.test(o.batch_class)));
ok('exactly one canary, a plain history-only operation', ops.filter((o) => o.batch_class === 'CANARY').length === 1 && ops.find((o) => o.batch_class === 'CANARY').operation_type === 'history-only');
// ordering: execution_seq is 1..259; predecessors precede their dependents
const seq = new Map<string, number>(ops.map((o) => [o.version, Number(o.execution_seq)]));
ok('execution_seq is 1..259 in file order', ops.every((o, i) => Number(o.execution_seq) === i + 1));
ok('every predecessor that is an operation precedes its dependent', ops.every((o) => o.predecessor_versions.split(';').filter(Boolean).every((p: string) => !seq.has(p) || (seq.get(p) as number) < (seq.get(o.version) as number))));
ok('batch ids are non-decreasing and every batch is contiguous', ops.every((o, i) => i === 0 || ops[i - 1].batch <= o.batch));
ok('the two SQL operations are alone in their batches', ops.filter((o) => o.operation_type === 'sql-execute').every((o) => ops.filter((x) => x.batch === o.batch).length === 1));
ok('a history-only operation never has a rule that depends on a data predicate over private records', ops.filter((o) => o.operation_type === 'history-only').every((o) => !/auth\.users/.test(rules[o.version].sql)));
const bj = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'development-execution-batches.json'), 'utf8'));
ok('batch file lists every operation exactly once with script and reversal hashes', Object.values(bj.batches).flat().length === 259 && Object.values(bj.hashes).every((h: any) => /^[0-9a-f]{64}$/.test(h.script_sha256) && /^[0-9a-f]{64}$/.test(h.reversal_sha256)));
// Fail-closed deny list (audit/development-execution-deny.json): the same rules build_execution_package.py enforces at generation time.
const deny = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit', 'development-execution-deny.json'), 'utf8'));
const BLOCKED3 = ['20251001052039', '20260125173238', '20260305222010'];
ok('the deny list names exactly the three blocked versions', JSON.stringify([...deny.blocked_no_safe_rule.versions].sort()) === JSON.stringify(BLOCKED3));
ok('each blocked version is listed only as BLOCKED: empty rule, BLOCKED class, not approved, not in an approvable batch class', deny.blocked_no_safe_rule.versions.every((v: string) => {
  const o = byV.get(v);
  return o && o.rule_status === 'BLOCKED' && /^BLOCKED/.test(o.batch_class) && o.approval_status === 'not approved' && rules[v].sql === '' && o.operation_type === 'attestation';
}));
ok('excluded update_pricing_rules, withdrawn Cases 41/42/43 and every withheld version are never operations', [...deny.excluded_pending_owner.versions, ...deny.withdrawn.versions, ...man.filter((r) => /^Withheld/.test(r.proposed_disposition)).map((r) => r.version)].every((v: string) => !byV.has(v)));
ok('the demo-admin creation is never an SQL-execute operation', deny.never_sql_execute.versions.every((v: string) => !byV.has(v) || byV.get(v).operation_type !== 'sql-execute'));
ok('only the two Storage-decision operations execute SQL', ops.filter((o) => o.operation_type === 'sql-execute').length === 2 && ops.filter((o) => o.operation_type === 'sql-execute').every((o) => /^X|SQL/.test(o.batch_class) || /Storage/.test(o.batch_class)));
ok('no recovery text calls a committed ledger entry silently or automatically reversible', ops.every((o) => !/after a mistaken commit use/i.test(o.failure_and_recovery) && /NOT an automatic undo/.test(o.failure_and_recovery)));
console.log(`development execution manifest: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
