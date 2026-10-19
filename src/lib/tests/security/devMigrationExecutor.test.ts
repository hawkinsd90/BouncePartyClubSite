// Static and unit tests for the exact-version migration executor (Step 4A.1, D-01): scripts/dev/hosted-executor/.
//
// No database, no network: these checks pin the executor's refusals, the shape of the SQL it renders, the sealed package committed in audit/step4/executor/ and the
// committed rehearsal evidence. The database rehearsal itself (28 real files, restart, negative controls, mutation matrix, hosted-like privileges, S11 gate controls)
// is run by `node scripts/dev/hosted-executor/rehearse.cjs` against local scratch PostgreSQL and recorded in audit/step4/executor-rehearsal-results.json.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function throws(fn: () => unknown, rx: RegExp): boolean {
  try { fn(); return false; } catch (e: any) { return rx.test(String(e && (e.code || '') + ' ' + (e && e.message))); }
}

const ROOT = process.cwd();
const X = require(path.join(ROOT, 'scripts/dev/hosted-executor/dev-migration-executor.cjs'));
const PKG_FILE = path.join(ROOT, 'audit/step4/executor/dev-package-oct-s3b.sealed.json');
const pkg = JSON.parse(fs.readFileSync(PKG_FILE, 'utf8'));
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

// ---- the sealed package
ok('the sealed package validates (hash, order, scope, dependencies, fingerprint chain)', !throws(() => X.loadPackage(PKG_FILE), /./));
ok('it is bound to a full commit and contains exactly 28 items: 23 October gate files and the 5 Step 3B files', /^[0-9a-f]{40}$/.test(pkg.commit) && pkg.items.length === 28 && pkg.items.filter((i: any) => i.class === 'withheld-gate').length === 23 && pkg.items.filter((i: any) => i.class === 'step3b').length === 5);
ok('versions are exactly 20261007120000..20261025120000 and 20261026120000..20261026120400 in increasing order', pkg.items[0].version === '20261007120000' && pkg.items[22].version === '20261025120000' && pkg.items[23].version === '20261026120000' && pkg.items[27].version === '20261026120400' && pkg.items.every((i: any, k: number) => k === 0 || i.version > pkg.items[k - 1].version));
ok('the deny list in the package covers Cases 41/42/43, the 3 blocked, the pricing exclusion and the demo-admin migration', ['20260305203528', '20260407203226', '20260407211122', '20251001052039', '20260125173238', '20260305222010', '20260611184401', '20251003170350'].every((v) => pkg.deny.includes(v)));
ok('no denied version is in the package, and the executor refuses each one', pkg.deny.every((v: string) => !pkg.items.some((i: any) => i.version === v)) && pkg.deny.every((v: string) => X.NEVER.has(v)));
ok('containment is required (the package declares containment on)', pkg.containment === 'on');
ok('the chain of fingerprints is unbroken and the start/end are recorded', pkg.items.every((i: any, k: number) => k === 0 ? i.pre_fp_all === pkg.start_state.fp_all : i.pre_fp_all === pkg.items[k - 1].post_fp_all) && pkg.items.every((i: any) => i.contained_after === true));
ok('every item names a file whose name starts with its version', pkg.items.every((i: any) => i.file.startsWith(i.version + '_')));
let filesOk = true; let files: Map<string, string> = new Map();
try { files = X.readFiles(pkg, ROOT); } catch (e: any) { filesOk = false; console.error(String(e.message)); }
ok('all 28 files in the working tree equal the sealed hashes and the bound commit (no later edit of an applied or pending migration)', filesOk && files.size === 28);
ok('no file contains transaction control, SET ROLE, SET search_path or CONCURRENTLY', filesOk && [...files.values()].every((t) => X.forbiddenStatements(t).length === 0));

// ---- the SQL scanner
ok('scanner: COMMIT, BEGIN, SET ROLE, RESET ALL, SET search_path, VACUUM, CREATE INDEX CONCURRENTLY are flagged', ['commit;', 'begin;', 'set role postgres;', 'reset all;', 'set search_path = x;', 'vacuum;', 'create index concurrently i on t(a);'].every((s) => X.forbiddenStatements(s).length === 1));
ok('scanner: the same words in comments, strings and dollar-quoted bodies are ignored', X.forbiddenStatements("-- commit;" + NL + "/* begin; */ select 'commit;'; create function f() returns void language plpgsql as $$ begin commit; end $$;").length === 0);
ok('scanner: SET LOCAL timeouts and ordinary DDL are not flagged', X.forbiddenStatements("set local statement_timeout = '5s'; create table t(a int); grant select on t to service_role;").length === 0);

