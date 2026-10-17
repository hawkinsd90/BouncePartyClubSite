#!/usr/bin/env node
'use strict';
// LOCAL-ONLY allowlist migration executor (Stage E2G, safety closure E2H). NOT AUTHORIZED FOR HOSTED USE.
//
// It applies an exact, owner-reviewed allowlist of migration files to a DISPOSABLE LOCAL scratch PostgreSQL database and nothing else. It is deliberately not a general migration tool:
//   - it never looks at the migrations directory to decide what to run (no "pending" discovery); work is: allowlist items minus ledger rows;
//   - every file is read from the Git commit the allowlist is bound to, normalised to LF and hashed; the working tree must agree;
//   - the allowlist's dependency metadata is validated BEFORE any connection: every prerequisite must be an earlier executable item of the same allowlist;
//   - it refuses unknown, withdrawn, modified or unexpected input, and any ledger that does not match the verified expectation;
//   - it records real SQL execution, history-only reconciliation and qualified owner attestation as three different things, in an external hash-chained audit store and in different ledger markers;
//   - each file runs in ONE transaction together with its ledger row; there is no automatic reverse.
// Hosted-target protection is enforced in code BEFORE any connection (loopback-only host, scratch database-name pattern, no credentials or connection strings accepted, no PG*/SUPABASE*/DATABASE_URL
// environment, project references blocked) and again on the server side AFTER connecting (loopback server address, no TLS, scratch ownership marker on the database). See README.md.
//
// Usage: node local-migration-executor.cjs <plan|run|verify> --allowlist FILE --db bpc_exec_NAME --audit-dir DIR --approval-hash HEX [--port N] [--repo-root DIR]
//        [--stop-after VERSION] [--allow-stop-in-critical-window] [--acknowledge-older-than-latest N] [--lock-timeout-ms N] [--statement-timeout-ms N] [--expect-audit-head HASH]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const SCRATCH_MARKER = 'bpc-migration-executor-scratch:v1';
const DB_RE = /^bpc_exec_[a-z0-9_]{1,40}$/;
const BLOCK_RE = /qaagfafagdpgzcijnfbw|srxunxiytojjsuhcmzjg|supabase\.(co|com|net|in)|\.pooler\.|postgres(ql)?:\/\/|sslmode\s*=|password\s*=|host\s*=|hostaddr\s*=|conninfo/i;
const WITHDRAWN = ['20260305203528', '20260407203226', '20260407211122']; // Cases 41, 42, 43
const OMITTED_NINE = ['20260715221828', '20260716104333', '20261010110000', '20260716151530', '20260716152823', '20260716173644', '20260717111737', '20260717113131', '20260814114825'];
const NEVER_EXECUTE = new Set([...WITHDRAWN, ...OMITTED_NINE]);
const EXEC_MARK = '-- BPC-LOCAL-EXECUTOR executed';
const HIST_MARK = '-- BPC-LOCAL-EXECUTOR history-only NOT EXECUTED';
const ATT_MARK = '-- BPC-LOCAL-EXECUTOR attestation NOT EXECUTED';
const VALUE_OPTS = new Set(['allowlist', 'db', 'audit-dir', 'approval-hash', 'port', 'repo-root', 'stop-after', 'acknowledge-older-than-latest', 'lock-timeout-ms', 'statement-timeout-ms', 'host', 'expect-audit-head']);
const FLAG_OPTS = new Set(['allow-stop-in-critical-window', 'json']);
const KIND_OF_ITEM = { execute: 'executed', 'history-only': 'history-only', attestation: 'attestation' };

