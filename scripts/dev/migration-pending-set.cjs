'use strict';
// Read-only migration pending-set calculator.
//
//   Pending versions = local repository migration versions - recorded migration-history versions     (EXACT version match)
//
// Inputs are local files only: the filenames in supabase/migrations/ and a captured history file per environment (a JSON array of
// objects with a "version" field, as captured in Stage B, or a plain array of version strings). The tool never opens a network or
// database connection and never writes anything except the optional --out report. It does not apply, rename, repair or record anything.
//
// A missing history row is NOT proof that the SQL effects are missing from the schema (and a present row is not proof that they exist).
// This tool answers only "which repository versions have no recorded row". Schema equivalence needs the Stage D rehearsals.
//
// Aliases (audit/evidence/version-aliases.json) are ANNOTATIONS. They never remove a version from the pending set. A malformed filename,
// a duplicate local or recorded version, an alias that contradicts the data, or a withdrawn version that reappears makes the run fail
// (exit 1) instead of silently selecting one.
//
//   node scripts/dev/migration-pending-set.cjs --prod-history <json> --dev-history <json> [--migrations <dir>] [--aliases <json>]
//        [--classification-prod <csv>] [--classification-dev <csv>] [--out <json>]
// Exit codes: 0 calculated without findings, 1 findings (nothing is selected silently), 2 usage / unreadable input.
const fs = require('fs');
const path = require('path');

const FILE_RE = /^(\d{14})_[^/\\]+\.sql$/;
const VERSION_RE = /^\d{14}$/;

// ---- pure functions (exported for tests) ----------------------------------------------------------------------------------------
function isValidVersion(v) {
  if (typeof v !== 'string' || !VERSION_RE.test(v)) return false;
  const y = Number(v.slice(0, 4)), mo = Number(v.slice(4, 6)), d = Number(v.slice(6, 8)), h = Number(v.slice(8, 10)), mi = Number(v.slice(10, 12)), s = Number(v.slice(12, 14));
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && s <= 59;
}

// names: directory entry names. Anything that is not exactly "<14-digit version>_<name>.sql" is a finding (never ignored). A doubled
// ".sql.sql" extension still carries an unambiguous version (the Supabase CLI accepts it), so it is a WARNING, not a malformed name.
function collectLocalVersions(names) {
  const findings = [];
  const warnings = [];
  const byVersion = new Map();
  for (const name of names) {
    const m = FILE_RE.exec(String(name));
    if (!m || !isValidVersion(m[1])) {
      findings.push({ kind: 'malformed-local-filename', name: String(name) });
      continue;
    }
    if (/\.sql\.sql$/.test(name)) warnings.push({ kind: 'double-sql-extension', name: String(name), version: m[1] });
    if (!byVersion.has(m[1])) byVersion.set(m[1], []);
    byVersion.get(m[1]).push(name);
  }
  for (const [version, files] of byVersion) if (files.length > 1) findings.push({ kind: 'duplicate-local-version', version, files: files.slice().sort() });
  return { versions: [...byVersion.keys()].sort(), files: byVersion, findings, warnings };
}

