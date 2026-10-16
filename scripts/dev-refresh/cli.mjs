#!/usr/bin/env node
// Production -> Development order data refresh.  See scripts/dev-refresh/README.md.
//
//   node scripts/dev-refresh/cli.mjs doctor
//   node scripts/dev-refresh/cli.mjs preview            (default; changes nothing that lasts)
//   node scripts/dev-refresh/cli.mjs apply   --run <id> --confirm "<phrase printed by preview>" [--attest relays-guarded,auth-email-contained,stripe-edge-secrets-test]
//   node scripts/dev-refresh/cli.mjs restore --run <id> --confirm "<phrase>" [--accept-drift "<phrase>"]
//   node scripts/dev-refresh/cli.mjs verify  --run <id>
//   node scripts/dev-refresh/cli.mjs runs
//   node scripts/dev-refresh/cli.mjs protect                       restrict the credentials file and run folders to this user
//   node scripts/dev-refresh/cli.mjs cleanup [--include-backups] [--execute --confirm "<phrase>"]   list (default) or delete local run data
//   node scripts/dev-refresh/cli.mjs audit-functions --project dev|prod --file <list>   compare deployed functions with the reviewed ones
//   node scripts/dev-refresh/cli.mjs media-plan --run <id>
//   node scripts/dev-refresh/cli.mjs media-copy --run <id> [--execute --confirm "<phrase>"]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECTS } from './lib/config.mjs';
import { classifyMedia, collectReferences, copyMissing, orphanedDevObjects, readStorageInventory } from './lib/media.mjs';
import { ATTESTATIONS, REVIEWED_FUNCTIONS, auditDeployedFunctions } from './lib/pathways.mjs';
import { accessList, assertRestricted, ensureProtectedDir, isRestricted, protectPath } from './lib/protect.mjs';
import { assertTargetIdentity, describeTarget, redact, targetFromUrl } from './lib/psql.mjs';
import { cleanupPhrase, executeCleanup, planCleanup } from './lib/retention.mjs';
import { apply, confirmationPhrase, listRuns, preview, readManifest, restore, restorePhrase, runDirOf, stripeModeOfDev, stripeProblems, verifyApplied, verifyEnvironment, writeManifest } from './lib/run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_FILE = process.env.DEV_REFRESH_ENV_FILE || path.join(ROOT, '.env.dev-refresh');

function loadEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[k] = true;
      else {
        args[k] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

export function resolveTargets(args, env = { ...loadEnvFile(), ...process.env }) {
  if (args.scratch) {
    const host = env.CORE_DB_HOST || '127.0.0.1';
    const port = env.CORE_DB_PORT || '54329';
    const user = env.CORE_DB_USER || 'postgres';
    const pw = env.CORE_DB_PASSWORD || 'postgres';
    const url = (db) => `postgresql://${user}:${encodeURIComponent(pw)}@${host}:${port}/${db}`;
    return {
      prod: targetFromUrl('prod', url(`devrefresh_${args.scratch}_prod`), { scratch: true }),
      dev: targetFromUrl('dev', url(`devrefresh_${args.scratch}_dev`), { scratch: true }),
    };
  }
  if (fs.existsSync(ENV_FILE)) assertRestricted(ENV_FILE, 'The credentials file .env.dev-refresh');
  const prodUrl = env.DEV_REFRESH_PROD_DB_URL;
  const devUrl = env.DEV_REFRESH_DEV_DB_URL;
  if (!prodUrl || !devUrl) {
    throw new Error(`Missing connection settings. Copy .env.dev-refresh.example to .env.dev-refresh and fill in DEV_REFRESH_PROD_DB_URL and DEV_REFRESH_DEV_DB_URL (the file is git-ignored).`);
  }
  return { prod: targetFromUrl('prod', prodUrl), dev: targetFromUrl('dev', devUrl) };
}

const out = (s = '') => process.stdout.write(`${s}\n`);

function printPreview(m, runDir) {
  out(`\nRun ${m.id}   status: ${m.status}`);
  out(`Production (source, read-only): ${m.prodLabel}`);
  out(`Development (target):           ${m.devLabel}\n`);
  if (m.problems?.length) {
    out('NOT SAFE TO APPLY:');
    for (const p of m.problems) out(`  - ${p}`);
    out(`\nNothing was changed. Details: ${path.relative(ROOT, path.join(runDir, 'report.md'))}`);
    return;
  }
  out('table                        Dev rows deleted   Prod rows imported');
  for (const t of m.plan.tables) {
    const del = String(m.devCountsBefore?.[t.name] ?? 0).padStart(8);
    const imp = String(t.mode === 'import' ? m.exportCounts[t.name] : 0).padStart(12);
    out(`  ${t.name.padEnd(26)}${del}${imp}${t.mode !== 'import' ? `   (${t.mode})` : ''}`);
  }
  if (m.plan.clearedWithOrders.length) out(`  emptied with their orders: ${m.plan.clearedWithOrders.map((c) => `${c.table} (${m.devCountsBefore?.[c.table] ?? '?'})`).join(', ')}`);
  if (m.warnings.length) {
    out('\nWarnings:');
    for (const w of m.warnings) out(`  - ${w}`);
  }
  if (m.rehearsal?.ok) out('\nRehearsal: the complete replacement ran against Development inside a transaction that was rolled back. It succeeded; nothing was written.');
  if (m.rehearsal?.skipped) out('\nRehearsal was skipped (--no-rehearsal; local scratch databases only). A hosted apply is refused for a plan without a successful rehearsal.');
  const own = m.rehearsal?.result?.owner;
  if (own) out(`\nCustomer login ownership: ${Object.entries(own).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  out(`\nFull report: ${path.relative(ROOT, path.join(runDir, 'report.md'))}`);
  out('\nTo replace Development with exactly this preview, run:');
  out(`  npm run dev-refresh -- apply --run ${m.id} --confirm "${confirmationPhrase(m)}"${m.scratch ? '' : ' --attest relays-guarded,auth-email-contained,stripe-edge-secrets-test'}`);
  if (!m.scratch) out('(--attest: you confirm the three things this tool can not read; see README, "Before the first hosted refresh".)');
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const log = (s) => out(s);

  if (cmd === 'help' || args.help) {
    out(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  if (cmd === 'runs') {
    const runs = listRuns(ROOT);
    if (!runs.length) out('No runs yet.');
    for (const r of runs) out(`${r.id}  ${r.status.padEnd(28)} ${r.planHash}  ${r.createdAt}`);
    return 0;
  }

  if (cmd === 'protect') {
    const base = ensureProtectedDir(path.join(ROOT, '.dev-refresh'));
    out(`Run folder root protected: ${base} (${accessList(base).join(', ')})`);
    if (fs.existsSync(ENV_FILE)) {
      const r = protectPath(ENV_FILE);
      out(`.env.dev-refresh: ${r.ok ? 'restricted to ' + accessList(ENV_FILE).join(', ') : 'FAILED ' + r.detail}`);
      return r.ok ? 0 : 2;
    }
    out('.env.dev-refresh does not exist yet. Create it from .env.dev-refresh.example, then run this again.');
    return 0;
  }

  if (cmd === 'cleanup') {
    const plan = planCleanup(ROOT, { includeBackups: !!args['include-backups'] });
    const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
    out(`Local run data that can be removed under the retention policy (${plan.items.length} item(s), ${mb(plan.totalBytes)}):`);
    for (const i of plan.items) out(`  ${i.id}  ${i.category.padEnd(22)} ${mb(i.bytes).padStart(9)}  ${i.reason}`);
    out(`Kept (${plan.kept.length}):`);
    for (const k of plan.kept) out(`  ${k.id}  ${k.category.padEnd(22)} ${mb(k.bytes).padStart(9)}  ${k.reason}`);
    if (!args.execute) {
      if (plan.items.length) out(`\nNothing was deleted. To delete exactly the list above:\n  npm run dev-refresh -- cleanup${args['include-backups'] ? ' --include-backups' : ''} --execute --confirm "${cleanupPhrase(plan)}"`);
      return 0;
    }
    const removed = executeCleanup(ROOT, plan, args.confirm);
    out(`\nDeleted ${removed.length} item(s).`);
    return 0;
  }

  if (cmd === 'audit-functions') {
    const project = args.project === 'prod' ? PROJECTS.prod.ref : PROJECTS.dev.ref;
    if (!args.file || args.file === true) throw new Error(`audit-functions needs --file <list>. Produce one with:  npx supabase functions list --project-ref ${project} -o json > functions.json`);
    const raw = fs.readFileSync(args.file, 'utf8').replace(/^﻿/, '').trim();
    let deployed;
    try {
      const j = JSON.parse(raw);
      deployed = (Array.isArray(j) ? j : j.functions || []).map((f) => (typeof f === 'string' ? f : { slug: f.slug || f.name, ezbr_sha256: f.ezbr_sha256 }));
    } catch {
      deployed = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
    const res = auditDeployedFunctions(deployed, Object.keys(REVIEWED_FUNCTIONS), project);
    out(`${deployed.length} deployed function(s) checked against the ${Object.keys(REVIEWED_FUNCTIONS).length} reviewed repository functions.`);
    for (const u of res.unknown) out(`  UNREVIEWED: ${u} is deployed but is neither in this repository nor a reviewed hosted-only function. It may send messages. Read it and review it before a refresh.`);
    for (const c of res.changedHostedOnly) out(`  CHANGED: ${c} differs from the version that was reviewed.`);
    if (!res.unknown.length && !res.changedHostedOnly.length) out('  No unreviewed functions.');
    return res.unknown.length || res.changedHostedOnly.length ? 2 : 0;
  }

  const targets = resolveTargets(args);

  if (cmd === 'doctor') {
    out(describeTarget(targets.prod));
    out(describeTarget(targets.dev));
    const env = verifyEnvironment(targets);
    out(`Identity verified. Production: ${env.prodLabel} (session is read-only; a write was refused).  Development: ${env.devLabel}.`);
    const stripe = stripeModeOfDev(targets.dev);
    for (const s of stripe) out(`Development ${s.key}: ${s.mode}`);
    const problems = stripeProblems(stripe);
    if (fs.existsSync(ENV_FILE) && !isRestricted(ENV_FILE)) problems.push(`.env.dev-refresh is readable by other accounts (${accessList(ENV_FILE).join(', ')}). Run: npm run dev-refresh -- protect`);
    for (const p of problems) out(`PROBLEM: ${p}`);
    out('A hosted apply also asks you to confirm (--attest): ' + Object.keys(ATTESTATIONS).join(', '));
    return problems.length ? 2 : 0;
  }

  if (cmd === 'preview') {
    const { manifest, runDir } = preview({ ...targets, root: ROOT, rehearse: !args['no-rehearsal'], acknowledgeTriggers: args['acknowledge-trigger'] ? [].concat(args['acknowledge-trigger']) : [], log });
    printPreview(manifest, runDir);
    return manifest.status === 'previewed' ? 0 : 2;
  }

  if (cmd === 'apply') {
    if (!args.run || !args.confirm || args.confirm === true) throw new Error('apply needs --run <id> and --confirm "<phrase printed by preview>".');
    const attest = typeof args.attest === 'string' ? args.attest.split(',').map((x) => x.trim()).filter(Boolean) : [];
    const r = apply({ ...targets, root: ROOT, id: args.run, confirm: args.confirm, attest, log });
    const m = r.manifest;
    out(`\nRun ${m.id}: ${m.status}`);
    if (!r.ok && m.failure) {
      out(`FAILED: ${m.failure.code} - ${redact(m.failure.detail)}`);
      out(m.failure.help);
      out(`Development afterwards: ${m.stateAfterFailure}`);
      out(`If it says anything but "unchanged", restore:  npm run dev-refresh -- restore --run ${m.id} --confirm "${restorePhrase(m)}"`);
      return 2;
    }
    for (const c of m.verification?.checks || []) out(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
    out(`\nReport: ${path.relative(ROOT, path.join(runDirOf(ROOT, m.id), 'report.md'))}`);
    out(`To undo:  npm run dev-refresh -- restore --run ${m.id} --confirm "${restorePhrase(m)}"`);
    return r.ok ? 0 : 2;
  }

  if (cmd === 'restore') {
    if (!args.run || !args.confirm || args.confirm === true) throw new Error('restore needs --run <id> and --confirm "<phrase>".');
    const driftConfirm = typeof args['accept-drift'] === 'string' ? args['accept-drift'] : undefined;
    const r = restore({ dev: targets.dev, root: ROOT, id: args.run, confirm: args.confirm, acceptDrift: !!driftConfirm, driftConfirm, log });
    const safety = readManifest(ROOT, args.run).restoreAttempt?.safetyBackup;
    if (safety) out(`A safety copy of the state before the restore is in the run folder (${safety.folder}).`);
    out(r.ok ? 'Development restored from the backup and verified identical to it.' : `Restore FAILED: ${r.failure ? `${r.failure.code} ${redact(r.failure.detail)}` : `mismatches in ${r.mismatches.join(', ')}`}`);
    return r.ok ? 0 : 2;
  }

  if (cmd === 'verify') {
    if (!args.run) throw new Error('verify needs --run <id>.');
    verifyEnvironment({ prod: targets.prod, dev: targets.dev });
    const m = readManifest(ROOT, args.run);
    const v = verifyApplied({ dev: targets.dev, manifest: m });
    for (const c of v.checks) out(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
    return v.ok ? 0 : 2;
  }

  if (cmd === 'media-plan' || cmd === 'media-copy') {
    if (!args.run) throw new Error(`${cmd} needs --run <id>.`);
    const m = readManifest(ROOT, args.run);
    verifyEnvironment({ prod: targets.prod, dev: targets.dev });
    const refs = collectReferences(targets.dev);
    const devInv = readStorageInventory(targets.dev);
    const prodInv = readStorageInventory(targets.prod);
    const plan = classifyMedia(refs, devInv, prodInv);
    const orphans = orphanedDevObjects(refs, devInv);
    const dir = runDirOf(ROOT, m.id);
    fs.writeFileSync(path.join(dir, 'media-plan.json'), JSON.stringify({ counts: plan.counts, items: plan.items, orphanedDevObjects: orphans.length }, null, 2));
    out(`Evidence objects referenced by Development rows: ${refs.length}`);
    for (const [k, v] of Object.entries(plan.counts)) out(`  ${k}: ${v}`);
    out(`Development objects in evidence buckets no longer referenced by any row (reported, never deleted): ${orphans.length}`);
    out(`Plan written to ${path.relative(ROOT, path.join(dir, 'media-plan.json'))}`);
    if (cmd === 'media-plan') return 0;

    const phrase = `COPY MISSING EVIDENCE INTO ${m.devLabel} RUN ${m.id}`;
    if (!args.execute) {
      out(`\nDry run: ${plan.toCopy.length} object(s) would be copied. To copy them (additive, never overwrites):\n  npm run dev-refresh -- media-copy --run ${m.id} --execute --confirm "${phrase}"`);
      return 0;
    }
    if (args.confirm !== phrase) throw new Error(`Approval phrase does not match. Type:\n  ${phrase}`);
    const env = { ...loadEnvFile(), ...process.env };
    const need = ['DEV_REFRESH_PROD_API_URL', 'DEV_REFRESH_PROD_SERVICE_KEY', 'DEV_REFRESH_DEV_API_URL', 'DEV_REFRESH_DEV_SERVICE_KEY'];
    const missing = need.filter((k) => !env[k]);
    if (missing.length) throw new Error(`Copying needs ${missing.join(', ')} in .env.dev-refresh.`);
    const refOf = (u) => (String(u).match(/^https:\/\/([a-z]{20})\.supabase\.co/) || [])[1];
    if (!targets.dev.scratch) {
      if (refOf(env.DEV_REFRESH_PROD_API_URL) !== PROJECTS.prod.ref) throw new Error('DEV_REFRESH_PROD_API_URL is not the Production project.');
      if (refOf(env.DEV_REFRESH_DEV_API_URL) !== PROJECTS.dev.ref) throw new Error('DEV_REFRESH_DEV_API_URL is not the Development project.');
    }
    const { createClient } = await import('@supabase/supabase-js');
    const source = createClient(env.DEV_REFRESH_PROD_API_URL, env.DEV_REFRESH_PROD_SERVICE_KEY, { auth: { persistSession: false } });
    const target = createClient(env.DEV_REFRESH_DEV_API_URL, env.DEV_REFRESH_DEV_SERVICE_KEY, { auth: { persistSession: false } });
    const results = await copyMissing({ plan, source, target, execute: true, log });
    fs.writeFileSync(path.join(dir, 'media-copy-result.json'), JSON.stringify(results, null, 2));
    const tally = {};
    for (const r of results) tally[r.outcome] = (tally[r.outcome] || 0) + 1;
    out(JSON.stringify(tally));
    m.mediaCopy = { at: new Date().toISOString(), tally };
    writeManifest(ROOT, m);
    return results.every((r) => /copied-verified|already-exists/.test(r.outcome)) ? 0 : 2;
  }

  throw new Error(`Unknown command "${cmd}". Run with "help".`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`\n${redact(e.message || e)}\n`);
      process.exit(1);
    });
}

export { assertTargetIdentity };