class Refusal extends Error { constructor(msg, code) { super(msg); this.refusal = true; this.code = code || 'refused'; } }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// hashing and canonical content
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const normalizeLF = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));
function documentHash(doc) { const c = { ...doc }; delete c.document_sha256; return sha256(Buffer.from(canonical(c), 'utf8')); }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// option parsing: strict allow-list of options; anything else (including --password, --conninfo, --url) is refused
function parseArgs(argv) {
  const cmd = argv[0];
  if (!['plan', 'run', 'verify'].includes(cmd)) throw new Refusal('first argument must be plan, run or verify');
  const opts = { cmd };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Refusal(`unexpected argument: ${a.slice(0, 40)}`);
    const k = a.slice(2);
    if (FLAG_OPTS.has(k)) { opts[k] = true; continue; }
    if (!VALUE_OPTS.has(k)) throw new Refusal(`option not accepted: --${k.slice(0, 30)} (this executor accepts no credentials, connection strings or project references)`);
    if (i + 1 >= argv.length) throw new Refusal(`--${k} needs a value`);
    opts[k] = argv[++i];
  }
  return opts;
}

// hosted-target protection, step 1 (before any connection)
function assertLocalTarget(opts, env, allowlistText) {
  const host = opts.host || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Refusal(`host must be exactly 127.0.0.1 (got a different value); hosted targets are never accepted`, 'hosted-guard');
  const port = Number(opts.port || 54329);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Refusal('port must be an integer from 1024 to 65535', 'hosted-guard');
  if (!opts.db || !DB_RE.test(opts.db)) throw new Refusal('database name must match ^bpc_exec_[a-z0-9_]{1,40}$ (disposable scratch databases only)', 'hosted-guard');
  for (const [k, v] of Object.entries(opts)) if (typeof v === 'string' && BLOCK_RE.test(v)) throw new Refusal(`option --${k} contains a hosted connection detail or project reference`, 'hosted-guard');
  if (allowlistText && BLOCK_RE.test(allowlistText)) throw new Refusal('the allowlist document contains a hosted connection detail or project reference', 'hosted-guard');
  for (const [k, v] of Object.entries(env)) {
    if (/^(DATABASE_URL|SUPABASE_.*|PGPASSWORD|PGPASSFILE|PGSERVICE|PGSERVICEFILE|PGHOSTADDR|PGSSLMODE|PGSSLROOTCERT|PGSSLCERT|PGSSLKEY)$/i.test(k)) throw new Refusal(`environment variable ${k} is set; this executor accepts no credentials or connection settings from the environment`, 'hosted-guard');
    if (/^PGHOST$/i.test(k) && v !== '127.0.0.1') throw new Refusal('PGHOST is set to a non-loopback value', 'hosted-guard');
    if (/^(DATABASE_URL|SUPABASE_.*|PG.*)$/i.test(k) && BLOCK_RE.test(String(v))) throw new Refusal(`environment variable ${k} contains a hosted connection detail`, 'hosted-guard');
  }
  return { host, port };
}

