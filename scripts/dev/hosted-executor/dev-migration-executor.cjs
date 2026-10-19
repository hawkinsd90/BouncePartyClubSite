#!/usr/bin/env node
'use strict';
// Exact-version migration executor for the coordinated Development rollout (Step 4A.1, D-01).
//
// STATUS: built and rehearsed on LOCAL scratch PostgreSQL only. Its hosted transport is implemented but has NEVER been connected to any hosted project; it refuses to
// start without a separate, signed-off hosted authorization document (see AUTHORIZATION below). Nothing in this file may be run against Development in Step 4A.1.
//
// What it does (one migration version per step, in the package's fixed order):
//   * reads each file from the Git commit the package is bound to, normalises CRLF to LF, hashes it and requires the working tree to agree;
//   * renders ONE channel-neutral SQL script per version: no BEGIN/COMMIT (the caller supplies one transaction: `psql --single-transaction`, or the single implicit
//     transaction of a multi-statement SQL call), SET LOCAL timeouts, an advisory lock, in-transaction PRE assertions, the exact file SQL, in-transaction POST assertions,
//     the ledger INSERT (version and name of the file, marker + exact SQL text in statements) and a final ledger-count assertion. A failed assertion RAISEs and the whole
//     transaction rolls back, so a ledger row can exist only for SQL that ran and whose postconditions held. The guards therefore live in the database, not in this tool;
//   * PRE: wrong database/role, version already recorded, predecessor missing, package rows not exactly the previous steps, base ledger (rows outside the package) not equal
//     to the approved export, containment not in force, pre-state catalog fingerprint different from the rehearsed one;
//   * POST: catalog fingerprint equal to the rehearsed post-state, containment still in force, RLS on every public table, the version's own boolean rules;
//   * refuses withdrawn, blocked, excluded and never-execute versions (hard-coded and from audit/development-execution-deny.json), and any version that is not a
//     gate-approved October file or a Step 3B file of the Development manifest; "withheld" October files run only when the authorization names them;
//   * writes an append-only hash-chained audit store and a sanitized report; restart reconciles from the ledger, never from memory.
//
// COMMANDS  (all take --package FILE)
//   build   --commit SHA --out FILE            offline: skeleton package from the Development manifest (no database)
//   seal    --db bpc_exec_NAME --template NAME --out FILE   local: rehearse on a fresh scratch clone, record per-step fingerprints, write the sealed package
//   plan | run | verify   --db bpc_exec_NAME --audit-dir DIR --approval-hash HEX --expect-base-count N --expect-base-sha256 HEX     (local scratch)
//   run --target hosted-development --authorization FILE --audit-dir DIR --approval-hash HEX      (hosted; refused unless every authorization check passes)
//   render  --step N --expect-base-count N --expect-base-sha256 HEX     offline: print the exact script for step N
//
// AUTHORIZATION (hosted): a JSON document hashed with document_sha256, never committed with credentials: schema bpc-hosted-dev-authorization/1; project_ref (must be the
// Development ref, never the Production ref); package_sha256; versions (exact list to execute in this authorization); approved_withheld (October versions the owner released);
// base_ledger {count, sha256} from the pre-run export; restore_point {id, taken_at_utc}; approved_by; approved_at; expires_at (at most 48 h after approved_at);
// statement "AUTHORIZE HOSTED DEVELOPMENT EXECUTION". The connection string comes only from the environment variable BPC_HOSTED_DEV_DATABASE_URL at run time.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const FP = require('./lib/fingerprint.cjs');
const LX = require('../local-executor/local-migration-executor.cjs');

const DEV_REF = 'srxunxiytojjsuhcmzjg';
const PROD_REF = 'qaagfafagdpgzcijnfbw';
const PKG_SCHEMA = 'bpc-dev-executor-package/1';
const AUTH_SCHEMA = 'bpc-hosted-dev-authorization/1';
const MARK_PREFIX = '-- BPC-DEV-RECONCILIATION executed';
const BLOCKED = ['20251001052039', '20260125173238', '20260305222010'];
// note: the local executor's 'omitted nine' list belongs to the Production plan; 20261010110000 is a normal executable October file on Development
const NEVER = new Set([...LX.WITHDRAWN, ...BLOCKED, '20260611184401', '20251003170350']);
const OCT_FIRST = '20261007120000', OCT_LAST = '20261025120000', S3B_FIRST = '20261026120000', S3B_LAST = '20261026120400';
const Refusal = LX.Refusal;
const sha256 = LX.sha256;
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const canonical = LX.canonical;
const docHash = (doc, field) => { const c = { ...doc }; delete c[field]; return sha256(Buffer.from(canonical(c), 'utf8')); };
const git = (root, args) => cp.execFileSync('git', ['-C', root, ...args], { maxBuffer: 256 * 1024 * 1024 });

// ------------------------------------------------------------------------------------------------------------------------------------------------
// SQL text scanner: finds top-level transaction control and session-changing statements in a migration file, ignoring comments, quoted text and dollar-quoted bodies
function topLevelStatements(sql) {
  const out = []; let i = 0, cur = ''; const n = sql.length;
  while (i < n) {
    const c = sql[i], c2 = sql.substr(i, 2);
    if (c2 === '--') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c2 === '/*') { let d = 1; i += 2; while (i < n && d) { if (sql.substr(i, 2) === '/*') { d++; i += 2; } else if (sql.substr(i, 2) === '*/') { d--; i += 2; } else i++; } continue; }
    if (c === "'") { cur += c; i++; while (i < n) { cur += sql[i]; if (sql[i] === "'") { if (sql[i + 1] === "'") { cur += "'"; i += 2; continue; } i++; break; } i++; } continue; }
    if (c === '"') { cur += c; i++; while (i < n && sql[i] !== '"') { cur += sql[i]; i++; } cur += '"'; i++; continue; }
    if (c === '$') { const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i)); if (m) { const tag = m[0]; const e = sql.indexOf(tag, i + tag.length); if (e < 0) throw new Refusal('unterminated dollar-quoted text'); cur += ' <body> '; i = e + tag.length; continue; } }
    if (c === ';') { out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}