// ---- rendered SQL
const ctx = { expectDb: 'postgres', expectRole: 'postgres', baseCount: 60, baseSha: 'a'.repeat(64) };
const first = X.renderStep(pkg, pkg.items[0], files.get(pkg.items[0].version) || '', ctx);
const last = X.renderStep(pkg, pkg.items[27], files.get(pkg.items[27].version) || '', ctx);
const lines = first.split(NL);
ok('script: no top-level BEGIN/COMMIT/ROLLBACK (the caller supplies the single transaction)', !lines.some((l: string) => /^\s*(begin|commit|rollback|start transaction)\s*;/i.test(l)));
ok('script: SET LOCAL timeouts and an advisory lock come first', lines[1].startsWith('SET LOCAL lock_timeout') && lines[2].startsWith('SET LOCAL statement_timeout') && lines[3].includes('pg_advisory_xact_lock'));
ok('script: pre checks database, role, ledger, version, predecessors, package prefix, base export, containment and fingerprint', ['wrong database', 'unexpected role', 'no migration ledger', 'version already recorded', 'predecessor not recorded', 'later than this step', 'earlier package steps', 'differs from the approved export', 'schema containment is not in force', 'catalog fingerprint mismatch'].every((m) => first.includes(m)));
ok('script: the exact file text appears verbatim and again inside the ledger statements array', first.includes(files.get(pkg.items[0].version) || '#') && first.includes('$bpcsql$' + (files.get(pkg.items[0].version) || '#') + '$bpcsql$'));
ok('script: post checks fingerprint, containment and RLS, then the ledger INSERT with version, CLI-style name and executed marker, then a count assertion', first.indexOf('$bpcpost$') > first.indexOf(lines.find((l: string) => l.startsWith('-- exact file')) || '') && first.includes("INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261007120000', 'harden_payment_rpc_authorization'") && first.includes('-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;') && first.includes('unexpected ledger count after 20261007120000'));
ok('script: the Step 3B step carries its own post-effect rule; the first October step carries only the global rules', last.includes('step3b-post-effect-present') && !first.includes('step3b-post-effect-present') && first.includes('rls-on-every-public-table'));
ok('script: the ledger count asserted at the end is base + step order', first.includes('<> 61 THEN RAISE EXCEPTION') && last.includes('<> 88 THEN RAISE EXCEPTION'));
ok('script: statement-level fingerprints are the sealed values', first.includes(pkg.items[0].pre_fp_all) && first.includes(pkg.items[0].post_fp_all));
ok('ledger name is the CLI style (file name without version and .sql)', X.ledgerName('20261026120400_restrict_supabase_admin_default_privileges.sql') === 'restrict_supabase_admin_default_privileges');
ok('every guard mutant changes a rendered script (patterns are current)', Object.keys(X.MUTANTS).every((m) => { try { return X.mutateScript(first, m) !== first; } catch { return false; } }));

// ---- package refusals (re-hashed so only the targeted defect is present)
function variant(mut: (p: any) => void, rehash = true) { const p = JSON.parse(JSON.stringify(pkg)); mut(p); if (rehash) X.sealHash(p); return p; }
ok('refusal: package edited without re-hashing', throws(() => X.validatePackage(variant((p) => { p.items[0].sha256_lf = 'b'.repeat(64); }, false)), /package-hash/));
ok('refusal: a blocked version in the package', throws(() => X.validatePackage(variant((p) => { p.items[0].version = '20260125173238'; p.items[0].file = '20260125173238_x.sql'; })), /deny|order|scope/));
ok('refusal: the demo-admin migration in the package', throws(() => X.validatePackage(variant((p) => { p.items[0].version = '20251003170350'; p.items[0].file = '20251003170350_x.sql'; })), /deny|scope/));
ok('refusal: a version outside the October and Step 3B ranges', throws(() => X.validatePackage(variant((p) => { p.items[0].version = '20260929161925'; p.items[0].file = '20260929161925_x.sql'; })), /scope|order/));
ok('refusal: a class that does not match the version range', throws(() => X.validatePackage(variant((p) => { p.items[0].class = 'step3b'; })), /scope/));
ok('refusal: a deny list that lost a withdrawn case', throws(() => X.validatePackage(variant((p) => { p.deny = p.deny.filter((v: string) => v !== '20260305203528'); })), /deny list/));
ok('refusal: broken fingerprint chain', throws(() => X.validatePackage(variant((p) => { p.items[5].pre_fp_all = 'c'.repeat(32); })), /fp-chain/));
ok('refusal: an unsealed package', throws(() => X.validatePackage(variant((p) => { delete p.items[3].post_fp_all; })), /unsealed/));
ok('refusal: items out of order', throws(() => X.validatePackage(variant((p) => { p.items.reverse(); p.items.forEach((i: any, k: number) => { i.order = k + 1; }); })), /order|dependency/));