// hosted-target protection, step 2 (server side, after connecting, before any write): the SERVER must be loopback, without TLS, a scratch database that carries our ownership marker
function assertServerIsScratch(info, dbName) {
  const [addr, db, marker, ssl] = info;
  if (!(addr === '127.0.0.1' || addr === '::1')) throw new Refusal(`the server reports address '${addr}', not loopback`, 'hosted-guard');
  if (db !== dbName) throw new Refusal('connected database differs from the requested one', 'hosted-guard');
  if (marker !== SCRATCH_MARKER) throw new Refusal(`database lacks the scratch ownership marker '${SCRATCH_MARKER}'`, 'hosted-guard');
  if (ssl === 't') throw new Refusal('the connection uses TLS; local scratch connections are plain loopback only', 'hosted-guard');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// audit store: append-only JSON lines, hash-chained. Loss or corruption makes the executor refuse (fail closed); truncation of the tail is detectable only against a head hash kept elsewhere (--expect-audit-head).
class Audit {
  constructor(dir, runId) { this.dir = dir; this.file = path.join(dir, 'audit.jsonl'); this.runId = runId; fs.mkdirSync(dir, { recursive: true }); this.state = this.verifyChain(); }
  verifyChain() {
    let prev = '0'.repeat(64), seq = 0; const recs = [];
    if (fs.existsSync(this.file)) {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean)) {
        let r; try { r = JSON.parse(line); } catch (e) { throw new Refusal('audit store contains a line that is not valid JSON', 'audit'); }
        const { hash, ...rest } = r;
        if (r.prev !== prev || sha256(Buffer.from(canonical(rest), 'utf8')) !== hash) throw new Refusal(`audit store chain broken at seq ${r.seq}`, 'audit');
        prev = hash; seq = r.seq; recs.push(r);
      }
    }
    return { prev, seq, recs };
  }
  add(event, data) {
    const rest = { seq: this.state.seq + 1, ts: new Date().toISOString(), run: this.runId, event, ...data, prev: this.state.prev };
    const hash = sha256(Buffer.from(canonical(rest), 'utf8'));
    fs.appendFileSync(this.file, JSON.stringify({ ...rest, hash }) + '\n');
    this.state.prev = hash; this.state.seq = rest.seq; this.state.recs.push({ ...rest, hash });
  }
  has(event, version, extra) { return this.state.recs.some((r) => r.event === event && r.version === version && (!extra || Object.entries(extra).every(([k, v]) => r[k] === v))); }
  hasHash(h) { return h === '0'.repeat(64) || this.state.recs.some((r) => r.hash === h); }
  head() { return { audit_head: this.state.prev, audit_records: this.state.seq }; }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// database access (psql over loopback, minimal environment, never prompts)
function makeDb(opts) {
  const psqlBin = process.env.BPC_PSQL || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
  const base = ['-X', '-q', '-w', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(opts.port), '-U', 'postgres', '-d', opts.db, '-f', '-'];
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, PGCLIENTENCODING: 'UTF8', PGSSLMODE: 'disable' };
  return {
    run(sql, readOnly) {
      const e = { ...env }; if (readOnly) e.PGOPTIONS = '-c default_transaction_read_only=on';
      const r = cp.spawnSync(psqlBin, base, { input: sql, encoding: 'utf8', env: e, maxBuffer: 64 * 1024 * 1024 });
      if (r.error) throw new Error('psql could not be started: ' + String(r.error.message).slice(0, 120));
      return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
    },
  };
}
const q = (db, sql) => { const r = db.run(sql, true); if (r.code !== 0) throw new Error(r.err.slice(0, 400) || 'psql failed'); return r.out; };
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// ledger = supabase_migrations.schema_migrations(version text, statements text[], name text): marker is statements[1]; for executed rows statements[2] holds the exact LF SQL that ran (its hash is checked)
function readLedger(db) {
  const out = q(db, "select version || E'\\t' || coalesce(name,'') || E'\\t' || coalesce(statements[1],'') || E'\\t' || coalesce(encode(sha256(convert_to(statements[2],'UTF8')),'hex'),'') from supabase_migrations.schema_migrations order by version");
  const m = new Map();
  for (const line of out.split(/\r?\n/).filter(Boolean)) { const [version, name, marker, textSha] = line.split('\t'); m.set(version, { name, marker: marker || '', textSha: (textSha || '').trim() }); }
  return m;
}
const kindOf = (marker) => (marker.startsWith(EXEC_MARK) ? 'executed' : marker.startsWith(HIST_MARK) ? 'history-only' : marker.startsWith(ATT_MARK) ? 'attestation' : 'other');
const markerSha = (marker) => (/sha256_lf=([0-9a-f]{64})/.exec(marker) || [])[1];
const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/;/g, ',');

