// Controlled migration of HISTORICAL delivery / damage evidence from the public "public-assets" bucket into the private
// "order-evidence" bucket.
//
// Why this is not SQL: a PostgreSQL migration cannot copy Storage blob bytes. Copying goes through the Storage API, so this is
// a service-role procedure (scripts/migrate-order-evidence.mjs) built on the logic below. Everything that touches the outside
// world is injected (EvidenceMigrationDeps), so the logic is tested against fakes and NEVER run against a live project by tests.
//
// Four separate, explicit stages. Each is safe to run again, and none deletes anything except the last:
//   plan       read only: classify every task_status reference and every public-assets object
//   copy       copy each referenced object to its deterministic private path; verify the copy; never overwrite
//   rewrite    replace ONLY the verified legacy entries of a task's array with the private path (compare-and-set,
//              array order and delivery / damage kind preserved, new-format entries untouched)
//   cleanup    delete public source objects that are verified (copy present with the same size) AND no longer referenced
//              by any task; requires an explicit confirmation token; touches evidence-named objects only
// Destination paths are a pure function of (order, task, kind, source name), so a repeated or resumed run lands on the same
// object instead of creating another one.

import {
  EVIDENCE_BUCKET,
  EVIDENCE_COLUMNS,
  EVIDENCE_KINDS,
  LEGACY_EVIDENCE_BUCKET,
  archivedLegacyDestination,
  evidenceReferenceInScope,
  isLegacyEvidenceObjectName,
  legacyEvidenceDestination,
  legacyEvidenceOrderId,
  parseEvidenceReference,
} from "./evidence-media.ts";
import type { EvidenceKind } from "./evidence-media.ts";

export interface EvidenceTaskRow {
  id: string;
  order_id: string;
  delivery_images: unknown;
  damage_images: unknown;
}

export interface EvidenceMigrationDeps {
  // task_status rows that have any evidence (the caller may pass all rows; rows without evidence are ignored).
  listTasks(): Promise<EvidenceTaskRow[]>;
  // Every object name in the public-assets bucket (flat names).
  listLegacyObjects(): Promise<string[]>;
  // Size of an object, or null when it does not exist.
  head(bucket: string, path: string): Promise<{ size: number | null } | null>;
  copy(fromBucket: string, fromPath: string, toBucket: string, toPath: string): Promise<{ ok: boolean; error?: string }>;
  // Replace a task's column when it still equals `expected` (compare-and-set). conflict = it changed since it was read.
  setColumn(taskId: string, column: "delivery_images" | "damage_images", expected: unknown[], next: string[]): Promise<{ ok: boolean; conflict?: boolean; error?: string }>;
  remove(bucket: string, paths: string[]): Promise<{ ok: boolean; error?: string }>;
}

export type RefClass = "already_private" | "legacy" | "malformed";

export interface PlannedRef {
  taskId: string;
  orderId: string;
  kind: EvidenceKind;
  column: "delivery_images" | "damage_images";
  index: number;
  ref: string;
  class: RefClass;
  // legacy only
  sourcePath?: string;
  destination?: string;
  sourcePresent?: boolean;
  destinationPresent?: boolean;
  // why a malformed reference is left untouched
  reason?: string;
}

export interface PlannedArchive {
  orderId: string;
  sourcePath: string;
  destination: string;
}

