// Orchestration of the commands: doctor, preview, apply, restore, verify. All database work goes through psql scripts built in
// sqlgen.mjs; this file decides the ORDER, checks identities, keeps the run folder and refuses unsafe states.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from './analyze.mjs';
import { CLEARED_WITH_ORDERS, EXPORT_MAX_AGE_HOURS, PROJECTS, TOOL_VERSION } from './config.mjs';
import { introspect } from './introspect.mjs';
import { ATTESTATIONS } from './pathways.mjs';
import { assertRestricted, ensureProtectedDir, hardenTree } from './protect.mjs';
import { assertTargetIdentity, describeTarget, ensureDir, markers, mustRun, psqlPath, queryJson, redact, runScript, sqlIdent, sqlLit } from './psql.mjs';
import { buildApplyScript, buildBackupScript, buildExportScript, buildRestoreScript, buildSequenceScript } from './sqlgen.mjs';

export const RUNS_DIRNAME = path.join('.SyncDevDataFromProd', 'runs');

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sha256Text = (t) => crypto.createHash('sha256').update(t).digest('hex');
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------------------------------
// Identity and safety checks
// ---------------------------------------------------------------------------------------------------------------------
export function targetLabel(t) {
  return t.scratch ? t.database : assertTargetIdentity(t).ref;
}

export function confirmationPhrase(manifest) {
  return `REPLACE DEV ORDERS ${manifest.devLabel} WITH PRODUCTION ${manifest.planHash.slice(0, 8)}`;
}
export function restorePhrase(manifest) {
  return `RESTORE DEV ORDERS ${manifest.devLabel} FROM BACKUP ${manifest.id}`;
}

// Everything that must be true before the tool reads or writes anything. Returns facts; throws on a problem.
export function verifyEnvironment({ prod, dev }) {
  if (prod.role !== 'prod' || dev.role !== 'dev') throw new Error('The connections are in the wrong slots (the Production connection must be in the "prod" slot and the Development connection in the "dev" slot). Refusing.');
  const pid = assertTargetIdentity(prod);
  const did = assertTargetIdentity(dev);
  if (prod.scratch !== dev.scratch) throw new Error('One target is a scratch database and the other is hosted. Refusing.');
  if (prod.host === dev.host && String(prod.port) === String(dev.port) && prod.database === dev.database) throw new Error('The Production and Development connections are the same database. Refusing.');
  if (!prod.scratch && pid.ref === did.ref) throw new Error('The Production and Development connections point at the same project. Refusing.');

  const facts = {};
  for (const t of [prod, dev]) {
    // (the settings table is only named in the query when it exists: a missing table must be a finding, not a crash)
    const hasSettings = queryJson(t, `SELECT json_build_object('ok', to_regclass('public.admin_settings') IS NOT NULL)`, `settings check (${t.role})`).ok;
    const info = queryJson(
      t,
      `SELECT json_build_object('database', current_database(), 'readOnlyDefault', current_setting('default_transaction_read_only'),
        'supabaseUrl', ${hasSettings ? "(SELECT value FROM public.admin_settings WHERE key = 'supabase_url')" : 'NULL::text'})`,
      `identity check (${t.role})`,
    );
    if (info.database !== t.database) throw new Error(`Connected to "${info.database}" but expected "${t.database}".`);
    if (!t.scratch) {
      // Second, independent factor: the project's own recorded URL must name the project the role expects.
      const m = String(info.supabaseUrl || '').match(/^https:\/\/([a-z]{20})\.supabase\.co/);
      if (!m) throw new Error(`The ${t.role} database does not record its project URL (admin_settings.supabase_url); cannot confirm which project it is.`);
      if (m[1] !== PROJECTS[t.role].ref) throw new Error(`The ${t.role} database says it is project ${m[1]}, expected ${PROJECTS[t.role].ref}. Refusing.`);
    }
    facts[t.role] = info;
  }

  // Production is read-only twice over: the session default (set in the connection) and a proof that a write is refused.
  if (facts.prod.readOnlyDefault !== 'on') throw new Error('The Production session is not read-only by default. Refusing.');
  const probe = runScript(prod, `BEGIN READ ONLY;\nDELETE FROM public.orders WHERE false;\nROLLBACK;`);
  if (probe.status === 0 || !/read-only transaction/i.test(probe.stderr)) throw new Error('A write statement was not refused on the Production connection. Refusing.');
  if (facts.dev.readOnlyDefault === 'on') throw new Error('The Development session is read-only; the refresh cannot run.');
  return { prodLabel: targetLabel(prod), devLabel: targetLabel(dev), facts };
}