// ---------------------------------------------------------------------------------------------------------------------------------------------
// allowlist and file verification
function loadAllowlist(text) {
  let doc; try { doc = JSON.parse(text); } catch (e) { throw new Refusal('allowlist is not valid JSON'); }
  if (doc.schema !== 'bpc-local-allowlist/1') throw new Refusal('unknown allowlist schema');
  if (doc.environment !== 'local-scratch') throw new Refusal("allowlist environment must be exactly 'local-scratch'", 'hosted-guard');
  if (!doc.expected_base_history || !Array.isArray(doc.items)) throw new Refusal('allowlist lacks items or expected_base_history');
  if (documentHash(doc) !== doc.document_sha256) throw new Refusal('allowlist document hash does not match its content (modified allowlist)');
  if (!/^[0-9a-f]{40}$/.test(doc.commit || '')) throw new Refusal('allowlist is not bound to a full git commit hash');
  const seen = new Set(), orders = new Set();
  for (const it of doc.items) {
    if (!/^\d{14}$/.test(it.version) || seen.has(it.version)) throw new Refusal(`bad or duplicate version ${it.version}`);
    seen.add(it.version);
    if (!KIND_OF_ITEM[it.kind]) throw new Refusal(`unknown item kind for ${it.version}`);
    if (WITHDRAWN.includes(it.version) || (doc.deny || []).includes(it.version)) throw new Refusal(`withdrawn version ${it.version} is on the allowlist`, 'withdrawn');
    if (it.kind === 'execute' && NEVER_EXECUTE.has(it.version)) throw new Refusal(`version ${it.version} must never be executed (withdrawn or omitted)`, 'never-execute');
    if (it.kind === 'execute' && !/^[0-9a-f]{64}$/.test(it.sha256_lf || '')) throw new Refusal(`missing LF hash for ${it.version}`);
    if (it.kind === 'execute' && !String(it.file || '').startsWith(it.version + '_')) throw new Refusal(`file ${it.file} does not belong to version ${it.version} (version/file mismatch)`, 'version-file');
    if (it.kind === 'attestation') for (const f of ['attested_by', 'attested_at', 'scope', 'not_proven']) if (!it[f]) throw new Refusal(`attestation ${it.version} lacks ${f}`, 'attestation');
    if (orders.has(it.order)) throw new Refusal(`duplicate order ${it.order}`);
    orders.add(it.order);
  }
  for (const d of WITHDRAWN) if (!(doc.deny || []).includes(d)) throw new Refusal(`deny list must contain ${d}`);
  doc.items.sort((a, b) => a.order - b.order);
  // dependency metadata is validated here, before any connection or execution.
  // requires: prerequisites must be EARLIER executable items of this allowlist. record_after: the versions that must have been executed before a history-only/attestation row may be written;
  // they must be executable items of this allowlist (they are normally LATER in the manifest order than the record, because the record is written once they have run).
  const pos = new Map(doc.items.map((i, k) => [i.version, k]));
  for (const it of doc.items) {
    for (const dep of it.requires || []) {
      const j = pos.get(dep);
      if (j === undefined || doc.items[j].kind !== 'execute') throw new Refusal(`${it.version} requires ${dep}, which is not an executable item of the allowlist`, 'dependency-missing');
      if (j >= pos.get(it.version)) throw new Refusal(`${it.version} is ordered before its prerequisite ${dep} (invalid manifest order)`, 'dependency-order');
    }
    for (const dep of it.record_after || []) {
      const j = pos.get(dep);
      if (j === undefined || doc.items[j].kind !== 'execute') throw new Refusal(`${it.version} is recorded after ${dep}, which is not an executable item of the allowlist`, 'dependency-missing');
      if (it.kind === 'execute') throw new Refusal(`${it.version}: record_after is only valid on history-only or attestation items`, 'dependency-order');
    }
  }
  return doc;
}

function git(repoRoot, args) { return cp.execFileSync('git', ['-C', repoRoot, ...args], { maxBuffer: 256 * 1024 * 1024 }); }