const FORBIDDEN_RX = /^(begin|start\s+transaction|commit|rollback|abort|end\s*$|savepoint|release|prepare\s+transaction|set\s+role|set\s+session\s+authorization|reset\s+(all|role|session)|set\s+(session\s+)?search_path|set\s+(session\s+)?default_transaction|set\s+transaction|vacuum|create\s+database|alter\s+system|create\s+index\s+concurrently|drop\s+index\s+concurrently|copy\s)/i;
function forbiddenStatements(sql) { return topLevelStatements(sql).filter((s) => FORBIDDEN_RX.test(s)).map((s) => s.slice(0, 60)); }

// ------------------------------------------------------------------------------------------------------------------------------------------------
// package
function loadPackage(file) {
  let pkg; try { pkg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Refusal('package is not valid JSON'); }
  validatePackage(pkg);
  return pkg;
}
function validatePackage(pkg, { sealedRequired = true } = {}) {
  if (pkg.schema !== PKG_SCHEMA) throw new Refusal('unknown package schema');
  if (!/^[0-9a-f]{40}$/.test(pkg.commit || '')) throw new Refusal('package is not bound to a full git commit hash');
  if (docHash(pkg, 'document_sha256') !== pkg.document_sha256) throw new Refusal('package document hash does not match its content (modified package)', 'package-hash');
  if (!Array.isArray(pkg.items) || !pkg.items.length) throw new Refusal('package has no items');
  const seen = new Set(); let prev = '';
  pkg.items.forEach((it, k) => {
    if (!/^\d{14}$/.test(it.version) || seen.has(it.version)) throw new Refusal(`bad or duplicate version ${it.version}`);
    seen.add(it.version);
    if (it.version <= prev) throw new Refusal(`items are not in strictly increasing version order at ${it.version}`, 'order');
    prev = it.version;
    if (it.order !== k + 1) throw new Refusal(`item ${it.version} has a wrong order number`, 'order');
    if (NEVER.has(it.version) || (pkg.deny || []).includes(it.version)) throw new Refusal(`version ${it.version} is withdrawn, blocked, excluded or never-execute`, 'deny');
    const inOct = it.version >= OCT_FIRST && it.version <= OCT_LAST, inS3b = it.version >= S3B_FIRST && it.version <= S3B_LAST;
    if (!inOct && !inS3b) throw new Refusal(`version ${it.version} is neither an October gate file nor a Step 3B file`, 'scope');
    if (it.class !== (inOct ? 'withheld-gate' : 'step3b')) throw new Refusal(`version ${it.version} has class ${it.class}`, 'scope');
    if (!String(it.file || '').startsWith(it.version + '_')) throw new Refusal(`file ${it.file} does not belong to version ${it.version}`, 'version-file');
    if (!/^[0-9a-f]{64}$/.test(it.sha256_lf || '')) throw new Refusal(`missing LF hash for ${it.version}`);
    for (const r of it.requires || []) if (!seen.has(r) || r === it.version) throw new Refusal(`${it.version} requires ${r}, which is not an earlier item`, 'dependency');
    if (sealedRequired) {
      if (!/^[0-9a-f]{32}$/.test(it.pre_fp_all || '') || !/^[0-9a-f]{32}$/.test(it.post_fp_all || '')) throw new Refusal(`package is not sealed: item ${it.version} lacks fingerprints`, 'unsealed');
      if (k > 0 && it.pre_fp_all !== pkg.items[k - 1].post_fp_all) throw new Refusal(`fingerprint chain broken at ${it.version}`, 'fp-chain');
    }
  });
  for (const d of ['20260305203528', '20260407203226', '20260407211122']) if (!(pkg.deny || []).includes(d)) throw new Refusal(`deny list must contain ${d}`);
}
function sealHash(pkg) { pkg.document_sha256 = docHash(pkg, 'document_sha256'); return pkg; }

