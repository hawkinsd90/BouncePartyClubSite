// Delivery and damage evidence photos.
//
// Crew and Admin take delivery / pick-up / damage proof photos on a task. They used to be uploaded to the public
// "public-assets" bucket and the permanent public URL was written into task_status.delivery_images / damage_images. New
// evidence now lives in the PRIVATE "order-evidence" bucket and task_status stores the bare object path:
//
//     <order id>/<task status id>/<delivery|damage>/<random id>.<ext>        (new uploads; the server chooses all of it)
//     <order id>/<task status id>/<delivery|damage>/legacy-<original name>    (historical objects, after the copy)
//
// Historical rows still hold public "public-assets" URLs until the controlled migration rewrites them. Every reader
// understands both forms. A reference is never returned to a browser as stored: readers resolve it to a short-lived signed
// URL, and anything that is neither a private evidence path nor a Supabase public-assets Storage URL is ignored.
//
// Pure: no Deno, no network. The only import is the Storage-reference parser (which never fetches).

import { storagePathFromReference, signStoredMedia } from "./media-paths.ts";
import type { SignedMediaClient } from "./media-paths.ts";

export const EVIDENCE_BUCKET = "order-evidence";
export const LEGACY_EVIDENCE_BUCKET = "public-assets";

export type EvidenceKind = "delivery" | "damage";
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ["delivery", "damage"];
// The task_status column each kind is stored in.
export const EVIDENCE_COLUMNS: Record<EvidenceKind, "delivery_images" | "damage_images"> = {
  delivery: "delivery_images",
  damage: "damage_images",
};

export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MAX_FILES_PER_REQUEST = 20;
// Image types the proof-photo screens produce (compressed JPEG, or an original HEIC / PNG / WebP / GIF when it cannot be
// compressed). The private bucket is configured with the same list.
export const EVIDENCE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
};
export const EVIDENCE_MIME_TYPES: readonly string[] = Object.keys(EVIDENCE_MIME_EXTENSIONS);

const ID = "[A-Za-z0-9_-]{1,64}";
const OBJECT_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NAME = "[A-Za-z0-9._-]{1,200}";
const SAFE_ID = new RegExp(`^${ID}$`);
const EXTENSIONS = Array.from(new Set(Object.values(EVIDENCE_MIME_EXTENSIONS))).join("|");
const NEW_PATH = new RegExp(`^(${ID})/(${ID})/(delivery|damage)/((?:${OBJECT_ID}\\.(?:${EXTENSIONS}))|(?:legacy-${NAME}))$`);
// The old uploader named every file "<order id>-<task type>-<time>-<original name>" with the task's own type, and the task types
// are exactly "drop-off" and "pick-up". "pickup" and "damage" are kept as defensive spellings of the same evidence; no other label
// is ever accepted, so nothing else in public-assets can be mistaken for evidence.
export const LEGACY_TASK_LABELS: readonly string[] = ["drop-off", "pick-up", "pickup", "damage"];
const LABELS = LEGACY_TASK_LABELS.join("|");
// What follows "<order id>-" in a historical object name: "<task type>-<time>-<original name>".
const LEGACY_REST = new RegExp(`^(?:${LABELS})-[0-9]+-${NAME}$`);
// A historical evidence object as found by scanning the bucket: orders are UUIDs, so the order id is unambiguous.
const LEGACY_SCAN = new RegExp(`^(${OBJECT_ID})-(?:${LABELS})-[0-9]+-${NAME}$`);

function legacyBelongsToOrder(path: string, orderId: string): boolean {
  return path.startsWith(`${orderId}-`) && LEGACY_REST.test(path.slice(orderId.length + 1));
}

export interface ParsedEvidenceReference {
  bucket: string;
  path: string;
  // true for a historical public "public-assets" reference; false for a private evidence path
  legacy: boolean;
}

// The object path the server issues for a NEW upload, or null for an unsupported type / unsafe id.
export function newEvidencePath(orderId: string, taskStatusId: string, kind: EvidenceKind, objectId: string, mimeType: string): string | null {
  const ext = EVIDENCE_MIME_EXTENSIONS[mimeType];
  if (!ext || !SAFE_ID.test(orderId) || !SAFE_ID.test(taskStatusId) || !EVIDENCE_KINDS.includes(kind)) return null;
  if (!new RegExp(`^${OBJECT_ID}$`).test(objectId)) return null;
  return `${orderId}/${taskStatusId}/${kind}/${objectId}.${ext}`;
}

// True only for a path in THIS task's folder for this kind, in the shape the server issues (or the legacy copy shape).
export function isTaskEvidencePath(path: unknown, orderId: string, taskStatusId: string, kind: EvidenceKind): path is string {
  if (typeof path !== "string" || !SAFE_ID.test(orderId) || !SAFE_ID.test(taskStatusId)) return false;
  const m = path.match(NEW_PATH);
  return !!m && m[1] === orderId && m[2] === taskStatusId && m[3] === kind;
}