// Development must POSITIVELY be configured for Stripe test mode: both keys present, non-empty and test-mode. The class of each key is read
// (computed inside the database), never the key. A missing table, a missing row, an empty value, an unrecognizable value or a live key is a
// blocker. A secret key in the publishable slot (or the reverse) is "unknown". Test-mode charges, refunds and saved test cards are unaffected.
export const STRIPE_KEYS = [
  { key: 'stripe_secret_key', test: '^(sk|rk)_test_', live: '^(sk|rk)_live_' },
  { key: 'stripe_publishable_key', test: '^pk_test_', live: '^pk_live_' },
];
export function stripeModeOfDev(dev) {
  if (!queryJson(dev, `SELECT json_build_object('ok', to_regclass('public.admin_settings') IS NOT NULL)`, 'admin_settings check').ok) return STRIPE_KEYS.map((k) => ({ key: k.key, mode: 'no-table' }));
  const rows = queryJson(
    dev,
    `SELECT COALESCE(json_agg(json_build_object('key', k.key, 'mode', CASE
        WHEN s.key IS NULL THEN 'missing'
        WHEN btrim(COALESCE(s.value, '')) = '' THEN 'empty'
        WHEN btrim(s.value) ~ k.test THEN 'test'
        WHEN btrim(s.value) ~ k.live THEN 'live'
        ELSE 'unknown' END) ORDER BY k.key), '[]'::json)
     FROM (VALUES ${STRIPE_KEYS.map((k) => `(${sqlLit(k.key)}, ${sqlLit(k.test)}, ${sqlLit(k.live)})`).join(', ')}) AS k(key, test, live)
     LEFT JOIN LATERAL (SELECT a.key, a.value FROM public.admin_settings a WHERE a.key = k.key LIMIT 1) s ON true`,
    'Stripe mode check',
  );
  return rows;
}
export function stripeProblems(rows) {
  const problems = [];
  const seen = new Set((rows || []).map((r) => r.key));
  for (const k of STRIPE_KEYS) if (!seen.has(k.key)) problems.push(`Development ${k.key} could not be checked. Test mode is not confirmed.`);
  for (const r of rows || []) {
    if (r.mode === 'test') continue;
    if (r.mode === 'live') problems.push(`Development ${r.key} is a LIVE Stripe key. Refusing to import payment history into an environment that can move real money.`);
    else if (r.mode === 'missing' || r.mode === 'no-table') problems.push(`Development ${r.key} is not configured. Stripe test mode is not confirmed.`);
    else if (r.mode === 'empty') problems.push(`Development ${r.key} is empty. Stripe test mode is not confirmed.`);
    else problems.push(`Development ${r.key} is not a recognizable Stripe test key.`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run folders
// ---------------------------------------------------------------------------------------------------------------------
export function newRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
export function runDirOf(root, id) {
  return path.resolve(root, RUNS_DIRNAME, id);
}
export function readManifest(root, id) {
  const p = path.join(runDirOf(root, id), 'manifest.json');
  if (!fs.existsSync(p)) throw new Error(`No run "${id}" in ${path.join(root, RUNS_DIRNAME)}.`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
export function writeManifest(root, manifest) {
  fs.writeFileSync(path.join(runDirOf(root, manifest.id), 'manifest.json'), JSON.stringify(manifest, null, 2));
}
export function listRuns(root) {
  const dir = path.resolve(root, RUNS_DIRNAME);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'manifest.json'))).sort().map((d) => {
    const m = JSON.parse(fs.readFileSync(path.join(dir, d, 'manifest.json'), 'utf8'));
    return { id: m.id, status: m.status, createdAt: m.createdAt, planHash: m.planHash.slice(0, 8) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers over script output
// ---------------------------------------------------------------------------------------------------------------------
function tally(stdout) {
  const out = { count: {}, fp: {}, prodonly: {}, staged: {}, deleted: {}, imported: {}, cleared: {}, kept: {}, restored: {}, restoredTables: {}, owner: {}, authref: {}, quarantined: {}, forced: {}, afterfp: {}, other: {} };
  for (const m of markers(stdout)) {
    const [tag, a, b, c, d, e] = m;
    if (tag === 'count') out.count[a] = Number(b);
    else if (tag === 'fp') out.fp[a] = b;
    else if (tag === 'prodonly') out.prodonly[`${a}.${b}`] = Number(c);
    else if (tag === 'staged') out.staged[a] = Number(b);
    else if (tag === 'deleted') out.deleted[a] = Number(b);
    else if (tag === 'imported') out.imported[a] = Number(b);
    else if (tag === 'cleared') out.cleared[a] = Number(b);
    else if (tag === 'kept') out.kept[a] = Number(b);
    else if (tag === 'restored') out.restored[a] = Number(b);
    else if (tag === 'restored_table') out.restoredTables[a] = Number(b);
    else if (tag === 'owner') out.owner[a] = Number(b);
    else if (tag === 'authref') out.authref[a] = { kept: Number(c), nulled: Number(e) };
    else if (tag === 'quarantined') out.quarantined[a] = Number(b);
    else if (tag === 'forced') out.forced[a] = Number(b);
    else if (tag === 'afterfp') out.afterfp[a] = b;
    else out.other[tag] = [a, b, c].filter((x) => x !== undefined).join('|');
  }
  return out;
}

const FAILURE_HELP = {
  STALE: 'Development changed after the backup/preview. Nothing was modified. Run preview again.',
  WRONG_DATABASE: 'The script reached a different database than planned. Nothing was modified.',
  EXPORT_COUNT: 'The staged rows do not match the export. Nothing was modified.',
  DUPLICATE_KEY: 'The export contains duplicate primary keys. Nothing was modified.',
  NULL_NOT_ALLOWED: 'Production has NULLs where Development requires a value. Nothing was modified.',
  ORPHAN: 'The export references rows that are not in it. Nothing was modified.',
  MISSING_REFERENCE: 'The export references Development reference data that does not exist (for example an inventory unit). Nothing was modified.',
  CONTENT_MISMATCH: 'Imported rows differ from the source rows. The transaction was rolled back; Development is unchanged.',
  UNTOUCHED_CHANGED: 'A table the refresh must not change would have changed. The transaction was rolled back; Development is unchanged.',
  TRIGGER_STATE_NOT_RESTORED: 'Trigger states could not be restored. The transaction was rolled back; Development is unchanged.',
  CONSTRAINT_TRIGGERS_DISABLED: 'A constraint trigger was found disabled. The transaction was rolled back.',
  OWNER_MISMATCH: 'Customer ownership did not match the proven mapping. The transaction was rolled back.',
  QUARANTINE_LEAK: 'A quarantined Stripe reference reached the database. The transaction was rolled back.',
  FORCED_VALUE: 'A forced value was not applied. The transaction was rolled back.',
  COUNT_MISMATCH: 'Row counts differ after the import. The transaction was rolled back.',
  BACKUP_COUNT: 'The backup file does not match its manifest. Nothing was modified.',
};
export function explainFailure(stderr) {
  const m = stderr.match(/ERROR:\s+([A-Z_]+)\|([^\n]*)/);
  if (m) return { code: m[1], detail: m[2], help: FAILURE_HELP[m[1]] || 'The transaction was rolled back; Development is unchanged.' };
  const generic = stderr.match(/ERROR:\s+([^\n]*)/);
  return { code: 'DATABASE_ERROR', detail: generic ? generic[1] : stderr.trim().slice(0, 400), help: 'The statement was refused by the database and the whole transaction was rolled back; Development is unchanged.' };
}

function schemaHash(plan, dev) {
  const parts = {};
  for (const t of plan.tables) parts[t.name] = { mode: t.mode, columns: (dev.tables[t.name]?.columns || []).map((c) => [c.name, c.type, c.notNull, c.generated]) };
  for (const c of plan.clearedWithOrders) parts[c.table] = (dev.tables[c.table]?.columns || []).map((x) => [x.name, x.type]);
  parts.triggers = plan.triggers.map((t) => `${t.table}.${t.name}.${t.enabled}`).sort();
  return sha256Text(JSON.stringify(parts));
}

function devInventoryScript(plan, dir) {
  const lines = ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'];
  const tables = plan.tables.filter((t) => t.mode === 'import' || t.mode === 'delete-only');
  for (const t of tables) {
    lines.push(`\\copy (SELECT ${t.pk.map(sqlIdent).join(', ')} FROM public.${sqlIdent(t.name)} ORDER BY 1) TO '${psqlPath(dir)}/${t.name}.ids'`);
    lines.push(`SELECT '@@count|${t.name}|' || count(*) FROM public.${sqlIdent(t.name)};`);
    lines.push(`SELECT '@@fp|${t.name}|' || (SELECT count(*)::text || ':' || md5(COALESCE(string_agg(x::text, E'\\n' ORDER BY x::text), '')) FROM public.${sqlIdent(t.name)} x);`);
  }
  for (const c of plan.clearedWithOrders) {
    lines.push(`SELECT '@@count|${c.table}|' || count(*) FROM public.${sqlIdent(c.table)};`);
    lines.push(`SELECT '@@fp|${c.table}|' || (SELECT count(*)::text || ':' || md5(COALESCE(string_agg(x::text, E'\\n' ORDER BY x::text), '')) FROM public.${sqlIdent(c.table)} x);`);
  }
  lines.push('COMMIT;');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------------
// PREVIEW
// ---------------------------------------------------------------------------------------------------------------------
// The plan hash binds an approval (and the rehearsal) to this exact preview: which tables and columns, the exact Production export, the
// exact Development rows to be replaced, the Development schema, and the target.
export function computePlanHash(manifest) {
  return sha256Text(
    JSON.stringify({
      v: TOOL_VERSION,
      plan: manifest.plan.tables.map((t) => [t.name, t.mode, t.copied]),
      checksums: manifest.exportChecksums,
      devFp: manifest.devFingerprintsBefore,
      devSchema: manifest.devSchemaHash,
      devLabel: manifest.devLabel,
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Operator confirmations (--attest) and the single permitted waiver
// ---------------------------------------------------------------------------------------------------------------------
// The three confirmations are about things this tool can not read. Exactly ONE of them may be waived, explicitly, for ONE apply:
// the notification-relay guard (messages are a precaution about what happens AFTER the import, not part of the database transfer).
// The Auth-email and Stripe confirmations stay mandatory, and no database protection can be waived. A waiver is never a confirmation:
// it is recorded separately and labelled WAIVED_LABEL in the manifest and the report. It exists only in the arguments of that one
// apply (nothing stores it), so a later run needs its own explicit waiver.
export const WAIVABLE_ATTESTATIONS = ['relays-guarded'];
export const WAIVED_LABEL = 'WAIVED — NOT VERIFIED';
export const WAIVER_MIN_REASON_CHARS = 40;

// "--waive name=reason" -> { name: reason }. Throws on anything malformed.
export function parseWaiveOption(value) {
  if (value === undefined) return {};
  if (typeof value !== 'string' || !value.includes('=')) throw new Error('--waive needs the form  --waive "relays-guarded=<written reason>"');
  const i = value.indexOf('=');
  return { [value.slice(0, i).trim()]: value.slice(i + 1).trim() };
}

// Pure. Decides which confirmations are still missing and which waivers are valid. Throws on an invalid waiver.
export function resolveAttestations({ attest = [], waive = {}, required = true, runId, at }) {
  const names = Object.keys(waive);
  for (const name of names) {
    if (!WAIVABLE_ATTESTATIONS.includes(name)) {
      throw new Error(`"${name}" can not be waived. Only ${WAIVABLE_ATTESTATIONS.join(', ')} can be waived; every other confirmation must be made with --attest <name> after you have checked it.`);
    }
    if (attest.includes(name)) throw new Error(`"${name}" was both confirmed (--attest) and waived (--waive). Choose one: a waiver is not a confirmation.`);
    const reason = String(waive[name] ?? '').trim();
    if (reason.length < WAIVER_MIN_REASON_CHARS) {
      throw new Error(`The waiver for "${name}" needs a written reason of at least ${WAIVER_MIN_REASON_CHARS} characters (what is not in place, what contains the risk, and what will not be used).`);
    }
  }
  const missing = required ? Object.keys(ATTESTATIONS).filter((k) => !attest.includes(k) && !names.includes(k)) : [];
  if (missing.length) {
    throw new Error(`A hosted apply needs these confirmations about things this tool can not read (pass each as --attest <name>):\n${missing.map((k) => `  ${k}: ${ATTESTATIONS[k]}`).join('\n')}`);
  }
  const waivers = names.map((name) => ({ name, reason: String(waive[name]).trim(), run: runId, at, status: WAIVED_LABEL, unverified: ATTESTATIONS[name] }));
  return { waivers };
}

// Report lines for the waivers (empty when there are none). Waivers are never listed among the operator confirmations.
export function renderWaivers(m) {
  if (!m.waivers?.length) return [];
  return [
    '',
    `## ${WAIVED_LABEL}`,
    `These confirmations were NOT made and NOT verified. They were waived for run ${m.id} only; a later run needs its own explicit waiver.`,
    ...m.waivers.flatMap((w) => [`- ${w.name}: **${WAIVED_LABEL}** (${w.at})`, `  - Not verified: ${w.unverified}`, `  - Written reason: ${w.reason}`]),
  ];
}

// A hosted apply requires a successful rehearsal of the exact preview; only scratch databases may skip it (local testing).
// `enforceRehearsal` can be set explicitly so tests can exercise the hosted rule on scratch databases.
const rehearsalRequired = (dev, enforceRehearsal) => (enforceRehearsal === undefined ? !dev.scratch : !!enforceRehearsal);

export function preview({ prod, dev, root, rehearse = true, enforceRehearsal, acknowledgeTriggers = [], log = () => {} }) {
  const required = rehearsalRequired(dev, enforceRehearsal);
  if (!rehearse && required) throw new Error('The rehearsal can not be skipped for a hosted refresh: a plan that was not rehearsed can not be applied. Run preview without --no-rehearsal.');
  const env = verifyEnvironment({ prod, dev });
  log(`Production: ${env.prodLabel}   Development: ${env.devLabel}`);
  const id = newRunId();
  // Everything below holds real customer data: the run folder is private to the current user before anything is written into it.
  ensureProtectedDir(path.resolve(root, '.SyncDevDataFromProd'));
  const runDir = ensureProtectedDir(runDirOf(root, id));
  const exportDir = ensureDir(path.join(runDir, 'export'));
  const outDir = ensureDir(path.join(runDir, 'outputs'));
  const idsDir = ensureDir(path.join(runDir, 'dev-rows-to-replace'));

  const prodSchema = introspect(prod);
  const devSchema = introspect(dev);
  const plan = analyze(prodSchema, devSchema, { acknowledgeTriggers });

  const problems = [...plan.blockers];
  const stripe = stripeModeOfDev(dev);
  problems.push(...stripeProblems(stripe));
  const manifest = {
    id,
    tool: TOOL_VERSION,
    createdAt: now(),
    status: problems.length ? 'blocked' : 'previewed',
    prodLabel: env.prodLabel,
    devLabel: env.devLabel,
    prodDatabase: prod.database,
    devDatabase: dev.database,
    scratch: !!dev.scratch,
    problems,
    warnings: plan.warnings,
    plan,
    stripeModes: stripe,
  };
  if (problems.length) {
    manifest.planHash = sha256Text(JSON.stringify(problems));
    writeManifest(root, manifest);
    return { manifest, runDir };
  }

  // Dev inventory (what would be replaced) and Production export (what it would be replaced with), both read-only.
  const inv = mustRun(dev, devInventoryScript(plan, idsDir), 'Development inventory');
  const invT = tally(inv.stdout);
  manifest.devCountsBefore = invT.count;
  manifest.devFingerprintsBefore = invT.fp;
  manifest.devSchemaHash = schemaHash(plan, devSchema);

  const exp = mustRun(prod, buildExportScript({ plan, exportDir }), 'Production export');
  const expT = tally(exp.stdout);
  manifest.exportCounts = expT.count;
  manifest.prodOnlyColumns = expT.prodonly;
  manifest.exportSnapshotAt = markers(exp.stdout).find((m) => m[0] === 'snapshot')?.[1];
  manifest.exportChecksums = {};
  for (const t of plan.tables.filter((x) => x.mode === 'import')) {
    const f = path.join(exportDir, `${t.name}.copy`);
    const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length).length : 0;
    if (lines !== expT.count[t.name]) throw new Error(`Export of ${t.name} is incomplete: ${lines} lines for ${expT.count[t.name]} rows.`);
    manifest.exportChecksums[t.name] = sha256File(f);
  }
  for (const [k, n] of Object.entries(expT.prodonly)) if (n > 0) manifest.warnings.push(`Production column ${k} holds ${n} value(s) but does not exist in Development; those values are not imported.`);
  const pending = plan.tables.some((t) => t.name === 'payments' && t.mode === 'import');
  if (pending) {
    const r = runScript(prod, `SELECT count(*) FROM public.payments WHERE status = 'pending';`);
    if (r.status === 0 && Number(r.stdout.trim()) > 0) manifest.warnings.push(`${r.stdout.trim()} Production payment row(s) are still 'pending'; they can never settle in Development.`);
  }

  if (rehearse) {
    const script = buildApplyScript({
      plan,
      expectedDatabase: dev.database,
      exportDir,
      exportCounts: manifest.exportCounts,
      runDir: outDir,
      devFingerprints: manifest.devFingerprintsBefore,
      rehearsal: true,
    });
    const r = runScript(dev, script);
    if (r.status !== 0) {
      manifest.status = 'blocked';
      manifest.rehearsal = { ok: false, failure: explainFailure(r.stderr) };
      manifest.problems.push(`Rehearsal failed: ${manifest.rehearsal.failure.code} ${redact(manifest.rehearsal.failure.detail)}`);
    } else {
      manifest.rehearsal = { ok: true, result: tally(r.stdout) };
    }
  } else {
    manifest.rehearsal = { ok: null, skipped: true };
  }

  manifest.planHash = computePlanHash(manifest);
  // The rehearsal is bound to the exact preview it ran against.
  if (manifest.rehearsal.ok === true) manifest.rehearsal.planHash = manifest.planHash;
  hardenTree(runDir);
  writeManifest(root, manifest);
  fs.writeFileSync(path.join(runDir, 'report.md'), renderReport(manifest));
  return { manifest, runDir };
}

// ---------------------------------------------------------------------------------------------------------------------
// APPLY
// ---------------------------------------------------------------------------------------------------------------------
export function apply({ prod, dev, root, id, confirm, attest = [], waive = {}, enforceRehearsal, requireAttestations, now: clock = () => Date.now(), maxAgeHours = EXPORT_MAX_AGE_HOURS, log = () => {} }) {
  const manifest = readManifest(root, id);
  const runDir = runDirOf(root, id);
  assertRestricted(runDir, 'The run folder');
  if (manifest.status !== 'previewed') throw new Error(`Run ${id} is "${manifest.status}", not "previewed". Only a successful, unapplied preview can be applied.`);
  if (manifest.rehearsal && manifest.rehearsal.ok === false) throw new Error('The rehearsal of this preview failed; it cannot be applied.');
  if (computePlanHash(manifest) !== manifest.planHash) throw new Error('The preview record was altered after it was made (its plan hash no longer matches its contents). Run preview again.');
  if (confirm !== confirmationPhrase(manifest)) throw new Error(`Approval phrase does not match. To approve this exact preview type:\n  ${confirmationPhrase(manifest)}`);
  const ageHours = (clock() - Date.parse(manifest.createdAt)) / 3600000;
  if (ageHours > maxAgeHours) throw new Error(`This preview is ${Math.round(ageHours)} hours old (limit ${maxAgeHours}). Run preview again.`);

  // ---- hosted gates: a successful rehearsal of THIS preview, and operator attestations about what no tool can read ----
  if (rehearsalRequired(dev, enforceRehearsal)) {
    const rh = manifest.rehearsal;
    if (!rh || rh.ok !== true || rh.skipped) throw new Error('A hosted apply requires a successful rehearsal of this exact preview. This preview has none. Run preview (without --no-rehearsal).');
    if (rh.planHash !== manifest.planHash) throw new Error('The rehearsal does not belong to this preview. Run preview again.');
    for (const t of manifest.plan.tables.filter((x) => x.mode === 'import')) {
      if (rh.result?.staged?.[t.name] !== manifest.exportCounts[t.name] || rh.result?.imported?.[t.name] !== manifest.exportCounts[t.name]) throw new Error(`The rehearsal evidence for ${t.name} does not match the export. Run preview again.`);
    }
  }
  const { waivers } = resolveAttestations({ attest, waive, required: requireAttestations === undefined ? !dev.scratch : requireAttestations, runId: id, at: now() });
  for (const w of waivers) log(`${WAIVED_LABEL}: ${w.name} - ${w.reason}`);

  const env = verifyEnvironment({ prod, dev });
  if (env.devLabel !== manifest.devLabel || env.prodLabel !== manifest.prodLabel) throw new Error('The targets differ from the ones this preview was made for. Refusing.');
  const plan = manifest.plan;

  // Current Development schema must be the one the plan was made against.
  const devSchema = introspect(dev);
  if (schemaHash(plan, devSchema) !== manifest.devSchemaHash) throw new Error('The Development schema changed since the preview. Run preview again.');
  const sp = stripeProblems(stripeModeOfDev(dev));
  if (sp.length) throw new Error(sp.join('\n'));
  manifest.attestations = attest.length ? { names: attest, at: now() } : undefined;
  manifest.waivers = waivers.length ? waivers : undefined;
  for (const [t, expected] of Object.entries(manifest.exportChecksums)) {
    const f = path.join(runDir, 'export', `${t}.copy`);
    if (!fs.existsSync(f) || sha256File(f) !== expected) throw new Error(`The exported data for ${t} was altered or is missing. Run preview again.`);
  }

  // ---- 1. back up what is about to be replaced, and prove the backup ------------------------------------------------
  const backupDir = ensureDir(path.join(runDir, 'backup'));
  manifest.status = 'backing-up';
  writeManifest(root, manifest);
  const b = mustRun(dev, buildBackupScript({ plan, backupDir }), 'Development backup');
  const bt = tally(b.stdout);
  manifest.backup = { at: now(), counts: bt.count, fingerprints: bt.fp, checksums: {} };
  for (const [t, fp] of Object.entries(bt.fp)) {
    if (manifest.devFingerprintsBefore[t] && manifest.devFingerprintsBefore[t] !== fp) {
      manifest.status = 'previewed';
      writeManifest(root, manifest);
      throw new Error(`Development table ${t} changed between the preview and the backup. Nothing was modified. Run preview again.`);
    }
    const f = path.join(backupDir, `${t}.copy`);
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length).length;
    if (lines !== bt.count[t]) throw new Error(`Backup of ${t} is incomplete (${lines} lines for ${bt.count[t]} rows). Nothing was modified.`);
    manifest.backup.checksums[t] = sha256File(f);
  }
  manifest.backup.keepCounts = markers(b.stdout).filter((m) => m[0] === 'keepcount').map((m) => ({ index: Number(m[1]), ref: m[2], count: Number(m[3]) }));
  log(`Backup written and verified: ${path.relative(root, backupDir)}`);

  // ---- 2. the transaction -------------------------------------------------------------------------------------------
  manifest.status = 'applying';
  writeManifest(root, manifest);
  const script = buildApplyScript({
    plan,
    expectedDatabase: dev.database,
    exportDir: path.join(runDir, 'export'),
    exportCounts: manifest.exportCounts,
    runDir: ensureDir(path.join(runDir, 'outputs')),
    devFingerprints: manifest.backup.fingerprints,
    rehearsal: false,
    afterDir: ensureDir(path.join(runDir, 'after-apply')),
  });
  const r = runScript(dev, script);
  hardenTree(runDir);
  if (r.status !== 0) {
    const failure = explainFailure(r.stderr);
    manifest.status = 'failed';
    manifest.failure = failure;
    // Prove the "known state": Development must still match the backup, byte for byte.
    const check = tally(mustRun(dev, devInventoryScript(plan, ensureDir(path.join(runDir, 'after-failure'))), 'post-failure inventory').stdout);
    manifest.stateAfterFailure = Object.entries(manifest.backup.fingerprints).every(([t, fp]) => check.fp[t] === fp) ? 'unchanged (matches the backup)' : 'DIFFERS FROM THE BACKUP - run restore';
    writeManifest(root, manifest);
    fs.writeFileSync(path.join(runDir, 'report.md'), renderReport(manifest));
    return { manifest, runDir, ok: false };
  }
  const result = tally(r.stdout);

  // ---- 3. after commit: sequences, then an independent verification in a fresh session ------------------------------
  const seq = buildSequenceScript(plan);
  if (seq.trim()) mustRun(dev, seq, 'sequence update');
  manifest.status = 'applied';
  manifest.appliedAt = now();
  manifest.result = result;
  // The state that was committed: restore compares the database with this to detect later changes.
  manifest.afterApply = { at: manifest.appliedAt, fingerprints: result.afterfp };
  const verification = verifyApplied({ dev, manifest, root });
  manifest.verification = verification;
  if (!verification.ok) manifest.status = 'applied-verification-failed';
  writeManifest(root, manifest);
  fs.writeFileSync(path.join(runDir, 'report.md'), renderReport(manifest));
  return { manifest, runDir, ok: verification.ok };
}

// ---------------------------------------------------------------------------------------------------------------------
// VERIFY (independent of the transaction that did the work)
// ---------------------------------------------------------------------------------------------------------------------
export function verifyApplied({ dev, manifest }) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const plan = manifest.plan;
  const lines = ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'];
  for (const t of plan.tables.filter((x) => x.mode === 'import')) lines.push(`SELECT '@@count|${t.name}|' || count(*) FROM public.${sqlIdent(t.name)};`);
  for (const t of plan.tables.filter((x) => x.mode === 'delete-only')) lines.push(`SELECT '@@count|${t.name}|' || count(*) FROM public.${sqlIdent(t.name)};`);
  lines.push(`SELECT '@@trg|' || c.relname || '.' || t.tgname || '|' || t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public';`);
  lines.push(`SELECT '@@fkdisabled|' || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE t.tgisinternal AND t.tgenabled <> 'O' AND n.nspname = 'public';`);
  for (const t of plan.tables.filter((x) => x.mode === 'import')) {
    for (const c of t.quarantined) lines.push(`SELECT '@@leak|${t.name}.${c}|' || count(${sqlIdent(c)}) FROM public.${sqlIdent(t.name)};`);
  }
  lines.push('COMMIT;');
  const r = runScript(dev, lines.join('\n') + '\n');
  if (r.status !== 0) {
    add('verification session', false, redact(r.stderr.trim()));
    return { ok: false, checks };
  }
  const m = markers(r.stdout);
  for (const t of plan.tables.filter((x) => x.mode === 'import')) {
    const got = Number(m.find((x) => x[0] === 'count' && x[1] === t.name)?.[2]);
    add(`row count ${t.name}`, got === manifest.exportCounts[t.name], `Development ${got}, Production export ${manifest.exportCounts[t.name]}`);
  }
  for (const t of plan.tables.filter((x) => x.mode === 'delete-only')) {
    const got = Number(m.find((x) => x[0] === 'count' && x[1] === t.name)?.[2]);
    add(`row count ${t.name}`, got === 0, `Development ${got}, expected 0 (table does not exist in Production)`);
  }
  const trg = new Map(m.filter((x) => x[0] === 'trg').map((x) => [x[1], x[2]]));
  const badTrg = plan.triggers.filter((t) => trg.get(`${t.table}.${t.name}`) !== t.enabled);
  add('application trigger states restored', badTrg.length === 0, badTrg.map((t) => `${t.table}.${t.name}`).join(', '));
  add('foreign-key triggers all enabled', m.find((x) => x[0] === 'fkdisabled')?.[1] === '0');
  for (const x of m.filter((y) => y[0] === 'leak')) add(`no Production Stripe reference in ${x[1]}`, x[2] === '0');
  return { ok: checks.every((c) => c.ok), checks };
}

// ---------------------------------------------------------------------------------------------------------------------
// RESTORE
// ---------------------------------------------------------------------------------------------------------------------
export const driftPhrase = (manifest) => `DISCARD CHANGES MADE AFTER REFRESH ${manifest.id}`;

export class DriftError extends Error {
  constructor(message, drift) {
    super(message);
    this.code = 'DRIFT';
    this.drift = drift;
  }
}

function rowHashScript(plan, dir) {
  const lines = ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'];
  const sets = [...plan.tables.filter((t) => t.mode === 'import' || t.mode === 'delete-only').map((t) => ({ name: t.name, pk: t.pk })), ...plan.clearedWithOrders.map((c) => ({ name: c.table, pk: c.pk }))];
  for (const t of sets) if (t.pk.length) lines.push(`\\copy (SELECT ${t.pk.map(sqlIdent).join(', ')}, md5(x::text) FROM public.${sqlIdent(t.name)} x ORDER BY 1) TO '${psqlPath(dir)}/${t.name}.hash'`);
  lines.push('COMMIT;');
  return lines.join('\n') + '\n';
}
const readHashes = (p) => (fs.existsSync(p) ? new Map(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.lastIndexOf('\t')), l.slice(l.lastIndexOf('\t') + 1)])) : null);

// Has Development changed, in any replaced table, since the state this run left it in? Returns per-table counts of rows added, removed and
// modified (or just the table names when no row-level snapshot is available).
export function detectDrift({ dev, manifest, runDir }) {
  const plan = manifest.plan;
  // The state this run left Development in: what it committed; for a run whose apply failed, the (unchanged) state it backed up.
  const expected = manifest.afterApply?.fingerprints ?? (manifest.status === 'failed' ? manifest.backup?.fingerprints : null);
  if (!expected) throw new Error(`Run ${manifest.id} did not leave a recorded state to compare with (it was never applied). Refusing to restore.`);
  const dir = ensureDir(path.join(runDir, 'drift-check'));
  const current = tally(mustRun(dev, devInventoryScript(plan, dir), 'drift inventory').stdout);
  const tables = Object.keys(expected).filter((t) => current.fp[t] !== expected[t]);
  if (!tables.length) return { drifted: false, tables: [], detail: {} };
  mustRun(dev, rowHashScript(plan, dir), 'drift row hashes');
  const detail = {};
  for (const t of tables) {
    const before = readHashes(path.join(runDir, manifest.afterApply ? 'after-apply' : 'backup', `${t}.hash`));
    const now = readHashes(path.join(dir, `${t}.hash`));
    if (!before || !now) {
      detail[t] = { rowsNow: current.count[t], note: 'no row-level snapshot to compare with' };
      continue;
    }
    let added = 0;
    let removed = 0;
    let modified = 0;
    for (const [k, h] of now) {
      if (!before.has(k)) added++;
      else if (before.get(k) !== h) modified++;
    }
    for (const k of before.keys()) if (!now.has(k)) removed++;
    detail[t] = { added, removed, modified };
  }
  return { drifted: true, tables, detail };
}

export function restore({ dev, root, id, confirm, acceptDrift = false, driftConfirm, log = () => {} }) {
  const manifest = readManifest(root, id);
  const runDir = runDirOf(root, id);
  assertRestricted(runDir, 'The run folder');
  if (!manifest.backup) throw new Error(`Run ${id} has no backup (it was never applied).`);
  if (manifest.status === 'restored') throw new Error(`Run ${id} was already restored.`);
  if (!['applied', 'applied-verification-failed', 'failed', 'restore-verification-failed'].includes(manifest.status)) throw new Error(`Run ${id} is "${manifest.status}"; it can not be restored.`);
  if (confirm !== restorePhrase(manifest)) throw new Error(`Approval phrase does not match. To restore Development from this run's backup type:\n  ${restorePhrase(manifest)}`);
  assertTargetIdentity(dev);
  if (targetLabel(dev) !== manifest.devLabel) throw new Error('This backup belongs to a different Development database. Refusing.');
  const plan = manifest.plan;
  const devSchema = introspect(dev);
  if (schemaHash(plan, devSchema) !== manifest.devSchemaHash) throw new Error('The Development schema changed since this backup was taken, so the backup rows no longer match the tables. Restore by hand from the files in the backup folder.');
  const backupDir = path.join(runDir, 'backup');
  for (const [t, expected] of Object.entries(manifest.backup.checksums)) {
    const f = path.join(backupDir, `${t}.copy`);
    if (!fs.existsSync(f) || sha256File(f) !== expected) throw new Error(`Backup file for ${t} is missing or altered. Refusing.`);
  }

  // ---- drift: a restore replaces the order tables again, so anything created or changed since the refresh would be destroyed ----
  const drift = detectDrift({ dev, manifest, runDir });
  if (drift.drifted && !(acceptDrift && driftConfirm === driftPhrase(manifest))) {
    const lines = drift.tables.map((t) => {
      const d = drift.detail[t];
      return `  ${t}: ${d.note ? d.note : `${d.added} added, ${d.modified} modified, ${d.removed} removed`}`;
    });
    throw new DriftError(
      `Development has changed since this refresh left it, in ${drift.tables.length} table(s). A restore would destroy those changes:\n${lines.join('\n')}\n` +
        `Nothing was modified. To restore anyway (a safety copy of the current state is taken first), repeat the command with --accept-drift "${driftPhrase(manifest)}".`,
      drift,
    );
  }

  // ---- a safety copy of what is there NOW, always: a restore never destroys data that has no copy ----
  const safetyName = `pre-restore-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const safetyDir = ensureDir(path.join(runDir, safetyName));
  const sb = tally(mustRun(dev, buildBackupScript({ plan, backupDir: safetyDir }), 'pre-restore safety backup').stdout);
  for (const [t, n] of Object.entries(sb.count)) {
    const f = path.join(safetyDir, `${t}.copy`);
    if (fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length).length !== n) throw new Error(`The safety copy of ${t} is incomplete. Nothing was modified.`);
  }
  hardenTree(runDir);
  const attemptBase = { at: now(), safetyBackup: { folder: safetyName, fingerprints: sb.fp }, driftDiscarded: drift.drifted ? drift.detail : undefined };

  const script = buildRestoreScript({ plan, expectedDatabase: dev.database, backupDir, backupFingerprints: manifest.backup.fingerprints });
  const r = runScript(dev, script);
  if (r.status !== 0) {
    const failure = explainFailure(r.stderr);
    manifest.restoreAttempt = { ...attemptBase, ok: false, failure };
    writeManifest(root, manifest);
    return { ok: false, failure };
  }
  const seq = buildSequenceScript(plan);
  if (seq.trim()) mustRun(dev, seq, 'sequence update');
  // Proof: the restored tables hash to exactly what the backup recorded.
  const check = tally(mustRun(dev, devInventoryScript(plan, ensureDir(path.join(runDir, 'after-restore'))), 'post-restore inventory').stdout);
  const mismatches = Object.entries(manifest.backup.fingerprints).filter(([t, fp]) => check.fp[t] !== fp).map(([t]) => t);
  manifest.status = mismatches.length ? 'restore-verification-failed' : 'restored';
  manifest.restoreAttempt = { ...attemptBase, ok: mismatches.length === 0, mismatches, result: tally(r.stdout) };
  writeManifest(root, manifest);
  return { ok: mismatches.length === 0, mismatches, manifest };
}

// ---------------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------------
export function renderReport(m) {
  const L = [];
  L.push(`# Development order data refresh - run ${m.id}`);
  L.push('');
  L.push(`- Status: **${m.status}**`);
  L.push(`- Production source: ${m.prodLabel} (read-only)   Development target: ${m.devLabel}`);
  L.push(`- Created: ${m.createdAt}${m.exportSnapshotAt ? `   Production snapshot: ${m.exportSnapshotAt}` : ''}`);
  if (m.planHash) L.push(`- Plan hash: ${m.planHash.slice(0, 8)}`);
  if (m.problems?.length) {
    L.push('', '## Blocked', ...m.problems.map((p) => `- ${p}`));
  }
  if (m.warnings?.length) L.push('', '## Warnings', ...m.warnings.map((p) => `- ${p}`));
  if (m.plan && m.exportCounts) {
    L.push('', '## Tables replaced', '', '| table | Development rows deleted | Production rows imported | note |', '|---|---:|---:|---|');
    for (const t of m.plan.tables) {
      const del = m.devCountsBefore?.[t.name] ?? '';
      const imp = t.mode === 'import' ? m.exportCounts[t.name] : 0;
      const notes = [t.mode !== 'import' ? t.mode : '', t.quarantined?.length ? `Stripe refs withheld: ${t.quarantined.join(', ')}` : '', t.forced?.length ? `forced: ${t.forced.map((f) => f.column).join(', ')}` : '', t.deferred?.length ? `circular: ${t.deferred.join(', ')}` : ''].filter(Boolean).join('; ');
      L.push(`| ${t.name} | ${del} | ${imp} | ${notes} |`);
    }
    if (m.plan.clearedWithOrders.length) L.push('', `Emptied together with their orders (Development-only tables): ${m.plan.clearedWithOrders.map((c) => `${c.table} (${m.devCountsBefore?.[c.table] ?? '?'} rows)`).join(', ')}.`);
    L.push('', '## Preserved tables whose references to replaced rows are remembered and restored', ...m.plan.preservedChildren.map((p) => `- ${p.table}.${p.column} -> ${p.parent}${p.condition ? ' (restored only when the signed-in user\'s email equals the contact\'s email)' : ''}`));
    L.push('', '## Application triggers switched off for the transaction (all restored to their original state before commit)', ...m.plan.triggers.map((t) => `- ${t.table}.${t.name}: ${t.reason || 'NOT REVIEWED'}`));
  }
  const res = m.rehearsal?.result || m.result;
  if (res) {
    L.push('', m.result ? '## Result' : '## Rehearsal (rolled back; nothing was written)');
    if (Object.keys(res.owner).length) L.push('', 'Customer login ownership:', ...Object.entries(res.owner).map(([k, v]) => `- ${k}: ${v}`));
    if (Object.keys(res.authref).length) L.push('', 'Other auth references:', ...Object.entries(res.authref).map(([k, v]) => `- ${k}: kept ${v.kept}, set to NULL ${v.nulled}`));
    if (Object.keys(res.quarantined).length) L.push('', 'Stripe references withheld from Development (originals are in the run folder):', ...Object.entries(res.quarantined).map(([k, v]) => `- ${k}: ${v}`));
    if (Object.keys(res.kept).length) L.push('', 'Preserved references remembered / restored:', ...Object.entries(res.kept).map(([k, v]) => `- ${k}: remembered ${v}, restored ${res.restored[k] ?? 0}`));
  }
  if (m.failure) L.push('', '## Failure', `- ${m.failure.code}: ${redact(m.failure.detail)}`, `- ${m.failure.help}`, `- State of Development afterwards: ${m.stateAfterFailure}`);
  if (m.verification) L.push('', '## Verification', ...m.verification.checks.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.name}${c.detail ? ` - ${c.detail}` : ''}`));
  if (m.attestations?.names) L.push('', '## Operator confirmations (things the tool can not read)', ...m.attestations.names.map((n) => `- ${n}: ${ATTESTATIONS[n] ?? ''}`));
  L.push(...renderWaivers(m));
  if (m.restoreAttempt) {
    const ra = m.restoreAttempt;
    L.push('', '## Restore', `- ${ra.ok ? 'restored and verified identical to the backup' : 'FAILED'} (${ra.at})`, `- Safety copy of the state before the restore: ${ra.safetyBackup?.folder}`);
    if (ra.driftDiscarded) L.push(`- Changes made after the refresh that the restore discarded (explicitly approved): ${JSON.stringify(ra.driftDiscarded)}`);
  }
  return L.join('\n') + '\n';
}

export { describeTarget, CLEARED_WITH_ORDERS, sqlLit };