function readFiles(pkg, repoRoot) {
  try { git(repoRoot, ['cat-file', '-e', pkg.commit + '^{commit}']); } catch (e) { throw new Refusal(`commit ${pkg.commit} is not in the repository`); }
  const dir = pkg.migrations_dir || 'supabase/migrations';
  const content = new Map();
  for (const it of pkg.items) {
    let b; try { b = git(repoRoot, ['show', `${pkg.commit}:${dir}/${it.file}`]); } catch (e) { throw new Refusal(`file ${it.file} is not in commit ${pkg.commit.slice(0, 10)}`); }
    const lf = LX.normalizeLF(b);
    if (sha256(lf) !== it.sha256_lf) throw new Refusal(`file ${it.file}: content in the bound commit does not match the package hash`, 'hash');
    const wt = path.join(repoRoot, dir, it.file);
    if (!fs.existsSync(wt)) throw new Refusal(`file ${it.file} is missing from the working tree`, 'hash');
    if (sha256(LX.normalizeLF(fs.readFileSync(wt))) !== it.sha256_lf) throw new Refusal(`file ${it.file}: working tree differs from the bound commit`, 'hash');
    const text = lf.toString('utf8');
    if (text.includes('$bpcsql$')) throw new Refusal(`file ${it.file} contains the executor's quoting tag`, 'quote');
    const bad = forbiddenStatements(text);
    if (bad.length) throw new Refusal(`file ${it.file} contains statements that break the single-transaction guarantee or change the session: ${bad.join(' | ')}`, 'txn-control');
    content.set(it.version, text);
  }
  return content;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// script rendering
const GLOBAL_POST_RULES = [
  { id: 'rls-on-every-public-table', sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)" },
];
const CONTAINED = "NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')";
function markerOf(pkg, it, total) {
  return `${MARK_PREFIX}; executor=bpc-dev-executor/1; batch=X-${it.class === 'step3b' ? 'S3B' : 'OCT'}; step=${it.order}/${total}; version=${it.version}; package_sha256=${pkg.document_sha256}; sha256_lf=${it.sha256_lf}`;
}
const ledgerName = (file) => file.slice(15).replace(/\.sql(\.sql)?$/, '');
function renderStep(pkg, it, sql, ctx) {
  const total = pkg.items.length;
  const prior = pkg.items.filter((x) => x.order < it.order).map((x) => x.version);
  const all = pkg.items.map((x) => x.version);
  const arr = (a) => (a.length ? 'ARRAY[' + a.map(lit).join(',') + ']::text[]' : 'ARRAY[]::text[]');
  const reqs = [...new Set([...(it.requires || []), ...(it.external_requires || [])])];
  const stmtMs = Number(ctx.statementMs || it.statement_ms || 120000);
  const capture = !!ctx.capture;
  const fpCheck = (label, expected) => capture ? '' : `
  IF fp_all IS DISTINCT FROM ${lit(expected)} THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for ${it.version} (expected ${expected}, observed %), categories: %', ${lit(label)}, fp_all, fp USING ERRCODE = 'P0001'; END IF;`;
  const rules = [...GLOBAL_POST_RULES, ...(it.post_rules || [])];
  const L = [];
  L.push(`-- BPC-DEV-EXECUTOR step ${it.order}/${total}; version ${it.version}; file ${it.file}; sha256_lf ${it.sha256_lf}; package ${pkg.document_sha256}`);
  L.push(`SET LOCAL lock_timeout = '${Number(ctx.lockMs || 5000)}ms';`, `SET LOCAL statement_timeout = '${stmtMs}ms';`, `SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));`);
  if (ctx.emulateRole) L.push(`SET LOCAL ROLE ${'"' + String(ctx.emulateRole).replace(/"/g, '') + '"'};`);
  L.push(`DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> ${lit(ctx.expectDb)} THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> ${lit(ctx.expectRole)} THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${lit(it.version)}) THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: ${it.version}'; END IF;
  IF ${reqs.length ? `(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(${arr(reqs)})) <> ${reqs.length}` : 'false'} THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for ${it.version}'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(${arr(all)}) AND version <> ALL(${arr(prior)});
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(${arr(prior)}) AND statements[1] LIKE ${lit(MARK_PREFIX + '; executor=bpc-dev-executor/1;%')};
  IF v_n <> ${prior.length} THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
  SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(version, E'\\n' ORDER BY version), ''), 'UTF8')), 'hex') INTO v_n, v_h FROM supabase_migrations.schema_migrations WHERE version <> ALL(${arr(all)});
  IF v_n <> ${Number(ctx.baseCount)} OR v_h <> ${lit(ctx.baseSha)} THEN RAISE EXCEPTION 'BPC-EXECUTOR: ledger outside the package differs from the approved export (% rows, hash %)', v_n, v_h; END IF;
  ${pkg.containment === 'on' ? `IF NOT (${CONTAINED}) THEN RAISE EXCEPTION 'BPC-EXECUTOR: schema containment is not in force'; END IF;` : ''}
${FP.PLPGSQL_COMPUTE}${fpCheck('pre', it.pre_fp_all)}
END $bpcpre$;`);
  L.push('-- exact file ' + it.file, sql.replace(/\n+$/, ''), ';');
  L.push(`DO $bpcpost$
DECLARE fp jsonb; fp_all text; old_sp text;
BEGIN
${FP.PLPGSQL_COMPUTE}${fpCheck('post', it.post_fp_all)}
  ${pkg.containment === 'on' ? `IF NOT (${CONTAINED}) THEN RAISE EXCEPTION 'BPC-EXECUTOR: ${it.version} left the schema uncontained'; END IF;` : ''}
${rules.map((r) => `  IF NOT COALESCE((${r.sql}), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for ${it.version}: ${r.id}'; END IF;`).join('\n')}
END $bpcpost$;`);
  L.push(`INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES (${lit(it.version)}, ${lit(ledgerName(it.file))}, ARRAY[${lit(markerOf(pkg, it, total))}, $bpcsql$${sql}$bpcsql$]);`);
  L.push(`DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> ${Number(ctx.baseCount) + it.order} THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after ${it.version}'; END IF;
END $bpcend$;`);
  return L.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// transports
function psqlBin() { return process.env.BPC_PSQL || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe'; }
function localTransport(opts) {
  const base = ['-X', '-q', '-w', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(opts.port), '-U', 'postgres', '-d', opts.db];
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, PGCLIENTENCODING: 'UTF8', PGSSLMODE: 'disable' };
  return {
    kind: 'local', db: opts.db, role: 'postgres',
    run(sql, { readOnly = false, singleTransaction = false, timeoutMs } = {}) {
      const e = { ...env }; if (readOnly) e.PGOPTIONS = '-c default_transaction_read_only=on';
      const args = [...base, ...(singleTransaction ? ['-1'] : []), '-f', '-'];
      const r = cp.spawnSync(psqlBin(), args, { input: sql, encoding: 'utf8', env: e, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
      if (r.error && r.error.code !== 'ETIMEDOUT') throw new Error('psql could not be started: ' + String(r.error.message).slice(0, 120));
      return { code: r.error ? 137 : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), killed: !!r.error };
    },
  };
}
function parseHostedUrl(raw) {
  let u; try { u = new URL(raw); } catch (e) { throw new Refusal('BPC_HOSTED_DEV_DATABASE_URL is not a valid URL', 'hosted-guard'); }
  const hostOk = u.hostname === `db.${DEV_REF}.supabase.co` || (/\.pooler\.supabase\.com$/.test(u.hostname) && decodeURIComponent(u.username) === `postgres.${DEV_REF}`);
  if (!hostOk) throw new Refusal('the connection host/user does not identify the Development project', 'hosted-guard');
  if (raw.includes(PROD_REF)) throw new Refusal('the connection string names the Production project', 'hosted-guard');
  if (u.searchParams.get('sslmode') !== 'require') throw new Refusal('the hosted connection must set sslmode=require', 'hosted-guard');
  return u;
}
function hostedTransport(raw) {
  const u = parseHostedUrl(raw);
  const user = decodeURIComponent(u.username);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, PGCLIENTENCODING: 'UTF8', PGSSLMODE: 'require', PGPASSWORD: decodeURIComponent(u.password) };
  const base = ['-X', '-q', '-w', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', u.hostname, '-p', u.port || '5432', '-U', user, '-d', (u.pathname || '/postgres').slice(1) || 'postgres'];
  return {
    kind: 'hosted', db: 'postgres', role: 'postgres',
    run(sql, { readOnly = false, singleTransaction = false } = {}) {
      const e = { ...env }; if (readOnly) e.PGOPTIONS = '-c default_transaction_read_only=on';
      const r = cp.spawnSync(psqlBin(), [...base, ...(singleTransaction ? ['-1'] : []), '-f', '-'], { input: sql, encoding: 'utf8', env: e, maxBuffer: 64 * 1024 * 1024 });
      if (r.error) throw new Error('psql could not be started');
      return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
    },
  };
}
const ro = (tx, sql) => { const r = tx.run(sql, { readOnly: true }); if (r.code !== 0) throw new Error(r.err.slice(0, 400) || 'psql failed'); return r.out; };

function readLedger(tx) {
  const out = ro(tx, "select version || E'\\t' || coalesce(name,'') || E'\\t' || coalesce(statements[1],'') || E'\\t' || coalesce(encode(sha256(convert_to(statements[2],'UTF8')),'hex'),'') from supabase_migrations.schema_migrations order by version");
  const m = new Map();
  for (const line of out.split(/\r?\n/).filter(Boolean)) { const [version, name, marker, textSha] = line.split('\t'); m.set(version, { name, marker: marker || '', textSha: (textSha || '').trim() }); }
  return m;
}
const baseOf = (led, pkg) => { const all = new Set(pkg.items.map((i) => i.version)); const v = [...led.keys()].filter((x) => !all.has(x)).sort(); return { count: v.length, sha: sha256(Buffer.from(v.join('\n'), 'utf8')) }; };
function captureFingerprint(tx) { const rr = tx.run(FP.READ_ONLY_STATEMENT, { readOnly: true, singleTransaction: true }); if (rr.code !== 0) throw new Error(rr.err.slice(0, 300) || 'fingerprint query failed'); const out = rr.out; // SET LOCAL only takes effect inside a transaction block
  const rows = out.split(/\r?\n/).filter((l) => l.includes('|')); const cats = {}; for (const l of rows) { const [k, d, n] = l.split('|'); cats[k] = `${d}/${n}`; } const all = crypto.createHash('md5').update(Object.keys(cats).sort().map((k) => `${k}:${cats[k].split('/')[0]}:${cats[k].split('/')[1]}`).join(',')).digest('hex'); return { cats, all }; }
const containedNow = (tx) => ro(tx, `select ${CONTAINED}`) === 't';
// proves containment from the caller's side: as `anon` / `authenticated` the schema must be unreachable. Reads nothing when denied (the statement fails at the schema check).
function roleProbe(tx, role) {
  const r = tx.run(`SET LOCAL ROLE ${role}; SELECT 1 FROM public.orders LIMIT 1;`, { singleTransaction: true });
  if (r.code !== 0 && /permission denied for schema public/.test(r.err)) return 'denied';
  return r.code === 0 ? 'ALLOWED' : 'other-error';
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// audit store (append-only, hash chained)
class Audit {
  constructor(dir, runId) { this.dir = dir; this.file = path.join(dir, 'audit.jsonl'); this.runId = runId; fs.mkdirSync(dir, { recursive: true }); this.state = this.verify(); }
  verify() {
    let prev = '0'.repeat(64), seq = 0; const recs = [];
    if (fs.existsSync(this.file)) for (const line of fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean)) {
      let r; try { r = JSON.parse(line); } catch (e) { throw new Refusal('audit store contains a line that is not valid JSON', 'audit'); }
      const { hash, ...rest } = r;
      if (r.prev !== prev || sha256(Buffer.from(canonical(rest), 'utf8')) !== hash) throw new Refusal(`audit store chain broken at seq ${r.seq}`, 'audit');
      prev = hash; seq = r.seq; recs.push(r);
    }
    return { prev, seq, recs };
  }
  add(event, data) { const rest = { seq: this.state.seq + 1, ts: new Date().toISOString(), run: this.runId, event, ...data, prev: this.state.prev }; const hash = sha256(Buffer.from(canonical(rest), 'utf8')); fs.appendFileSync(this.file, JSON.stringify({ ...rest, hash }) + '\n'); this.state.prev = hash; this.state.seq = rest.seq; this.state.recs.push({ ...rest, hash }); }
  has(event, version, extra) { return this.state.recs.some((r) => r.event === event && r.version === version && (!extra || Object.entries(extra).every(([k, v]) => r[k] === v))); }
  head() { return { audit_head: this.state.prev, audit_records: this.state.seq }; }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// authorization (hosted)
function checkAuthorization(auth, pkg, now = new Date()) {
  if (!auth || auth.schema !== AUTH_SCHEMA) throw new Refusal('hosted authorization missing or of unknown schema', 'authorization');
  if (docHash(auth, 'document_sha256') !== auth.document_sha256) throw new Refusal('authorization document hash does not match its content', 'authorization');
  if (auth.statement !== 'AUTHORIZE HOSTED DEVELOPMENT EXECUTION') throw new Refusal('authorization statement is not the required text', 'authorization');
  if (auth.project_ref === PROD_REF) throw new Refusal('the authorization names the Production project', 'hosted-guard');
  if (auth.project_ref !== DEV_REF) throw new Refusal('the authorization does not name the Development project', 'hosted-guard');
  if (auth.package_sha256 !== pkg.document_sha256) throw new Refusal('the authorization is for a different package', 'authorization');
  for (const f of ['approved_by', 'approved_at', 'expires_at']) if (!auth[f]) throw new Refusal(`authorization lacks ${f}`, 'authorization');
  const a = Date.parse(auth.approved_at), e = Date.parse(auth.expires_at);
  if (!(a < e) || e - a > 48 * 3600 * 1000) throw new Refusal('authorization window is invalid or longer than 48 hours', 'authorization');
  if (now.getTime() > e) throw new Refusal('the authorization has expired', 'authorization');
  if (now.getTime() < a) throw new Refusal('the authorization is not yet valid', 'authorization');
  if (!auth.restore_point || !auth.restore_point.id || !(Date.parse(auth.restore_point.taken_at_utc) <= a)) throw new Refusal('authorization lacks a restore point taken before approval', 'authorization');
  if (!auth.base_ledger || !Number.isInteger(auth.base_ledger.count) || !/^[0-9a-f]{64}$/.test(auth.base_ledger.sha256 || '')) throw new Refusal('authorization lacks the base ledger export identity', 'authorization');
  const known = new Set(pkg.items.map((i) => i.version));
  if (!Array.isArray(auth.versions) || !auth.versions.length || auth.versions.some((v) => !known.has(v))) throw new Refusal('authorization lists versions that are not in the package', 'authorization');
  const wanted = pkg.items.filter((i) => i.class === 'withheld-gate' && auth.versions.includes(i.version)).map((i) => i.version);
  for (const v of wanted) if (!(auth.approved_withheld || []).includes(v)) throw new Refusal(`withheld October version ${v} is not released by the authorization`, 'withheld');
  // the authorized set must be a contiguous run of the package starting at the first not-yet-recorded step
  const idx = auth.versions.map((v) => pkg.items.findIndex((i) => i.version === v)).sort((x, y) => x - y);
  if (idx.some((v, k) => k > 0 && v !== idx[k - 1] + 1)) throw new Refusal('authorized versions are not a contiguous run of the package', 'authorization');
  return true;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
const VALUE_OPTS = new Set(['package', 'commit', 'out', 'db', 'template', 'port', 'repo-root', 'audit-dir', 'approval-hash', 'expect-base-count', 'expect-base-sha256', 'stop-after', 'step', 'target', 'authorization', 'statement-timeout-ms', 'lock-timeout-ms', 'emulate-hosted-role', 'from-step', 'to-step', 'report']);
const FLAG_OPTS = new Set(['json', 'no-fingerprint']);
function parseArgs(argv) {
  const cmd = argv[0];
  if (!['build', 'seal', 'plan', 'run', 'verify', 'render'].includes(cmd)) throw new Refusal('first argument must be build, seal, plan, run, verify or render');
  const o = { cmd };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith('--')) throw new Refusal(`unexpected argument: ${a.slice(0, 40)}`);
    const k = a.slice(2);
    if (FLAG_OPTS.has(k)) { o[k] = true; continue; }
    if (!VALUE_OPTS.has(k)) throw new Refusal(`option not accepted: --${k.slice(0, 30)} (credentials never come from options)`);
    if (i + 1 >= argv.length) throw new Refusal(`--${k} needs a value`);
    o[k] = argv[++i];
  }
  return o;
}

// build: skeleton package from the Development manifest at a commit (no database)
function buildSkeleton(repoRoot, commit) {
  const csv = git(repoRoot, ['show', `${commit}:audit/development-migration-manifest.csv`]).toString('utf8').replace(/\r\n/g, '\n');
  const lines = csv.split('\n').filter(Boolean); const head = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => { const c = parseCsvLine(l); return Object.fromEntries(head.map((h, i) => [h, c[i]])); });
  const deny = JSON.parse(git(repoRoot, ['show', `${commit}:audit/development-execution-deny.json`]).toString('utf8'));
  const rules = JSON.parse(git(repoRoot, ['show', `${commit}:audit/security/step3b-verification-rules.json`]).toString('utf8'));
  const take = rows.filter((r) => r.version >= OCT_FIRST && r.version <= S3B_LAST && /^(Withheld for the October|Step 3B corrective SQL)/.test(r.proposed_disposition)).sort((a, b) => a.version.localeCompare(b.version));
  const items = take.map((r, k) => {
    if (NEVER.has(r.version) || [...deny.blocked_no_safe_rule.versions, ...deny.withdrawn.versions, ...deny.excluded_pending_owner.versions, ...deny.never_sql_execute.versions].includes(r.version)) throw new Refusal(`deny list covers ${r.version}`);
    const cls = r.version <= OCT_LAST ? 'withheld-gate' : 'step3b';
    const lf = LX.normalizeLF(git(repoRoot, ['show', `${commit}:supabase/migrations/${r.filename_or_archived_source}`]));
    const it = { order: k + 1, version: r.version, file: r.filename_or_archived_source, name: ledgerName(r.filename_or_archived_source), sha256_lf: sha256(lf), class: cls, requires: k ? [take[k - 1].version] : [], external_requires: [], statement_ms: 120000, post_rules: [] };
    const sr = rules[r.version]; if (sr && sr.post_effect_present) it.post_rules.push({ id: 'step3b-post-effect-present', sql: sr.post_effect_present.replace(/;\s*$/, '') });
    return it;
  });
  return { schema: PKG_SCHEMA, commit, migrations_dir: 'supabase/migrations', purpose: 'hosted Development: 23 October gate files and 5 Step 3B files, exact versions', containment: 'on', deny: [...deny.withdrawn.versions, ...deny.blocked_no_safe_rule.versions, ...deny.excluded_pending_owner.versions, ...deny.never_sql_execute.versions], items };
}
function parseCsvLine(line) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }

function localTarget(opts, env) {
  const mark = LX.assertLocalTarget({ ...opts, db: opts.db }, env, '');
  const tx = localTransport({ db: opts.db, port: mark.port });
  const info = ro(tx, "select coalesce(host(inet_server_addr()),'') || '|' || current_database() || '|' || coalesce((select shobj_description(oid,'pg_database') from pg_database where datname=current_database()),'') || '|' || coalesce((select ssl::text from pg_stat_ssl where pid=pg_backend_pid()),'f')").split('|');
  LX.assertServerIsScratch([info[0], info[1], info[2], info[3] === 'true' ? 't' : 'f'], opts.db);
  return tx;
}
function crashHook(env, target) { const h = env.BPC_EXECUTOR_TEST_HOOK; return target === 'local' && h ? h : ''; }

function main(argv, env) {
  const opts = parseArgs(argv);
  const repoRoot = path.resolve(opts['repo-root'] || path.join(__dirname, '..', '..', '..'));
  if (opts.cmd === 'build') { if (!opts.commit || !opts.out) throw new Refusal('--commit and --out are required'); const pkg = sealHash(buildSkeleton(repoRoot, opts.commit)); fs.writeFileSync(opts.out, JSON.stringify(pkg, null, 1) + '\n'); return { ok: true, command: 'build', items: pkg.items.length, package_sha256: pkg.document_sha256, sealed: false }; }
  if (!opts.package) throw new Refusal('--package is required');
  const raw = JSON.parse(fs.readFileSync(opts.package, 'utf8'));
  if (opts.cmd === 'seal') return sealPackage(opts, env, raw, repoRoot);
  const pkg = loadPackage(opts.package);
  const files = readFiles(pkg, repoRoot);
  if (opts.cmd === 'render') {
    const it = pkg.items[Number(opts.step) - 1]; if (!it) throw new Refusal('--step must name a package step');
    const emu = opts['emulate-hosted-role'] || ''; return { ok: true, command: 'render', script: renderStep(pkg, it, files.get(it.version), { expectDb: opts.db || 'postgres', expectRole: emu || 'postgres', baseCount: Number(opts['expect-base-count']), baseSha: opts['expect-base-sha256'], emulateRole: emu, capture: !!emu || !!opts['no-fingerprint'] }) };
  }
  for (const r of ['audit-dir', 'approval-hash', 'expect-base-count', 'expect-base-sha256']) if (!opts[r] && opts.cmd !== 'plan') throw new Refusal(`--${r} is required`);
  const hosted = opts.target === 'hosted-development';
  let tx, auth = null;
  if (hosted) {
    if (opts.cmd !== 'run' && opts.cmd !== 'verify') throw new Refusal('hosted target supports only run and verify');
    if (!opts.authorization) throw new Refusal('--authorization is required for a hosted target', 'authorization');
    auth = JSON.parse(fs.readFileSync(opts.authorization, 'utf8'));
    checkAuthorization(auth, pkg);
    if (opts['approval-hash'] !== auth.document_sha256) throw new Refusal('--approval-hash must equal the authorization document hash (typed approval)', 'approval');
    if (Number(opts['expect-base-count']) !== auth.base_ledger.count || opts['expect-base-sha256'] !== auth.base_ledger.sha256) throw new Refusal('base ledger options differ from the authorization', 'authorization');
    if (!env.BPC_HOSTED_DEV_DATABASE_URL) throw new Refusal('BPC_HOSTED_DEV_DATABASE_URL is not set', 'hosted-guard');
    tx = hostedTransport(env.BPC_HOSTED_DEV_DATABASE_URL);
  } else {
    if (opts.target && opts.target !== 'local-scratch') throw new Refusal('unknown target', 'hosted-guard');
    if (opts.authorization) throw new Refusal('an authorization document is only valid for the hosted target', 'authorization');
    if (opts.cmd !== 'plan' && opts['approval-hash'] !== pkg.document_sha256) throw new Refusal('--approval-hash must equal the package document hash (typed approval)', 'approval');
    tx = localTarget(opts, env);
  }
  return execute(opts, env, pkg, files, tx, auth, hosted);
}

// TEST-ONLY (local target only, via BPC_EXECUTOR_TEST_HOOK=mutate:NAME): removes one guard line from the rendered script so the rehearsal can prove that guard is load-bearing
const MUTANTS = {
  'no-version-check': (l) => l.includes('version already recorded'),
  'no-base-check': (l) => l.includes('differs from the approved export'),
  'no-containment-check': (l) => l.includes('schema containment is not in force') || l.includes('left the schema uncontained'),
  'no-pre-fingerprint': (l) => l.includes('catalog fingerprint mismatch') && l.includes("'pre'"),
  'no-post-fingerprint': (l) => l.includes('catalog fingerprint mismatch') && l.includes("'post'"),
  'no-count-check': (l) => l.includes('unexpected ledger count'),
  'no-predecessor-check': (l) => l.includes('earlier package steps are not all recorded'),
  'no-requires-check': (l) => l.includes('predecessor not recorded'),
};
function mutateScript(script, names) {
  const list = String(names).split('+');
  if (list.length > 1) return list.reduce((acc, n) => mutateScript(acc, n), script);
  const name = list[0];
  if (!MUTANTS[name]) throw new Refusal('unknown mutant');
  const nl = String.fromCharCode(10);
  const lines = script.split(nl); const kept = lines.filter((l) => !MUTANTS[name](l));
  if (kept.length === lines.length) throw new Refusal(`mutant ${name} did not change the script (pattern out of date)`);
  return kept.join(nl);
}

// sanitized execution report: ledger identity before and after (counts and hashes of version lists), the new versions, the steps with fingerprints and probes. No SQL text, no connection data.
function writeReport(file, pkg, hosted, cmd, ledBefore, ledAfter, result, audit) {
  const ident = (led) => { const v = [...led.keys()].sort(); return { rows: v.length, versions_sha256: sha256(Buffer.from(v.join(String.fromCharCode(10)), 'utf8')) }; };
  const modified = [...ledBefore.keys()].filter((v) => !ledAfter.has(v) || ledAfter.get(v).marker !== ledBefore.get(v).marker || ledAfter.get(v).textSha !== ledBefore.get(v).textSha || ledAfter.get(v).name !== ledBefore.get(v).name).sort();
  const steps = audit.state.recs.filter((r) => r.run === audit.runId && r.event === 'step_end').map((r) => ({ version: r.version, sha256_lf: r.sha256_lf, fingerprint: r.fingerprint, probes: r.probes }));
  const report = { schema: 'bpc-dev-executor-report/1', generated_utc: new Date().toISOString(), package_sha256: pkg.document_sha256, commit: pkg.commit, target: hosted ? 'hosted-development' : 'local-scratch', command: cmd,
    result: { ok: result.ok, executed: result.executed, reconciled: result.reconciled, failed: result.failed, stopped_after: result.stopped_after }, ledger_before: ident(ledBefore), ledger_after: ident(ledAfter),
    new_versions: [...ledAfter.keys()].filter((v) => !ledBefore.has(v)).sort(), pre_existing_rows_modified_or_removed: modified, steps, audit_head: audit.head() };
  fs.writeFileSync(file, JSON.stringify(report, null, 1) + String.fromCharCode(10));
}

function execute(opts, env, pkg, files, tx, auth, hosted) {
  const runId = crypto.randomBytes(6).toString('hex');
  const auditDir = opts['audit-dir'] || path.join(require('os').tmpdir(), 'bpc-exec-plan-' + runId);
  const audit = new Audit(auditDir, runId);
  const refuse = (e) => { audit.add('refused', { reason: e.message.slice(0, 300), code: e.code }); throw e; };
  const total = pkg.items.length;
  const hook = crashHook(env, hosted ? 'hosted' : 'local');
  let led;
  try {
    led = readLedger(tx);
    const mine = new Map(); // package rows recorded in the ledger
    for (const it of pkg.items) {
      const row = led.get(it.version); if (!row) continue;
      if (!row.marker.startsWith(MARK_PREFIX + '; executor=bpc-dev-executor/1;')) throw new Refusal(`ledger row ${it.version} was not written by this executor`, 'ledger');
      if (!row.marker.includes(`sha256_lf=${it.sha256_lf}`) || row.textSha !== it.sha256_lf) throw new Refusal(`ledger row ${it.version} carries a different file hash than the package`, 'ledger');
      if (!row.marker.includes(`package_sha256=${pkg.document_sha256}`)) throw new Refusal(`ledger row ${it.version} was written by a different package`, 'ledger');
      if (row.name !== ledgerName(it.file)) throw new Refusal(`ledger row ${it.version} has an unexpected name`, 'ledger');
      mine.set(it.version, row);
    }
    // recorded versions must be a prefix of the package order
    const done = pkg.items.filter((i) => mine.has(i.version)).length;
    if (pkg.items.slice(0, done).some((i) => !mine.has(i.version))) throw new Refusal('recorded package versions are not a prefix of the package order', 'ledger');
    var doneCount = done;
  } catch (e) { if (e.refusal) refuse(e); throw e; }
  const base = baseOf(led, pkg);
  if (opts.cmd === 'plan') {
    audit.add('plan', { remaining: total - doneCount });
    return { ok: true, command: 'plan', package_sha256: pkg.document_sha256, steps_total: total, steps_recorded: doneCount, remaining: pkg.items.slice(doneCount).map((i) => i.version), observed_base_count: base.count, observed_base_sha256: base.sha, containment_in_force: containedNow(tx), ...audit.head() };
  }
  const wantCount = Number(opts['expect-base-count']), wantSha = opts['expect-base-sha256'];
  if (base.count !== wantCount || base.sha !== wantSha) refuse(new Refusal(`the ledger outside the package (${base.count} rows) differs from the approved export (${wantCount})`, 'ledger'));
  if (opts.cmd === 'verify') {
    const missing = pkg.items.slice(doneCount).map((i) => i.version);
    let fpOk = null; if (!missing.length) { const f = captureFingerprint(tx); fpOk = f.all === pkg.items[total - 1].post_fp_all; }
    audit.add('verify', { missing: missing.length, fingerprint_matches_final: fpOk });
    return { ok: missing.length === 0 && fpOk === true, command: 'verify', missing, fingerprint_matches_final: fpOk, ...audit.head() };
  }
  // run
  const fromIdx = doneCount; let toIdx = total;
  if (hosted) { const last = Math.max(...auth.versions.map((v) => pkg.items.findIndex((i) => i.version === v))); const first = Math.min(...auth.versions.map((v) => pkg.items.findIndex((i) => i.version === v))); if (first !== fromIdx) refuse(new Refusal('the authorized run does not start at the first unrecorded step', 'authorization')); toIdx = last + 1; }
  if (opts['stop-after']) { const s = pkg.items.findIndex((i) => i.version === opts['stop-after']); if (s < 0) refuse(new Refusal('--stop-after must name a package version')); toIdx = Math.min(toIdx, s + 1); }
  const lockFile = path.join(auditDir, 'run.lock');
  if (fs.existsSync(lockFile)) { const pid = Number(fs.readFileSync(lockFile, 'utf8')); let alive = false; try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } if (alive) refuse(new Refusal(`another executor (pid ${pid}) holds the audit-store lock`, 'lock')); audit.add('stale_lock_cleared', { pid }); }
  const ledStart = new Map(led);
  fs.writeFileSync(lockFile, String(process.pid));
  const starts = audit.state.recs.filter((r) => r.event === 'run_start'); if (starts.length) { const last = starts[starts.length - 1].run; if (!audit.state.recs.some((r) => r.event === 'run_end' && r.run === last)) audit.add('prior_run_incomplete', { prior_run: last }); }
  const result = { ok: true, command: 'run', run: runId, executed: [], reconciled: [], failed: null, stopped_after: null };
  audit.add('run_start', { package_sha256: pkg.document_sha256, target: hosted ? 'hosted-development' : 'local-scratch', from: pkg.items[fromIdx] && pkg.items[fromIdx].version, to: pkg.items[toIdx - 1] && pkg.items[toIdx - 1].version });
  try {
    for (const it of pkg.items.slice(0, doneCount)) if (!audit.has('step_end', it.version)) { audit.add('step_end', { version: it.version, reconciled_after_crash: true }); result.reconciled.push(it.version); }
    for (let k = fromIdx; k < toIdx; k++) {
      const it = pkg.items[k];
      audit.add('step_start', { version: it.version, order: it.order, sha256_lf: it.sha256_lf });
      const emu = !hosted && opts['emulate-hosted-role'] ? opts['emulate-hosted-role'] : '';
      let script = renderStep(pkg, it, files.get(it.version), { expectDb: tx.db, expectRole: emu || tx.role, baseCount: wantCount, baseSha: wantSha, statementMs: opts['statement-timeout-ms'], lockMs: opts['lock-timeout-ms'], emulateRole: emu, capture: !!emu });
      const mut = /^mutate:([a-z+-]+)$/.exec(hook); if (mut) script = mutateScript(script, mut[1]);
      const killMs = /^kill-psql:(\d+):(\d{14})$/.exec(hook); const timeoutMs = killMs && killMs[2] === it.version ? Number(killMs[1]) : undefined;
      const r = tx.run(script, { singleTransaction: true, timeoutMs });
      if (hook === 'crash-after-commit:' + it.version && r.code === 0) process.exit(9);
      if (r.code !== 0) {
        const err = ((r.err.match(/ERROR:\s+(.*)/) || [null, r.err])[1] || '').slice(0, 300);
        const after = readLedger(tx);
        const recorded = after.has(it.version);
        audit.add('step_failed', { version: it.version, error: err, ledger_row_present: recorded, killed: !!r.killed });
        result.ok = false; result.failed = { version: it.version, error: err, ledger_row_present: recorded };
        if (recorded) result.failed.note = 'the connection ended after the transaction may have committed: verify before any further run';
        break;
      }
      led = readLedger(tx);
      const row = led.get(it.version);
      if (!row || !row.marker.includes(`sha256_lf=${it.sha256_lf}`) || row.textSha !== it.sha256_lf || row.name !== ledgerName(it.file)) throw new Error(`ledger row for ${it.version} missing or different after commit`);
      const f = captureFingerprint(tx);
      if (f.all !== it.post_fp_all) { audit.add('step_failed', { version: it.version, error: 'post-commit fingerprint differs', categories: f.cats }); result.ok = false; result.failed = { version: it.version, error: 'post-commit fingerprint differs from the rehearsed state (committed; investigate before continuing)' }; break; }
      if (pkg.containment === 'on' && !containedNow(tx)) { audit.add('step_failed', { version: it.version, error: 'containment not in force after commit' }); result.ok = false; result.failed = { version: it.version, error: 'containment not in force after commit' }; break; }
      const probes = pkg.containment === 'on' ? { anon: roleProbe(tx, 'anon'), authenticated: roleProbe(tx, 'authenticated') } : null;
      if (probes && (probes.anon !== 'denied' || probes.authenticated !== 'denied')) { audit.add('step_failed', { version: it.version, error: 'role probe was not denied', probes }); result.ok = false; result.failed = { version: it.version, error: 'a role probe on public.orders was not denied after commit (committed; investigate before continuing)' }; break; }
      audit.add('step_end', { version: it.version, sha256_lf: it.sha256_lf, fingerprint: f.all, probes });
      result.executed.push(it.version);
      if (opts['stop-after'] === it.version) result.stopped_after = it.version;
    }
    audit.add('run_end', { ok: result.ok, executed: result.executed.length, failed: result.failed && result.failed.version });
  } catch (e) { if (e.refusal) audit.add('refused', { reason: e.message.slice(0, 300), code: e.code }); throw e; } finally { try { fs.unlinkSync(lockFile); } catch (e) { /* already gone */ } }
  const finalLed = readLedger(tx); const b2 = baseOf(finalLed, pkg);
  if (opts.report) writeReport(opts.report, pkg, hosted, 'run', ledStart, finalLed, result, audit);
  return { ...result, ledger_rows_total: finalLed.size, base_unchanged: b2.count === wantCount && b2.sha === wantSha, ...audit.head() };
}

// seal: rehearse on a fresh local scratch clone (no assertions on fingerprints), capture per-step fingerprints, write the sealed package
function sealPackage(opts, env, raw, repoRoot) {
  validatePackage(raw, { sealedRequired: false });
  if (!opts.template || !opts.db || !opts.out) throw new Refusal('--template, --db and --out are required');
  if (!/^bpc_replay_[a-z0-9_]+$/.test(opts.template)) throw new Refusal('template must be a bpc_replay_* scratch database', 'hosted-guard');
  LX.assertLocalTarget({ ...opts, db: opts.db }, env, '');
  const port = Number(opts.port || 54329);
  const admin = localTransport({ db: 'postgres', port });
  const ex = (sql) => { const r = admin.run(sql); if (r.code !== 0) throw new Error(r.err.slice(0, 300)); return r.out; };
  ex(`drop database if exists "${opts.db}" with (force)`); ex(`create database "${opts.db}" template "${opts.template}"`); ex(`comment on database "${opts.db}" is '${LX.SCRATCH_MARKER}'`);
  const tx = localTarget({ ...opts, port }, env);
  const files = readFiles(raw, repoRoot);
  const base = baseOf(readLedger(tx), raw);
  const pkg = JSON.parse(JSON.stringify(raw));
  let prevAll = captureFingerprint(tx);
  if (!containedNow(tx)) throw new Refusal('the template is not contained (anon/authenticated have USAGE on public)');
  pkg.start_state = { template: opts.template, fingerprint: prevAll.cats, fp_all: prevAll.all, base_count: base.count, base_sha256: base.sha };
  pkg.items.forEach((it, k) => {
    it.pre_fp_all = prevAll.all; it.post_fp_all = '0'.repeat(32);
    const script = renderStep({ ...pkg, document_sha256: 'seal' }, it, files.get(it.version), { expectDb: opts.db, expectRole: 'postgres', baseCount: base.count, baseSha: base.sha, capture: true });
    const r = tx.run(script, { singleTransaction: true });
    if (r.code !== 0) throw new Refusal(`seal stopped: ${it.version} failed in the rehearsal: ${(r.err.match(/ERROR:\s+(.*)/) || [null, r.err])[1].slice(0, 300)}`, 'rehearsal');
    const f = captureFingerprint(tx);
    it.post_fp_all = f.all; it.post_fp = f.cats; it.contained_after = containedNow(tx);
    prevAll = f;
  });
  pkg.sealed_at_utc = new Date().toISOString();
  sealHash(pkg);
  fs.writeFileSync(opts.out, JSON.stringify(pkg, null, 1) + '\n');
  return { ok: true, command: 'seal', items: pkg.items.length, package_sha256: pkg.document_sha256, start_fp: pkg.start_state.fp_all, end_fp: pkg.items[pkg.items.length - 1].post_fp_all };
}

module.exports = { MUTANTS, mutateScript, main, parseArgs, topLevelStatements, forbiddenStatements, validatePackage, loadPackage, renderStep, checkAuthorization, parseHostedUrl, buildSkeleton, sealHash, docHash, markerOf, ledgerName, readFiles, DEV_REF, PROD_REF, PKG_SCHEMA, AUTH_SCHEMA, MARK_PREFIX, NEVER, Audit, GLOBAL_POST_RULES };

if (require.main === module) {
  try { const res = main(process.argv.slice(2), process.env); console.log(JSON.stringify(res)); process.exit(res.ok ? 0 : 3); }
  catch (e) { console.log(JSON.stringify({ ok: false, refused: !!e.refusal, code: e.code || 'error', message: String(e.message).slice(0, 500) })); process.exit(e.refusal ? 2 : 4); }
}