// ---- arguments and the local target
ok('arguments: credential-style options are not accepted', ['--password', '--conninfo', '--url', '--connection-string'].every((o) => throws(() => X.parseArgs(['run', o, 'x']), /not accepted/)));
ok('arguments: unknown commands are refused', throws(() => X.parseArgs(['push']), /first argument/));

// ---- hosted authorization
const NOW = new Date('2026-10-20T12:00:00Z');
function auth(over: any = {}) {
  const v = pkg.items.slice(0, 3).map((i: any) => i.version);
  const a: any = { schema: X.AUTH_SCHEMA, project_ref: X.DEV_REF, package_sha256: pkg.document_sha256, versions: v, approved_withheld: v, base_ledger: { count: 60, sha256: 'd'.repeat(64) }, restore_point: { id: 'rp', taken_at_utc: '2026-10-20T08:00:00Z' }, approved_by: 'owner', approved_at: '2026-10-20T10:00:00Z', expires_at: '2026-10-20T20:00:00Z', statement: 'AUTHORIZE HOSTED DEVELOPMENT EXECUTION', ...over };
  a.document_sha256 = X.docHash(a, 'document_sha256');
  return a;
}
ok('authorization: a complete, current, contiguous authorization for the Development project is accepted', X.checkAuthorization(auth(), pkg, NOW) === true);
const defects: Array<[string, any]> = [['production project', { project_ref: X.PROD_REF }], ['other project', { project_ref: 'x' }], ['other package', { package_sha256: 'e'.repeat(64) }], ['wrong statement', { statement: 'ok' }], ['no restore point', { restore_point: null }],
  ['restore point after approval', { restore_point: { id: 'rp', taken_at_utc: '2026-10-20T11:00:00Z' } }], ['window over 48 hours', { expires_at: '2026-10-23T10:00:00Z' }], ['expired', { expires_at: '2026-10-20T11:00:00Z' }],
  ['withheld not released', { approved_withheld: [] }], ['non-contiguous', { versions: [pkg.items[0].version, pkg.items[2].version] }], ['unknown version', { versions: ['20261007120001'] }], ['no base ledger identity', { base_ledger: null }]];
for (const [label, over] of defects) ok(`authorization refused: ${label}`, throws(() => X.checkAuthorization(auth(over), pkg, NOW), /./));
ok('authorization refused: document edited after hashing', throws(() => { const a = auth(); a.approved_by = 'someone else'; X.checkAuthorization(a, pkg, NOW); }, /hash/));
const dev = `postgresql://postgres:p@db.${X.DEV_REF}.supabase.co:5432/postgres?sslmode=require`;
ok('hosted URL: the Development direct host and pooler user are accepted; Production, other hosts and non-TLS are refused', !throws(() => X.parseHostedUrl(dev), /./) && !throws(() => X.parseHostedUrl(`postgresql://postgres.${X.DEV_REF}:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`), /./) &&
  throws(() => X.parseHostedUrl(dev.replace(X.DEV_REF, X.PROD_REF)), /./) && throws(() => X.parseHostedUrl('postgresql://postgres:p@example.com/postgres?sslmode=require'), /./) && throws(() => X.parseHostedUrl(dev.replace('?sslmode=require', '')), /./));