// rows: array of version strings or objects with a "version" field.
function collectRecordedVersions(rows) {
  const findings = [];
  const counts = new Map();
  if (!Array.isArray(rows)) return { versions: [], findings: [{ kind: 'recorded-history-not-an-array' }] };
  for (const row of rows) {
    const v = typeof row === 'string' ? row : row && typeof row === 'object' ? row.version : undefined;
    if (!isValidVersion(v)) {
      findings.push({ kind: 'malformed-recorded-version', value: typeof v === 'string' ? v : JSON.stringify(row).slice(0, 80) });
      continue;
    }
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  for (const [version, n] of counts) if (n > 1) findings.push({ kind: 'duplicate-recorded-version', version, rows: n });
  return { versions: [...counts.keys()].sort(), findings };
}

// Exact set difference. Both inputs must already be validated; the output is sorted.
function computePending(localVersions, recordedVersions) {
  const recorded = new Set(recordedVersions);
  const local = new Set(localVersions);
  return {
    pending: localVersions.filter((v) => !recorded.has(v)).sort(),
    recordedOnly: recordedVersions.filter((v) => !local.has(v)).sort(),
  };
}

// aliases: { aliases: [{env, local_version, recorded_version, kind, note}], withdrawn: [{version, note}] }.
// Annotations only; contradictions become findings.
function annotate(env, local, recorded, pending, recordedOnly, doc) {
  const findings = [];
  const notes = [];
  const localSet = new Set(local), recSet = new Set(recorded), pendSet = new Set(pending);
  for (const a of (doc && doc.aliases) || []) {
    if (a.env !== env) continue;
    const ok = isValidVersion(a.local_version) && isValidVersion(a.recorded_version);
    if (!ok) { findings.push({ kind: 'malformed-alias', alias: a }); continue; }
    if (!localSet.has(a.local_version) || !recSet.has(a.recorded_version)) { findings.push({ kind: 'alias-contradicts-data', alias: a, reason: 'local version not in the repository or recorded version not in this environment history' }); continue; }
    if (a.local_version === a.recorded_version) { findings.push({ kind: 'alias-contradicts-data', alias: a, reason: 'alias maps a version to itself' }); continue; }
    if (!pendSet.has(a.local_version)) { findings.push({ kind: 'alias-contradicts-data', alias: a, reason: 'the aliased local version is not pending in this environment' }); continue; }
    notes.push({ pending_version: a.local_version, related_recorded_version: a.recorded_version, related_recorded_version_has_local_file: !recordedOnly.includes(a.recorded_version), kind: a.kind, note: a.note, effect_on_pending_set: 'none (still listed as pending)' });
  }
  for (const w of (doc && doc.withdrawn) || []) {
    if (!isValidVersion(w.version)) { findings.push({ kind: 'malformed-withdrawn-entry', entry: w }); continue; }
    if (localSet.has(w.version)) findings.push({ kind: 'withdrawn-version-present-in-repository', version: w.version });
    if (recSet.has(w.version)) findings.push({ kind: 'withdrawn-version-recorded-in-history', env, version: w.version });
  }
  return { notes, findings };
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// Optional Stage B classification (annotation only). Returns counts by class for the CURRENT pending set and the rows that are no longer pending.
function summarizeClassification(pending, csvRows) {
  const byVersion = new Map(csvRows.map((r) => [r.version, r]));
  const counts = {};
  const unclassified = [];
  for (const v of pending) {
    const r = byVersion.get(v);
    if (!r) { unclassified.push(v); continue; }
    counts[r.class] = (counts[r.class] || 0) + 1;
  }
  const pendSet = new Set(pending);
  const noLongerPending = csvRows.filter((r) => !pendSet.has(r.version)).map((r) => r.version).sort();
  return { counts, unclassified, noLongerPending };
}

function calculateEnvironment(env, localVersions, historyRows, aliasDoc, classificationRows) {
  const rec = collectRecordedVersions(historyRows);
  const findings = rec.findings.slice();
  const { pending, recordedOnly } = computePending(localVersions, rec.versions);
  const ann = annotate(env, localVersions, rec.versions, pending, recordedOnly, aliasDoc);
  findings.push(...ann.findings);
  const out = {
    environment: env,
    local_count: localVersions.length,
    recorded_count: rec.versions.length,
    pending_count: pending.length,
    pending_versions: pending,
    recorded_without_local_file_count: recordedOnly.length,
    recorded_without_local_file: recordedOnly,
    alias_annotations: ann.notes,
    findings,
  };
  if (classificationRows) out.stage_b_classification_of_current_pending = summarizeClassification(pending, classificationRows);
  return out;
}

// ---- command line ---------------------------------------------------------------------------------------------------------------
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main(argv, cwd) {
  const get = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : ''; };
  const root = path.resolve(__dirname, '../..');
  const dir = get('--migrations') || path.join(root, 'supabase', 'migrations');
  const prodFile = get('--prod-history');
  const devFile = get('--dev-history');
  if (!prodFile || !devFile) { console.error('usage: --prod-history <json> --dev-history <json> [--migrations dir] [--aliases json] [--classification-prod csv] [--classification-dev csv] [--out json]'); return 2; }
  let names, prodRows, devRows, aliasDoc = null, clsProd = null, clsDev = null;
  try {
    names = fs.readdirSync(dir);
    prodRows = readJson(prodFile);
    devRows = readJson(devFile);
    if (get('--aliases')) aliasDoc = readJson(get('--aliases'));
    if (get('--classification-prod')) clsProd = parseCsv(fs.readFileSync(get('--classification-prod'), 'utf8'));
    if (get('--classification-dev')) clsDev = parseCsv(fs.readFileSync(get('--classification-dev'), 'utf8'));
  } catch (e) {
    console.error('unreadable input: ' + e.message);
    return 2;
  }
  const local = collectLocalVersions(names);
  const result = {
    method: 'pending = local repository versions minus recorded history versions (exact match); aliases and classifications are annotations only',
    caution: 'A missing history row does not prove the SQL effects are missing, and a present row does not prove they exist. This is not schema equivalence.',
    repository: { directory: dir, local_count: local.versions.length, findings: local.findings, warnings: local.warnings },
    production: calculateEnvironment('prod', local.versions, prodRows, aliasDoc, clsProd),
    development: calculateEnvironment('dev', local.versions, devRows, aliasDoc, clsDev),
  };
  const findingCount = local.findings.length + result.production.findings.length + result.development.findings.length;
  result.findings_total = findingCount;
  const text = JSON.stringify(result, null, 1);
  if (get('--out')) fs.writeFileSync(get('--out'), text + '\n');
  console.log(`repository: ${local.versions.length} versions | production: ${result.production.recorded_count} recorded, ${result.production.pending_count} pending | development: ${result.development.recorded_count} recorded, ${result.development.pending_count} pending | findings: ${findingCount}`);
  if (findingCount) {
    console.log('FAILED SAFELY: findings above; no pending set may be relied on until they are resolved.');
    console.log(JSON.stringify({ repository: local.findings, production: result.production.findings, development: result.development.findings }, null, 1));
    return 1;
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2), process.cwd()));
module.exports = { isValidVersion, collectLocalVersions, collectRecordedVersions, computePending, annotate, parseCsv, summarizeClassification, calculateEnvironment, FILE_RE, main };