export interface EvidenceMigrationPlan {
  refs: PlannedRef[];
  archives: PlannedArchive[];
  counts: {
    tasksWithEvidence: number;
    deliveryRefs: number;
    damageRefs: number;
    alreadyPrivate: number;
    legacy: number;
    malformed: number;
    legacySourceMissing: number;
    duplicateLegacyRefs: number;
    unreferencedEvidenceObjects: number;
    nonEvidenceObjectsIgnored: number;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// plan (read only)
// ---------------------------------------------------------------------------------------------------------------------
export async function planEvidenceMigration(deps: EvidenceMigrationDeps): Promise<EvidenceMigrationPlan> {
  const tasks = await deps.listTasks();
  const objects = await deps.listLegacyObjects();
  const refs: PlannedRef[] = [];
  const referencedLegacy = new Set<string>();
  const seenLegacy = new Map<string, number>();
  let tasksWithEvidence = 0;

  for (const task of tasks) {
    let any = false;
    for (const kind of EVIDENCE_KINDS) {
      const column = EVIDENCE_COLUMNS[kind];
      const list = Array.isArray(task[column]) ? (task[column] as unknown[]) : [];
      if (list.length > 0) any = true;
      for (let index = 0; index < list.length; index++) {
        const raw = list[index];
        const ref = typeof raw === "string" ? raw : "";
        const base = { taskId: task.id, orderId: task.order_id, kind, column, index, ref };
        const parsed = parseEvidenceReference(ref);
        if (!parsed) {
          refs.push({ ...base, class: "malformed", reason: "not a trusted evidence reference" });
          continue;
        }
        if (!evidenceReferenceInScope(parsed, { orderId: task.order_id, taskStatusId: task.id, kind })) {
          refs.push({ ...base, class: "malformed", reason: "does not belong to this task's order" });
          continue;
        }
        if (!parsed.legacy) {
          refs.push({ ...base, class: "already_private" });
          continue;
        }
        const destination = legacyEvidenceDestination(task.order_id, task.id, kind, parsed.path);
        if (!destination) {
          refs.push({ ...base, class: "malformed", reason: "legacy name cannot be mapped" });
          continue;
        }
        referencedLegacy.add(parsed.path);
        seenLegacy.set(parsed.path, (seenLegacy.get(parsed.path) ?? 0) + 1);
        const source = await deps.head(LEGACY_EVIDENCE_BUCKET, parsed.path);
        const dest = await deps.head(EVIDENCE_BUCKET, destination);
        refs.push({ ...base, class: "legacy", sourcePath: parsed.path, destination, sourcePresent: !!source, destinationPresent: !!dest });
      }
    }
    if (any) tasksWithEvidence++;
  }

  const archives: PlannedArchive[] = [];
  let nonEvidence = 0;
  for (const name of objects) {
    if (!isLegacyEvidenceObjectName(name)) {
      nonEvidence++;
      continue;
    }
    if (referencedLegacy.has(name)) continue;
    const orderId = legacyEvidenceOrderId(name);
    const destination = orderId ? archivedLegacyDestination(orderId, name) : null;
    if (orderId && destination) archives.push({ orderId, sourcePath: name, destination });
  }

  const legacyRefs = refs.filter((r) => r.class === "legacy");
  return {
    refs,
    archives,
    counts: {
      tasksWithEvidence,
      deliveryRefs: refs.filter((r) => r.kind === "delivery").length,
      damageRefs: refs.filter((r) => r.kind === "damage").length,
      alreadyPrivate: refs.filter((r) => r.class === "already_private").length,
      legacy: legacyRefs.length,
      malformed: refs.filter((r) => r.class === "malformed").length,
      legacySourceMissing: legacyRefs.filter((r) => !r.sourcePresent && !r.destinationPresent).length,
      duplicateLegacyRefs: Array.from(seenLegacy.values()).reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0),
      unreferencedEvidenceObjects: archives.length,
      nonEvidenceObjectsIgnored: nonEvidence,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// copy (never overwrites, never deletes)
// ---------------------------------------------------------------------------------------------------------------------
export interface CopyReport {
  copied: number;
  alreadyPresent: number;
  // destination path -> true once it exists with the source's size
  verified: Set<string>;
  failures: Array<{ source: string; destination: string; reason: string }>;
}

async function copyOne(deps: EvidenceMigrationDeps, sourcePath: string, destination: string, report: CopyReport): Promise<void> {
  const source = await deps.head(LEGACY_EVIDENCE_BUCKET, sourcePath);
  const existing = await deps.head(EVIDENCE_BUCKET, destination);
  if (existing) {
    // A previous run (or an interrupted one) already put an object there: accept it only when it is the same size as the source,
    // or when the source is already gone (cleanup ran). Never overwrite.
    if (!source || existing.size === source.size) {
      report.alreadyPresent++;
      report.verified.add(destination);
    } else {
      report.failures.push({ source: sourcePath, destination, reason: "destination exists with a different size" });
    }
    return;
  }
  if (!source) {
    report.failures.push({ source: sourcePath, destination, reason: "source object is missing" });
    return;
  }
  const result = await deps.copy(LEGACY_EVIDENCE_BUCKET, sourcePath, EVIDENCE_BUCKET, destination);
  if (!result.ok) {
    report.failures.push({ source: sourcePath, destination, reason: "copy failed" });
    return;
  }
  const after = await deps.head(EVIDENCE_BUCKET, destination);
  if (!after || after.size !== source.size) {
    report.failures.push({ source: sourcePath, destination, reason: "copy could not be verified" });
    return;
  }
  report.copied++;
  report.verified.add(destination);
}

export async function copyEvidence(deps: EvidenceMigrationDeps, plan: EvidenceMigrationPlan, options: { includeUnreferenced?: boolean } = {}): Promise<CopyReport> {
  const report: CopyReport = { copied: 0, alreadyPresent: 0, verified: new Set(), failures: [] };
  const done = new Set<string>();
  for (const ref of plan.refs) {
    if (ref.class !== "legacy" || !ref.sourcePath || !ref.destination || done.has(ref.destination)) continue;
    done.add(ref.destination);
    await copyOne(deps, ref.sourcePath, ref.destination, report);
  }
  if (options.includeUnreferenced) {
    for (const a of plan.archives) {
      if (done.has(a.destination)) continue;
      done.add(a.destination);
      await copyOne(deps, a.sourcePath, a.destination, report);
    }
  }
  return report;
}

// Destinations that currently exist as a good copy of their source (same size), or whose source is already gone. The rewrite
// stage uses this instead of trusting that a previous copy run finished.
export async function verifiedDestinations(deps: EvidenceMigrationDeps, plan: EvidenceMigrationPlan): Promise<Set<string>> {
  const verified = new Set<string>();
  for (const ref of plan.refs) {
    if (ref.class !== "legacy" || !ref.sourcePath || !ref.destination || verified.has(ref.destination)) continue;
    const dest = await deps.head(EVIDENCE_BUCKET, ref.destination);
    if (!dest) continue;
    const source = await deps.head(LEGACY_EVIDENCE_BUCKET, ref.sourcePath);
    if (!source || dest.size === source.size) verified.add(ref.destination);
  }
  return verified;
}

// ---------------------------------------------------------------------------------------------------------------------
// rewrite (only verified legacy entries; compare-and-set)
// ---------------------------------------------------------------------------------------------------------------------
export interface RewriteReport {
  tasksUpdated: number;
  entriesRewritten: number;
  tasksUnchanged: number;
  conflicts: string[];
  failures: Array<{ taskId: string; reason: string }>;
}

export async function rewriteEvidenceReferences(deps: EvidenceMigrationDeps, plan: EvidenceMigrationPlan, verified: Set<string>): Promise<RewriteReport> {
  const report: RewriteReport = { tasksUpdated: 0, entriesRewritten: 0, tasksUnchanged: 0, conflicts: [], failures: [] };
  // Re-read so a task changed since the plan is judged on its current content.
  const current = new Map((await deps.listTasks()).map((t) => [t.id, t]));
  const byTask = new Map<string, PlannedRef[]>();
  for (const r of plan.refs) {
    if (r.class === "legacy") byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
  }
  for (const [taskId, planned] of byTask) {
    const row = current.get(taskId);
    if (!row) continue;
    let changedTask = false;
    for (const kind of EVIDENCE_KINDS) {
      const column = EVIDENCE_COLUMNS[kind];
      const original = Array.isArray(row[column]) ? ([...(row[column] as unknown[])] as unknown[]) : [];
      const mapping = new Map(planned.filter((p) => p.kind === kind && p.destination && verified.has(p.destination)).map((p) => [p.ref, p.destination as string]));
      if (mapping.size === 0) continue;
      const next = original.map((entry) => (typeof entry === "string" && mapping.has(entry) ? (mapping.get(entry) as string) : entry)) as string[];
      const rewritten = next.filter((entry, i) => entry !== original[i]).length;
      if (rewritten === 0) continue;
      const result = await deps.setColumn(taskId, column, original, next);
      if (result.ok) {
        report.entriesRewritten += rewritten;
        changedTask = true;
      } else if (result.conflict) {
        report.conflicts.push(taskId);
      } else {
        report.failures.push({ taskId, reason: result.error ?? "update failed" });
      }
    }
    if (changedTask) report.tasksUpdated++;
    else report.tasksUnchanged++;
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// cleanup of public sources (explicit, last, verified)
// ---------------------------------------------------------------------------------------------------------------------
export const CLEANUP_CONFIRMATION = "delete-verified-public-sources";

export interface CleanupReport {
  deleted: string[];
  keptStillReferenced: string[];
  keptUnverified: string[];
}

export async function cleanupVerifiedSources(deps: EvidenceMigrationDeps, confirmation: string): Promise<CleanupReport> {
  if (confirmation !== CLEANUP_CONFIRMATION) throw new Error("cleanup requires the explicit confirmation token");
  const report: CleanupReport = { deleted: [], keptStillReferenced: [], keptUnverified: [] };
  const tasks = await deps.listTasks();
  const objects = await deps.listLegacyObjects();

  // Which public sources do tasks still reference (historical URLs not yet rewritten)?
  const stillReferenced = new Set<string>();
  // Which sources do the private copies recorded on tasks / in the archive point back to?
  const expectedCopy = new Map<string, string>();
  for (const task of tasks) {
    for (const kind of EVIDENCE_KINDS) {
      const list = Array.isArray(task[EVIDENCE_COLUMNS[kind]]) ? (task[EVIDENCE_COLUMNS[kind]] as unknown[]) : [];
      for (const raw of list) {
        const parsed = parseEvidenceReference(raw);
        if (!parsed) continue;
        if (parsed.legacy) stillReferenced.add(parsed.path);
        else {
          const m = parsed.path.match(/^([^/]+)\/([^/]+)\/(?:delivery|damage)\/legacy-(.+)$/);
          if (m && m[2] === task.id && m[1] === task.order_id) expectedCopy.set(`${m[1]}-${m[3]}`, parsed.path);
        }
      }
    }
  }

  const doomed: string[] = [];
  for (const name of objects) {
    if (!isLegacyEvidenceObjectName(name)) continue; // never touch the logo or any other public asset
    if (stillReferenced.has(name)) {
      report.keptStillReferenced.push(name);
      continue;
    }
    const orderId = legacyEvidenceOrderId(name);
    const archived = orderId ? archivedLegacyDestination(orderId, name) : null;
    const copyPath = expectedCopy.get(name) ?? archived;
    const source = await deps.head(LEGACY_EVIDENCE_BUCKET, name);
    const copy = copyPath ? await deps.head(EVIDENCE_BUCKET, copyPath) : null;
    if (!source || !copy || copy.size !== source.size) {
      report.keptUnverified.push(name);
      continue;
    }
    doomed.push(name);
  }
  for (let i = 0; i < doomed.length; i += 50) {
    const batch = doomed.slice(i, i + 50);
    const result = await deps.remove(LEGACY_EVIDENCE_BUCKET, batch);
    if (result.ok) report.deleted.push(...batch);
    else report.keptUnverified.push(...batch);
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// guards for the command line wrapper
// ---------------------------------------------------------------------------------------------------------------------
export const PRODUCTION_PROJECT_REF = "qaagfafagdpgzcijnfbw";

// Returns a reason the run must not proceed, or null. Every stage needs the project ref named on the command line and matching the
// Supabase URL. Production is refused unconditionally: there is no option, flag or environment variable that lifts this, and a
// Production rollout would need its own, separately authorized change.
export function migrationRunBlocker(input: { supabaseUrl: string | undefined; projectRef: string | undefined; stage: "plan" | "copy" | "rewrite" | "cleanup" }): string | null {
  const host = (() => {
    try {
      return new URL(String(input.supabaseUrl)).hostname;
    } catch {
      return "";
    }
  })();
  const urlRef = host.endsWith(".supabase.co") ? host.slice(0, -".supabase.co".length) : "";
  if (!urlRef) return "SUPABASE_URL is not a Supabase project URL";
  if (urlRef === PRODUCTION_PROJECT_REF) return "refusing to run against Production";
  if (!input.projectRef || input.projectRef !== urlRef) return "--project-ref must name the project in SUPABASE_URL";
  return null;
}