// ---- the source itself
const src = fs.readFileSync(path.join(ROOT, 'scripts/dev/hosted-executor/dev-migration-executor.cjs'), 'utf8');
ok('source: no network library, no fetch, no Supabase CLI invocation', !/require\(['"](https?|net|tls|dns)['"]\)|fetch\(|supabase\s+(db|migration|functions)/.test(src));
ok('source: the hosted connection string is read only from BPC_HOSTED_DEV_DATABASE_URL, only after the authorization checks', src.includes("env.BPC_HOSTED_DEV_DATABASE_URL") && src.indexOf('checkAuthorization(auth, pkg)') < src.indexOf('hostedTransport(env.BPC_HOSTED_DEV_DATABASE_URL)'));
ok('source: test hooks are honoured only for the local target', src.includes("crashHook(env, hosted ? 'hosted' : 'local')") && src.includes("target === 'local' && h"));
ok('source: the Step 2 local executor was not modified to serve this tool (still loopback-only)', fs.readFileSync(path.join(ROOT, 'scripts/dev/local-executor/local-migration-executor.cjs'), 'utf8').includes('NOT AUTHORIZED FOR HOSTED USE'));

// ---- committed rehearsal evidence
const rr = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/step4/executor-rehearsal-results.json'), 'utf8'));
ok('rehearsal evidence: bound to this package, local only, zero failures', rr.package_sha256 === pkg.document_sha256 && rr.local_only === true && rr.failed === 0 && rr.passed === rr.total && rr.total >= 90);
const ids = new Set(rr.results.map((r: any) => r.id));
ok('rehearsal evidence covers every required scenario family', ['S01b', 'S02a', 'S02b', 'S03a', 'S04a', 'S05', 'S06', 'S07', 'S08a', 'S09', 'S10a', 'P01', 'P05', 'P06', 'P07', 'P08', 'H01', 'H03', 'H06', 'V1z', 'V2z', 'V3z', 'V4z', 'V5z', 'V6z', 'E00', 'E01', 'G00', 'G-G13'].every((i) => ids.has(i)));
const hl = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/step4/executor-rehearsal-results.hostlike.json'), 'utf8'));
ok('hosted-like privilege rehearsal: all 28 files were tried and exactly the 3 storage-policy files are blocked by ownership of storage.objects', hl.length === 28 && hl.filter((x: any) => !x.runnable_as_hosted_like_operator).map((x: any) => x.version).join() === '20261014120000,20261015120000,20261015123000');
const gate = fs.readFileSync(path.join(ROOT, 'audit/step4/s11-gate-checks.sql'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/security/step3b-verification-rules.json'), 'utf8'));
ok('S11 gate: contains 20 checks and the five Step 3B post_effect_present rules verbatim', (gate.match(/AS ok/g) || []).length === 20 && ['20261026120000', '20261026120100', '20261026120200', '20261026120300', '20261026120400'].every((v) => gate.includes(rules[v].post_effect_present.replace(/;\s*$/, ''))));

// ---- the 58-versus-59 ledger count (Step 4A.1): 58 ledger versions, 59 manifest rows classified "Already recorded"
{
  const lines = fs.readFileSync(path.join(ROOT, 'audit/development-migration-manifest.csv'), 'utf8').split(NL).filter(Boolean);
  const head = lines[0].split(CR).join('').split(',');
  const col = (n: string) => head.indexOf(n);
  const rowsM = lines.slice(1).filter((l: string) => l.startsWith('2026') || l.startsWith('2025')).map((l: string) => l.split(CR).join(''));
  const ledgerVersions = fs.readFileSync(path.join(ROOT, 'audit/evidence/derived/dev-ledger-versions.txt'), 'utf8').split(NL).map((x: string) => x.trim()).filter(Boolean);
  const already = rowsM.filter((l: string) => l.includes(',Already recorded,'));
  const recordedStatus = rowsM.filter((l: string) => l.split(',')[col('development_ledger_status')] === 'recorded');
  ok('ledger count: the committed Development ledger capture has 58 versions', ledgerVersions.length === 58);
  ok('ledger count: 59 manifest rows are "Already recorded" and 58 of them are recorded under their own version', already.length === 59 && recordedStatus.length === 58);
  const aliasFile = rowsM.find((l: string) => l.startsWith('20260814120000,'));
  ok('ledger count: the 59th row is the file 20260814120000, recorded in the ledger under the alias version 20260814002658 (one ledger row, two manifest rows)', !!aliasFile && aliasFile.includes('recorded as 20260814002658') && ledgerVersions.includes('20260814002658') && !ledgerVersions.includes('20260814120000'));
}

// ---- Step 4A.2: owner-gate package, canary and JWT decisions
{
  const parseLine = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const readCsv = (f: string): any[] => {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8').split(NL).filter(Boolean);
    const head = parseLine(t[0].split(CR).join(''));
    return t.slice(1).map((l: string) => { const c = parseLine(l.split(CR).join('')); const o: any = {}; head.forEach((h, i) => { o[h] = c[i]; }); return o; });
  };
  const gates = readCsv('audit/step4/owner-gates-register.csv');
  const required = ['gate_id', 'risk', 'required_owner_action', 'location_or_configuration', 'evidence_needed', 'requires_hosted_mutation', 'blocks_stages', 'pass_criteria', 'fail_criteria', 'current_status'];
  const g = (id: string) => gates.find((x: any) => x.gate_id === id);
  ok('gates register: 31 gates, unique ids, every required column filled', gates.length === 31 && new Set(gates.map((x: any) => x.gate_id)).size === 31 && gates.every((x: any) => required.every((c) => (x[c] || '').length > 0)));
  ok('gates register: no gate is marked PASS (nothing has been satisfied by this planning work)', gates.every((x: any) => !/^PASS/i.test(x.current_status)));
  ok('gates register: D-02 is strategy-approved with execution and restore verification still pending (hosted dump not authorized) and G-16 is OPEN', /^STRATEGY APPROVED - EXECUTION AND RESTORE VERIFICATION PENDING/.test(g('D-02').current_status) && /Not yet authorized: the hosted dump/.test(g('D-02').current_status) && /^Strategy approved/.test(g('D-02').gate_class) && /^OPEN/.test(g('G-16').current_status));
  ok('gates register: G-21 records that the NOT EXECUTED proposal is not approved', /NOT approved/.test(g('G-21').current_status));
  ok('gates register: every gate that needs a hosted change says so', ['D-03b', 'G-03', 'G-03P', 'G-15', 'G-20', 'G-25'].every((id) => /^YES/.test(g(id).requires_hosted_mutation)));
  ok('gates register: S0, S4b, S9 and S11 are blocked by the expected gates', ['D-02', 'D-03a', 'G-14', 'G-18'].every((id) => g(id).blocks_stages.split(',').includes('S0')) && g('G-16').blocks_stages.includes('S4b') && ['D-03b', 'G-15', 'G-20', 'G-22'].every((id) => g(id).blocks_stages.includes('S9') || g(id).blocks_stages.includes('S0')) && g('G-03').blocks_stages.includes('S11'));
  const jwt = readCsv('audit/step4/edge-function-jwt-compatibility-matrix.csv');
  const jf = (f: string) => jwt.find((r: any) => r.function === f);
  ok('jwt matrix: 25 rows with caller class, necessity, recommended flag, owner decision, tests, notes and explicit flag', jwt.length === 25 && jwt.every((r: any) => ['caller_class', 'security_necessity', 'recommended_explicit_flag', 'owner_decision_remaining', 'integration_tests', 'compatibility_notes', 'explicit_flag_at_deploy'].every((c) => (r[c] || '').length > 0)));
  ok('jwt matrix: webhooks and the Stripe return page are false; retired functions are true; stubs are not deployed', ['twilio-webhook', 'twilio-status-callback', 'checkout-bridge'].every((f) => jf(f).explicit_flag_at_deploy === 'verify_jwt=false') && ['get-session-metadata', 'get-payment-method', 'create-order-short-link'].every((f) => jf(f).explicit_flag_at_deploy === 'verify_jwt=true') && ['auth-email-hook', 'save-pending-consent', 'save-signup-address', 'get-stripe-publishable-key'].every((f) => /not deployed/.test(jf(f).explicit_flag_at_deploy)));
  ok('jwt matrix: every deployed row either is a Step 3 change, is required, or leaves the decision to the owner (no silent normalization)', jwt.every((r: any) => /not deployed/.test(r.explicit_flag_at_deploy) || r.origin_of_difference.startsWith('Step 3') || /^none/.test(r.owner_decision_remaining) || /^OWNER/.test(r.owner_decision_remaining)));
  ok('jwt matrix: integration tests all resolve to real test ids', jwt.every((r: any) => r.integration_tests.indexOf('??') < 0));
  ok('gates register: decision timing present for every gate; the immediate group is backup, Netlify read, window, commits, Bolt and Git; approved strategies are not immediate', gates.every((x: any) => (x.decision_timing || '').length > 0) && ['D-02', 'D-03a', 'G-14', 'G-18', 'G-20', 'G-22'].every((id) => /^1 immediate/.test(g(id).decision_timing)) && ['G-01', 'G-02', 'G-03'].every((id) => !/^1 immediate/.test(g(id).decision_timing)));
  ok('gates register: owner strategy decisions are recorded as strategy only, never as executed', ['G-01', 'G-02', 'G-03', 'G-03P', 'D-03c'].every((id) => /^OWNER STRATEGY APPROVED \(execution NOT authorized\)/.test(g(id).current_status)));
  ok('gates register: Netlify continuous deployment is not a blocker', /not a blocker|recorded only/.test(g('D-03c').blocks_stages) && /^No/.test(g('D-03c').requires_hosted_mutation));
  const oracle = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/step4/cli-oracle-results.json'), 'utf8'));
  const st = (k: string) => oracle.steps.find((x: any) => x.step.indexOf(k) === 0);
  ok('cli oracle: local only, real CLI, 389 files, the 13 unrecordable files are the 3 blocked, 1 excluded and 9 weak', oracle.local_only === true && /^2\./.test(oracle.cli_version) && oracle.repository_files === 389 && oracle.unrecordable_under_current_approvals.length === 13 && oracle.category_counts.blocked === 3 && oracle.category_counts.excluded === 1 && oracle.category_counts['weak-attestation'] === 9);
  ok('cli oracle: today the CLI refuses because of the single remote-only version 20260814002658', /Remote migration versions not found/.test(st('A.').first_message) && st('A.').remote_only_versions.join() === '20260814002658');
  ok('cli oracle: with only the alias fixed a standard push would run 332 files including all 13 that must never run', st('B.').pending_count === 332 && st('B.').pending_never_run.length === 13 && st('B.').would_rerun_alias_covered_file === true);
  ok('cli oracle: after the approved reconciliation exactly the 13 remain; after honest rows for them the database is up to date; then only a new file is pending', st('E.').pending_count === 13 && st('E.').remaining_equals_unrecordable_set === true && /up to date/.test(st('F.').first_message) && st('F.').pending_count === 0 && st('G.').only_future_file === true);
  ok('cli oracle: real pushes apply only the new files, in ascending order, one ledger row each, up to date afterwards', st('I.').applied.join() === '20261101120000' && st('I.').ledger_delta === 1 && /up to date/.test(st('I2.').first_message) && st('J.').applied.join() === '20261102120000,20261103120000');
  ok('cli oracle: a failing file records nothing and shows an error', st('K.').ledger_delta === 0 && st('K.').bad_recorded === '0' && st('K.').error_shown === true);
  const alt = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/step4/exclusion-alternatives-oracle.json'), 'utf8'));
  ok('exclusion oracle: a sub-directory and a renamed file are ignored by the CLI; repair --status applied records the file SQL as executed (rejected); a marker row stops pending-ness', alt.E1_subdirectory.pending.join() === '20260101000000,20260103000000' && alt.E2_renamed_extension.raw.some((l: string) => /Skipping migration/.test(l)) && alt.E3_repair_applied.recorded_statement === 'create table must_not_exist(id int)' && alt.E3_repair_applied.table_exists === '' && alt.E4_repair_reverted.row_count === '0' && alt.E5_marker_row.pending.join() === '20260101000000,20260103000000');
  const fresh = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/step4/fresh-database-oracle-results.json'), 'utf8'));
  const f1 = fresh.scenarios.F1_repository_as_is;
  const f3 = fresh.scenarios.F3_additive_compat_files;
  ok('fresh-database oracle: local only; the repository as it is stops at 20260324175546 and none of the 13 versions is the failing file', fresh.local_only === true && f1.failing_file === '20260324175546' && f1.max_recorded_version === '20260324162302' && !(oracle.unrecordable_under_current_approvals as string[]).includes(f1.failing_file));
  ok('fresh-database oracle: two additive idempotent files let a fresh build finish, then a later file applies and only those two stay pending on an existing database', f3.completed === true && f3.applied === f3.files_pushed && /up to date/.test(f3.dry_run_after) && f3.future_file_applied.join() === '20261201120000' && f3.existing_db_without_compat_rows_include_all_pending.join() === '20251207163823,20260615175815');
  const review13 = fs.readFileSync(path.join(ROOT, 'audit/step4/thirteen-migration-review.md'), 'utf8');
  const unrecordable13 = oracle.unrecordable_under_current_approvals as string[];
  ok('13-migration review: not approved, covers all 13 versions, records no ledger change', /NOT APPROVED/.test(review13) && /No ledger row was written/.test(review13) && unrecordable13.length === 13 && unrecordable13.every((v: string) => review13.indexOf('`' + v + '_') >= 0));
  const docs = (f: string) => fs.readFileSync(path.join(ROOT, 'audit/step4/' + f), 'utf8');
  ok('backup comparison: covers the four options, states nothing was bought or enabled, and does not treat WAL archiving as a restore point', ['managed daily backups', 'logical backup', 'PITR', 'Combination'].every((k) => docs('backup-options-comparison.md').toLowerCase().indexOf(k.toLowerCase()) >= 0) && /Nothing was purchased/.test(docs('backup-options-comparison.md')) && /does not prove/.test(docs('backup-options-comparison.md')));
  ok('provider checklist: no credential values; the old relay versions are described as expected before the coordinated deployment, with no isolated hotfix and no testing before S12', /pre-guard/.test(docs('provider-safety-checklist.md')) && /This is expected/.test(docs('provider-safety-checklist.md')) && /no isolated hotfix/.test(docs('provider-safety-checklist.md')) && /no provider was called/.test(docs('provider-safety-checklist.md')) && !/sk_(live|test)_[A-Za-z0-9]{8}|whsec_[A-Za-z0-9]{8}|AC[0-9a-f]{32}/.test(docs('provider-safety-checklist.md')));
  ok('git reconciliation document records the remote tip and recommends a merge, not a rebase or force push', docs('git-remote-reconciliation.md').indexOf('aeb708ed9d5f0fbc2b146a52d378babd07024b30') >= 0 && /Recommended/.test(docs('git-remote-reconciliation.md')) && /Not recommended/.test(docs('git-remote-reconciliation.md')));
  ok('runbook: Netlify continuous deployment is not a blocker, S15 exists, phase map present', /Netlify CD stays ON/.test(docs('development-deployment-runbook.md')) && docs('development-deployment-runbook.md').indexOf('## S15.') >= 0 && docs('development-deployment-runbook.md').indexOf('### Phase map') >= 0);
  const canary = fs.readFileSync(path.join(ROOT, 'audit/step4/g16-storage-canary.sql'), 'utf8');
  const executable = canary.split(NL).filter((l: string) => !l.trim().startsWith('--')).join(NL);
  ok('canary: one DO block that always ends in RAISE EXCEPTION and has no COMMIT or ROLLBACK', executable.indexOf('DO $bpc_canary$') >= 0 && executable.indexOf("RAISE EXCEPTION 'BPC-CANARY-OK") >= 0 && !/\b(commit|rollback)\b/i.test(executable));
  const noLiterals = executable.split("'").filter((_p: string, i: number) => i % 2 === 0).join(' ');
  ok('canary: no data access and no statement other than policy DDL on storage.objects, settings and reads of pg_policies (string literals ignored)', !/\b(insert|update|delete|truncate|grant|revoke|alter)\b/i.test(noLiterals) && (executable.match(/ON storage\.objects/g) || []).length === 3 && executable.indexOf('unexpected database') >= 0);
  const steps = fs.readFileSync(path.join(ROOT, 'audit/step4/development-deployment-runbook.md'), 'utf8');
  ok('runbook: S4b uses the canary file; S9 requires the D-03 gates', steps.indexOf('g16-storage-canary.sql') >= 0 && steps.indexOf('G-16') >= 0 && steps.indexOf('D-03b') >= 0);
  ok('freeze document names the sealed package hash', fs.readFileSync(path.join(ROOT, 'audit/step4/package-freeze-and-commit-sequence.md'), 'utf8').indexOf(pkg.document_sha256) >= 0);
}

console.log(`dev migration executor tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} dev migration executor test(s) failed`);