function verifyFiles(doc, repoRoot, migDir) {
  try { git(repoRoot, ['cat-file', '-e', doc.commit + '^{commit}']); } catch (e) { throw new Refusal(`commit ${doc.commit} is not in the repository`); }
  const dirAbs = path.join(repoRoot, migDir);
  // withdrawn versions must not be present in the ACTIVE migration directory of the working tree
  if (fs.existsSync(dirAbs)) for (const f of fs.readdirSync(dirAbs)) if (WITHDRAWN.includes(f.slice(0, 14))) throw new Refusal(`withdrawn file ${f} is present in the active migration directory`, 'withdrawn');
  const content = new Map();
  for (const it of doc.items.filter((x) => x.kind === 'execute')) {
    let fromCommit; try { fromCommit = git(repoRoot, ['show', `${doc.commit}:${migDir}/${it.file}`]); } catch (e) { throw new Refusal(`file ${it.file} is not in commit ${doc.commit.slice(0, 10)}`); }
    const lf = normalizeLF(fromCommit);
    if (sha256(lf) !== it.sha256_lf) throw new Refusal(`file ${it.file}: content in the bound commit does not match the allowlist hash`, 'hash');
    const wt = path.join(dirAbs, it.file);
    if (!fs.existsSync(wt)) throw new Refusal(`file ${it.file} is missing from the working tree`, 'hash');
    if (sha256(normalizeLF(fs.readFileSync(wt))) !== it.sha256_lf) throw new Refusal(`file ${it.file}: working tree differs from the bound commit (modified file)`, 'hash');
    content.set(it.version, lf.toString('utf8'));
  }
  return content;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// ledger verification (fail closed: any disagreement stops the run before work is selected)
function verifyLedger(doc, led, audit) {
  const allow = new Map(doc.items.map((i) => [i.version, i]));
  const base = [...led.keys()].filter((v) => !allow.has(v)).sort();
  const eb = doc.expected_base_history;
  const baseSha = sha256(Buffer.from(base.join('\n'), 'utf8'));
  if (base.length !== eb.count || baseSha !== eb.versions_sha256) {
    const extra = base.filter((v) => WITHDRAWN.includes(v) || !/^\d{14}$/.test(v)).slice(0, 5);
    throw new Refusal(`ledger rows outside the allowlist (${base.length}) do not match the expected base history (${eb.count}); suspicious rows: ${extra.join(',') || 'none identified'}`, 'ledger');
  }
  for (const v of WITHDRAWN) if (led.has(v)) throw new Refusal(`ledger has a row for withdrawn version ${v}`, 'ledger');
  const done = new Set();
  for (const [v, row] of led) {
    const it = allow.get(v); if (!it) continue;
    const k = kindOf(row.marker);
    if (k === 'other') throw new Refusal(`ledger row ${v} has no executor marker`, 'ledger');
    if (k !== KIND_OF_ITEM[it.kind]) throw new Refusal(`ledger marks ${it.kind} item ${v} as ${k}`, 'ledger');
    if (k === 'executed') {
      if (markerSha(row.marker) !== it.sha256_lf) throw new Refusal(`ledger row ${v} carries a different file hash than the allowlist`, 'ledger');
      if (row.textSha !== it.sha256_lf) throw new Refusal(`ledger row ${v}: the SQL text stored in the ledger does not match the allowlisted file`, 'ledger');
      // independent evidence: the audit store must agree
      if (!audit.has('item_end', v, { sha256_lf: it.sha256_lf }) && !audit.has('item_start', v, { sha256_lf: it.sha256_lf })) throw new Refusal(`ledger row ${v} is not backed by audit evidence`, 'audit');
    }
    // a non-executed row is backed by its completion event, or by the 'record_start' event written BEFORE the insert (a kill between the commit and the completion event leaves only the start event)
    if (k === 'history-only' && !audit.has('history_only', v) && !audit.has('record_start', v, { kind: 'history-only' })) throw new Refusal(`history-only ledger row ${v} is not backed by audit evidence`, 'audit');
    if (k === 'attestation' && !audit.has('attestation', v) && !audit.has('record_start', v, { kind: 'attestation' })) throw new Refusal(`attestation ledger row ${v} is not backed by audit evidence`, 'audit');
    done.add(v);
  }
  return { allow, done };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
function main(argv, env) {
  const opts = parseArgs(argv);
  const allowlistText = opts.allowlist ? fs.readFileSync(opts.allowlist, 'utf8') : '';
  const { host, port } = assertLocalTarget(opts, env, allowlistText);
  opts.port = port; opts.host = host;
  for (const r of ['allowlist', 'audit-dir', 'approval-hash']) if (!opts[r]) throw new Refusal(`--${r} is required`);
  const doc = loadAllowlist(allowlistText);
  if (opts['approval-hash'] !== doc.document_sha256) throw new Refusal('--approval-hash must equal the allowlist document hash (typed approval)', 'approval');
  const repoRoot = path.resolve(opts['repo-root'] || path.join(__dirname, '..', '..', '..'));
  const migDir = doc.migrations_dir || 'supabase/migrations';
  const runId = crypto.randomBytes(6).toString('hex');
  const audit = new Audit(opts['audit-dir'], runId);
  const refuse = (e) => { audit.add('refused', { reason: e.message.slice(0, 300), code: e.code }); throw e; };
  if (opts['expect-audit-head'] && !audit.hasHash(opts['expect-audit-head'])) refuse(new Refusal('the audit store does not contain the expected head hash (tail truncated, replaced or from another store)', 'audit'));
  const db = makeDb(opts);
  try {
    var content = verifyFiles(doc, repoRoot, migDir);
    const info = q(db, "select coalesce(host(inet_server_addr()),'') || '|' || current_database() || '|' || coalesce((select shobj_description(oid,'pg_database') from pg_database where datname=current_database()),'') || '|' || coalesce((select ssl::text from pg_stat_ssl where pid=pg_backend_pid()),'f')").split('|');
    assertServerIsScratch([info[0], info[1], info[2], info[3] === 'true' ? 't' : 'f'], opts.db);
    var led = readLedger(db);
    var { allow, done } = verifyLedger(doc, led, audit);
  } catch (e) { if (e.refusal) refuse(e); throw e; }

  const latest = doc.expected_base_history.latest;
  const olderAll = doc.items.filter((i) => i.kind === 'execute' && i.version < latest);
  if (opts.cmd !== 'verify' && olderAll.length) {
    if (String(opts['acknowledge-older-than-latest']) !== String(olderAll.length)) refuse(new Refusal(`${olderAll.length} allowlisted versions are older than the latest recorded version ${latest}; pass --acknowledge-older-than-latest ${olderAll.length} to handle them deliberately`, 'older'));
  }
  const cw = doc.critical_window;
  if (opts['stop-after']) {
    const s = opts['stop-after'];
    if (!allow.has(s) || allow.get(s).kind !== 'execute') refuse(new Refusal('--stop-after must name an executable allowlisted version'));
    if (cw && s >= cw.first && s < cw.last && !opts['allow-stop-in-critical-window']) refuse(new Refusal(`stopping after ${s} would pause inside the critical window ${cw.first}..${cw.last}; pass --allow-stop-in-critical-window to do it deliberately`, 'critical-window'));
  }
  const lockMs = Number(opts['lock-timeout-ms'] || 5000), stmtMs = Number(opts['statement-timeout-ms'] || 120000);
  const lockFile = path.join(opts['audit-dir'], 'run.lock');
  const count = (k) => [...done].filter((v) => kindOf(led.get(v).marker) === k).length;

  if (opts.cmd === 'plan') {
    const todo = doc.items.filter((i) => !done.has(i.version));
    audit.add('plan', { items_total: doc.items.length, remaining: todo.length });
    return { ok: true, command: 'plan', allowlist_sha256: doc.document_sha256, commit: doc.commit, execute_total: doc.items.filter((i) => i.kind === 'execute').length, history_only_total: doc.items.filter((i) => i.kind === 'history-only').length,
      attestation_total: doc.items.filter((i) => i.kind === 'attestation').length, remaining_execute: todo.filter((i) => i.kind === 'execute').map((i) => i.version), remaining_history_only: todo.filter((i) => i.kind === 'history-only').map((i) => i.version),
      remaining_attestation: todo.filter((i) => i.kind === 'attestation').map((i) => i.version), older_than_latest: olderAll.length, declared_prerequisites: doc.items.reduce((n, i) => n + (i.requires || []).length, 0), ...audit.head() };
  }
  if (opts.cmd === 'verify') {
    const missing = doc.items.filter((i) => !done.has(i.version)).map((i) => i.version);
    audit.add('verify', { missing: missing.length });
    return { ok: missing.length === 0, command: 'verify', missing, executed: count('executed'), history_only: count('history-only'), attestations: count('attestation'), ...audit.head() };
  }

  // run: one executor per audit store
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile, 'utf8')); let alive = false; try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
    if (alive) refuse(new Refusal(`another executor (pid ${pid}) holds the audit-store lock`, 'lock'));
    audit.add('stale_lock_cleared', { pid });
  }
  fs.writeFileSync(lockFile, String(process.pid));
  // an earlier run that never wrote run_end was interrupted (kill, crash, power loss): say so in the evidence
  const starts = audit.state.recs.filter((r) => r.event === 'run_start');
  if (starts.length) { const last = starts[starts.length - 1].run; if (!audit.state.recs.some((r) => r.event === 'run_end' && r.run === last)) audit.add('prior_run_incomplete', { prior_run: last }); }
  const result = { ok: true, command: 'run', run: runId, executed: [], history_only: [], attestations: [], reconciled: [], stopped_after: null, failed: null };
  const executedNow = (v) => led.has(v) && kindOf(led.get(v).marker) === 'executed';
  // history-only and attestation records: written only when every record_after version is executed and the read-only predicate (if any) holds NOW
  function recordNonExecuted() {
    for (const it of doc.items.filter((i) => i.kind !== 'execute' && !done.has(i.version))) {
      if (!(it.record_after || []).every(executedNow)) continue;
      if (it.predicate_sql && q(db, it.predicate_sql).trim() !== 't') continue;
      const marker = it.kind === 'attestation'
        ? `${ATT_MARK} run=${runId} attested_by=${oneLine(it.attested_by)} attested_at=${oneLine(it.attested_at)} scope=${oneLine(it.scope)} not_proven=${oneLine(it.not_proven)}`
        : `${HIST_MARK} run=${runId} basis=${oneLine(it.basis)}`;
      audit.add('record_start', { version: it.version, kind: it.kind });
      const r = db.run(`begin; select pg_advisory_xact_lock(hashtext('bpc-local-executor')); insert into supabase_migrations.schema_migrations (version,name,statements) values (${lit(it.version)},${lit(it.name || it.version)},ARRAY[${lit(marker)}]); commit;`, false);
      if (r.code !== 0) throw new Error('non-executed record failed: ' + r.err.slice(0, 300));
      if (it.kind === 'attestation') { audit.add('attestation', { version: it.version, attested_by: it.attested_by, attested_at: it.attested_at, scope: it.scope, not_proven: it.not_proven }); result.attestations.push(it.version); }
      else { audit.add('history_only', { version: it.version, basis: it.basis, record_after: it.record_after || [], predicate: it.predicate_sql ? 'true' : 'none' }); result.history_only.push(it.version); }
      led = readLedger(db); ({ done } = verifyLedger(doc, led, audit));
    }
  }
  audit.add('run_start', { allowlist_sha256: doc.document_sha256, commit: doc.commit, database: opts.db, stop_after: opts['stop-after'] || null });
  try {
    // crash-gap reconciliation: a ledger row exists (so its transaction committed) but the audit store lacks the end record
    for (const [v, row] of led) {
      const it = allow.get(v); if (!it || kindOf(row.marker) !== 'executed') continue;
      if (!audit.has('item_end', v)) { audit.add('item_end', { version: v, kind: 'executed', sha256_lf: it.sha256_lf, reconciled_after_crash: true }); result.reconciled.push(v); }
    }
    // the same for history-only and attestation rows: the row committed, the completion event was lost
    for (const [v, row] of led) {
      const it = allow.get(v); const k = kindOf(row.marker);
      if (!it || (k !== 'history-only' && k !== 'attestation')) continue;
      const ev = k === 'attestation' ? 'attestation' : 'history_only';
      if (!audit.has(ev, v)) { audit.add(ev, { version: v, basis: it.basis, reconciled_after_crash: true }); result.reconciled.push(v); }
    }
    for (;;) {
      recordNonExecuted();
      const nxt = doc.items.find((i) => i.kind === 'execute' && !done.has(i.version));
      if (!nxt) break;
      for (const dep of nxt.requires || []) if (!executedNow(dep)) throw new Refusal(`required version ${dep} for ${nxt.version} is not executed`, 'dependency');
      audit.add('item_start', { version: nxt.version, kind: 'executed', sha256_lf: nxt.sha256_lf });
      const name = nxt.file.slice(15).replace(/\.sql(\.sql)?$/, '');
      const marker = `${EXEC_MARK} run=${runId} sha256_lf=${nxt.sha256_lf}`;
      const sql = content.get(nxt.version);
      const script = `begin;\nselect pg_advisory_xact_lock(hashtext('bpc-local-executor'));\nset local standard_conforming_strings = on;\nset local lock_timeout = '${lockMs}ms';\nset local statement_timeout = '${stmtMs}ms';\n${sql}\n;\ninsert into supabase_migrations.schema_migrations (version,name,statements) values (${lit(nxt.version)},${lit(name)},ARRAY[${lit(marker)},${lit(sql)}]);\ncommit;\n`;
      const r = db.run(script, false);
      if (r.code !== 0) {
        const err = (r.err.match(/ERROR:\s+(.*)/) || [null, r.err])[1].slice(0, 300);
        audit.add('item_failed', { version: nxt.version, error: err });
        result.ok = false; result.failed = { version: nxt.version, error: err };
        break;
      }
      led = readLedger(db);
      if (!led.has(nxt.version) || kindOf(led.get(nxt.version).marker) !== 'executed') throw new Error(`ledger row for ${nxt.version} missing after commit`);
      ({ done } = verifyLedger(doc, led, audit));
      audit.add('item_end', { version: nxt.version, kind: 'executed', sha256_lf: nxt.sha256_lf });
      result.executed.push(nxt.version);
      if (opts['stop-after'] === nxt.version) { recordNonExecuted(); result.stopped_after = nxt.version; break; }
    }
    audit.add('run_end', { ok: result.ok, executed: result.executed.length, history_only: result.history_only.length, attestations: result.attestations.length, stopped_after: result.stopped_after, failed: result.failed && result.failed.version });
  } catch (e) {
    if (e.refusal) audit.add('refused', { reason: e.message.slice(0, 300), code: e.code });
    throw e;
  } finally { try { fs.unlinkSync(lockFile); } catch (e) { /* lock already gone */ } }
  return { ...result, ...audit.head() };
}

module.exports = { main, parseArgs, assertLocalTarget, assertServerIsScratch, normalizeLF, sha256, documentHash, canonical, loadAllowlist, WITHDRAWN, OMITTED_NINE, SCRATCH_MARKER, DB_RE, BLOCK_RE, Refusal };

if (require.main === module) {
  try {
    const res = main(process.argv.slice(2), process.env);
    console.log(JSON.stringify(res));
    process.exit(res.ok ? 0 : 3);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, refused: !!e.refusal, code: e.code || 'error', message: String(e.message).slice(0, 500) }));
    process.exit(e.refusal ? 2 : 4);
  }
}
