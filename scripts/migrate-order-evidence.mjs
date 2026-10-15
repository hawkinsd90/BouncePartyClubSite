// One-time, controlled migration of HISTORICAL delivery / damage evidence photos from the public "public-assets" bucket to the
// private "order-evidence" bucket. The logic and its tests live in supabase/functions/_shared/evidence/evidence-migration.ts; this file
// only wires it to a Supabase project with the service-role key.
//
// Stages (each is explicit; each is safe to run again; only --cleanup deletes anything):
//   --plan      (default) read only; prints counts, never file names
//   --copy      copy referenced evidence objects to their deterministic private paths and verify them
//               (add --include-unreferenced to also archive evidence-named objects no task references)
//   --rewrite   replace the verified legacy entries in task_status.delivery_images / damage_images with the private path
//   --cleanup   delete verified, no-longer-referenced evidence objects from public-assets; needs
//               --confirm delete-verified-public-sources
// Every run needs --project-ref <ref> and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for that same project. Production is refused
// unconditionally: there is no flag, option or environment variable that lifts it.
//
//   node scripts/migrate-order-evidence.mjs --project-ref <ref> --plan
//
// Run order for a rollout is documented with the change that introduced it; do not run --cleanup until every reader has been
// verified against the private copies.

import { createClient } from '@supabase/supabase-js';
import {
  CLEANUP_CONFIRMATION,
  cleanupVerifiedSources,
  copyEvidence,
  migrationRunBlocker,
  planEvidenceMigration,
  rewriteEvidenceReferences,
  verifiedDestinations,
} from '../supabase/functions/_shared/evidence/evidence-migration.ts';

function parseArgs(argv) {
  const args = { stage: 'plan', projectRef: undefined, includeUnreferenced: false, confirm: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-ref') args.projectRef = argv[++i];
    else if (a === '--plan') args.stage = 'plan';
    else if (a === '--copy') args.stage = 'copy';
    else if (a === '--rewrite') args.stage = 'rewrite';
    else if (a === '--cleanup') args.stage = 'cleanup';
    else if (a === '--include-unreferenced') args.includeUnreferenced = true;
    else if (a === '--confirm') args.confirm = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function buildDeps(client) {
  const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  const baseOf = (path) => path.slice(path.lastIndexOf('/') + 1);
  return {
    async listTasks() {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client
          .from('task_status')
          .select('id, order_id, delivery_images, damage_images')
          .or('delivery_images.neq.[],damage_images.neq.[]')
          .order('id')
          .range(from, from + 999);
        if (error) throw new Error('could not read task_status');
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
    async listLegacyObjects() {
      const names = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.storage.from('public-assets').list('', { limit: 1000, offset });
        if (error) throw new Error('could not list public-assets');
        for (const o of data ?? []) if (o.id) names.push(o.name);
        if (!data || data.length < 1000) break;
      }
      return names;
    },
    async head(bucket, path) {
      const { data, error } = await client.storage.from(bucket).list(dirOf(path), { limit: 100, search: baseOf(path) });
      if (error) throw new Error('could not inspect a Storage object');
      const hit = (data ?? []).find((o) => o.name === baseOf(path) && o.id);
      return hit ? { size: hit.metadata?.size ?? null } : null;
    },
    async copy(fromBucket, fromPath, toBucket, toPath) {
      const { error } = await client.storage.from(fromBucket).copy(fromPath, toPath, { destinationBucket: toBucket });
      return error ? { ok: false, error: 'copy failed' } : { ok: true };
    },
    async setColumn(taskId, column, expected, next) {
      const { data: row, error: readError } = await client.from('task_status').select(column).eq('id', taskId).maybeSingle();
      if (readError) return { ok: false, error: 'read failed' };
      if (JSON.stringify(row?.[column] ?? []) !== JSON.stringify(expected)) return { ok: false, conflict: true };
      const { error } = await client.from('task_status').update({ [column]: next }).eq('id', taskId);
      return error ? { ok: false, error: 'update failed' } : { ok: true };
    },
    async remove(bucket, paths) {
      const { error } = await client.storage.from(bucket).remove(paths);
      return error ? { ok: false, error: 'remove failed' } : { ok: true };
    },
  };
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`Not running: ${error.message}`);
  process.exit(2);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const blocker = migrationRunBlocker({ supabaseUrl: url, projectRef: args.projectRef, stage: args.stage });
if (blocker || !key) {
  console.error(`Not running: ${blocker ?? 'SUPABASE_SERVICE_ROLE_KEY is not set'}`);
  process.exit(2);
}

const deps = buildDeps(createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }));

const summary = (report) => JSON.stringify(report, (_k, v) => (v instanceof Set ? v.size : v), 2);

if (args.stage === 'plan') {
  const plan = await planEvidenceMigration(deps);
  console.log(summary(plan.counts));
} else if (args.stage === 'copy') {
  const plan = await planEvidenceMigration(deps);
  const report = await copyEvidence(deps, plan, { includeUnreferenced: args.includeUnreferenced });
  console.log(summary({ copied: report.copied, alreadyPresent: report.alreadyPresent, verified: report.verified.size, failures: report.failures.length }));
  if (report.failures.length > 0) process.exitCode = 1;
} else if (args.stage === 'rewrite') {
  const plan = await planEvidenceMigration(deps);
  const verified = await verifiedDestinations(deps, plan);
  const report = await rewriteEvidenceReferences(deps, plan, verified);
  console.log(summary({ tasksUpdated: report.tasksUpdated, entriesRewritten: report.entriesRewritten, tasksUnchanged: report.tasksUnchanged, conflicts: report.conflicts.length, failures: report.failures.length }));
  if (report.conflicts.length > 0 || report.failures.length > 0) process.exitCode = 1;
} else if (args.stage === 'cleanup') {
  if (args.confirm !== CLEANUP_CONFIRMATION) {
    console.error(`Not running: --cleanup needs --confirm ${CLEANUP_CONFIRMATION}`);
    process.exit(2);
  }
  const report = await cleanupVerifiedSources(deps, args.confirm);
  console.log(summary({ deleted: report.deleted.length, keptStillReferenced: report.keptStillReferenced.length, keptUnverified: report.keptUnverified.length }));
}