// Parses what task_status stores. Accepts only: a private evidence object path, or a Supabase Storage object URL for the
// public-assets bucket (historical). Anything else - an external URL, another bucket, a traversal path - returns null.
export function parseEvidenceReference(reference: unknown): ParsedEvidenceReference | null {
  if (typeof reference !== "string") return null;
  const ref = reference.trim();
  if (!ref) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    const legacyPath = storagePathFromReference(ref, LEGACY_EVIDENCE_BUCKET);
    if (legacyPath) return { bucket: LEGACY_EVIDENCE_BUCKET, path: legacyPath, legacy: true };
    const privatePath = storagePathFromReference(ref, EVIDENCE_BUCKET);
    if (privatePath && NEW_PATH.test(privatePath)) return { bucket: EVIDENCE_BUCKET, path: privatePath, legacy: false };
    return null;
  }
  return NEW_PATH.test(ref) ? { bucket: EVIDENCE_BUCKET, path: ref, legacy: false } : null;
}

export interface EvidenceScope {
  orderId: string;
  // When given, a private evidence path must be in exactly this task's folder.
  taskStatusId?: string;
  // When given, a private evidence path must be for exactly this kind.
  kind?: EvidenceKind;
}

// True when the parsed reference belongs to the scope's order (and task / kind for private paths). A historical object
// belongs to the order whose id its name begins with (the old uploader named every file "<order id>-<task>-<time>-<name>").
export function evidenceReferenceInScope(parsed: ParsedEvidenceReference, scope: EvidenceScope): boolean {
  if (!SAFE_ID.test(scope.orderId)) return false;
  if (parsed.legacy) return legacyBelongsToOrder(parsed.path, scope.orderId);
  const m = parsed.path.match(NEW_PATH);
  if (!m || m[1] !== scope.orderId) return false;
  if (scope.taskStatusId !== undefined && m[2] !== scope.taskStatusId) return false;
  if (scope.kind !== undefined && m[3] !== scope.kind) return false;
  return true;
}

// Deterministic private destination for a historical object: the same legacy object always maps to the same path, so a
// repeated copy is recognised instead of duplicated. null when the object does not belong to the order.
export function legacyEvidenceDestination(orderId: string, taskStatusId: string, kind: EvidenceKind, legacyPath: string): string | null {
  if (!SAFE_ID.test(orderId) || !SAFE_ID.test(taskStatusId)) return null;
  if (!legacyBelongsToOrder(legacyPath, orderId)) return null;
  const rest = legacyPath.slice(orderId.length + 1);
  return `${orderId}/${taskStatusId}/${kind}/legacy-${rest}`;
}

// Where an evidence-looking historical object that no task references is archived (private, never read by any screen).
export function archivedLegacyDestination(orderId: string, legacyPath: string): string | null {
  if (!SAFE_ID.test(orderId) || !legacyBelongsToOrder(legacyPath, orderId)) return null;
  return `${orderId}/unreferenced/legacy-${legacyPath.slice(orderId.length + 1)}`;
}

// Historical object names that are delivery / pick-up / damage evidence (everything else in public-assets is never touched).
export function isLegacyEvidenceObjectName(name: unknown): name is string {
  return typeof name === "string" && LEGACY_SCAN.test(name);
}
export function legacyEvidenceOrderId(name: string): string | null {
  const m = name.match(LEGACY_SCAN);
  return m ? m[1] : null;
}

export interface ResolvedEvidence {
  ref: string;
  bucket: string | null;
  path: string | null;
  legacy: boolean;
  // short-lived signed URL; null when the reference is not trusted, is not in scope, or could not be signed
  url: string | null;
}

// Resolves task_status references to signed URLs with a trusted (service-role) Storage client, keeping order and length so
// the caller can line results up with what it stored. Untrusted or out-of-scope references resolve to url null.
export async function resolveEvidenceUrls(
  client: SignedMediaClient,
  refs: unknown,
  scope: EvidenceScope,
  expiresIn?: number,
): Promise<ResolvedEvidence[]> {
  const list = Array.isArray(refs) ? refs : [];
  return await Promise.all(
    list.map(async (raw): Promise<ResolvedEvidence> => {
      const ref = typeof raw === "string" ? raw : "";
      const parsed = parseEvidenceReference(ref);
      if (!parsed || !evidenceReferenceInScope(parsed, scope)) return { ref, bucket: null, path: null, legacy: false, url: null };
      const url = await signStoredMedia(client, parsed.bucket, parsed.path, expiresIn);
      return { ref, bucket: parsed.bucket, path: parsed.path, legacy: parsed.legacy, url };
    }),
  );
}
