// Evidence media (waivers, signatures, delivery / pickup / lot photographs) for imported Production orders.
//
// The refresh replaces DATABASE ROWS only. Storage objects are never deleted, overwritten, moved or re-published here.
// After a refresh, an imported order shows its waiver or photograph only if the referenced object exists in Development's
// Storage. This module
//   1. finds every storage reference held by the imported rows,
//   2. compares it with Development's and Production's storage.objects (read-only SQL, no API key needed),
//   3. classifies each object: present / missing (can be copied) / conflict (exists in both with different content: never touched)
//      / unavailable (not in Production either) / bucket-missing,
//   4. optionally copies ONLY the missing ones, additively (upsert is never used; nothing is removed or replaced), verifying the
//      copy byte for byte.
// Reference parsing is the application's own (supabase/functions/_shared/evidence), so the plan follows the same rules the October
// private-storage readers use: a stored Production URL is reduced to bucket + path and read from the CURRENT project's Storage.

import crypto from 'node:crypto';
import { parseEvidenceReference } from '../../../supabase/functions/_shared/evidence/evidence-media.ts';
import { storagePathFromReference } from '../../../supabase/functions/_shared/evidence/media-paths.ts';
import { queryJson, sqlIdent } from './psql.mjs';

// Where a replaced table holds a storage reference. `bucket` null = decided by parseEvidenceReference (task evidence).
export const MEDIA_COLUMNS = [
  { table: 'order_signatures', column: 'signature_image_url', bucket: 'signatures' },
  { table: 'order_signatures', column: 'pdf_url', bucket: 'signed-waivers' },
  { table: 'order_signatures', column: 'physical_waiver_storage_path', bucket: 'physical-waivers' },
  { table: 'orders', column: 'signed_waiver_url', bucket: 'signed-waivers' },
  { table: 'order_pictures', column: 'file_path', bucket: 'order-pictures' },
  { table: 'order_lot_pictures', column: 'file_path', bucket: 'lot-pictures' },
  { table: 'address_lot_pictures', column: 'file_path', bucket: 'lot-pictures' },
  { table: 'task_status', column: 'delivery_images', bucket: null, evidence: true },
  { table: 'task_status', column: 'damage_images', bucket: null, evidence: true },
];

export const DEFAULT_MAX_OBJECT_BYTES = 50 * 1024 * 1024;

// Pure: one stored value -> zero or more { bucket, path }.
export function referencesOf(spec, value) {
  const out = [];
  const add = (bucket, path) => {
    if (bucket && path) out.push({ bucket, path });
  };
  if (value === null || value === undefined) return out;
  if (spec.evidence) {
    const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    for (const v of list) {
      const parsed = parseEvidenceReference(v);
      if (parsed) add(parsed.bucket, parsed.path);
    }
    return out;
  }
  add(spec.bucket, storagePathFromReference(value, spec.bucket));
  return out;
}

// Reads the stored references of the imported rows from Development.
export function collectReferences(dev, specs = MEDIA_COLUMNS) {
  const found = new Map();
  for (const spec of specs) {
    const exists = queryJson(dev, `SELECT json_build_object('ok', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${spec.table}' AND column_name = '${spec.column}'))`, 'media column check').ok;
    if (!exists) continue;
    const rows = queryJson(dev, `SELECT COALESCE(json_agg(json_build_object('id', id::text, 'v', ${sqlIdent(spec.column)}::text)), '[]'::json) FROM public.${sqlIdent(spec.table)} WHERE ${sqlIdent(spec.column)} IS NOT NULL`, `read ${spec.table}.${spec.column}`);
    for (const r of rows) {
      let value = r.v;
      if (spec.evidence) {
        try {
          value = JSON.parse(r.v);
        } catch {
          value = r.v;
        }
      }
      for (const ref of referencesOf(spec, value)) {
        const key = `${ref.bucket}/${ref.path}`;
        if (!found.has(key)) found.set(key, { ...ref, referencedBy: [] });
        found.get(key).referencedBy.push({ table: spec.table, id: r.id, column: spec.column });
      }
    }
  }
  return [...found.values()];
}

export function readStorageInventory(target) {
  return queryJson(
    target,
    `SELECT json_build_object(
       'buckets', COALESCE((SELECT json_agg(json_build_object('id', id, 'public', public)) FROM storage.buckets), '[]'::json),
       'objects', COALESCE((SELECT json_agg(json_build_object('bucket', bucket_id, 'path', name, 'size', (metadata->>'size')::bigint, 'etag', metadata->>'eTag')) FROM storage.objects), '[]'::json))`,
    `${target.role} storage inventory`,
  );
}

// Pure: references + the two inventories -> a classified plan. Never contains file contents.
export function classifyMedia(references, devInv, prodInv, { maxBytes = DEFAULT_MAX_OBJECT_BYTES } = {}) {
  const devObjects = new Map(devInv.objects.map((o) => [`${o.bucket}/${o.path}`, o]));
  const prodObjects = new Map(prodInv.objects.map((o) => [`${o.bucket}/${o.path}`, o]));
  const devBuckets = new Set(devInv.buckets.map((b) => b.id));
  const items = references.map((ref) => {
    const key = `${ref.bucket}/${ref.path}`;
    const d = devObjects.get(key);
    const p = prodObjects.get(key);
    let status;
    if (!devBuckets.has(ref.bucket)) status = 'bucket-missing';
    else if (d && p) status = d.size === p.size && (d.etag || null) === (p.etag || null) ? 'present' : 'conflict';
    else if (d) status = 'present';
    else if (p) status = p.size > maxBytes ? 'too-large' : 'missing';
    else status = 'unavailable';
    return { bucket: ref.bucket, path: ref.path, status, size: (p || d)?.size ?? null, referencedBy: ref.referencedBy.length };
  });
  const counts = {};
  for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
  return { items, counts, toCopy: items.filter((i) => i.status === 'missing') };
}

// Additive copy. `source` and `target` are Supabase-js-shaped clients. The only calls made are source download and target upload
// with upsert disabled, plus a verifying download; there is no code path that removes, replaces or updates an object.
export async function copyMissing({ plan, source, target, execute = false, log = () => {} }) {
  const results = [];
  for (const item of plan.toCopy) {
    const rec = { bucket: item.bucket, path: item.path, outcome: 'planned' };
    results.push(rec);
    if (!execute) continue;
    try {
      const got = await source.storage.from(item.bucket).download(item.path);
      if (got.error || !got.data) {
        rec.outcome = 'source-unreadable';
        continue;
      }
      const bytes = Buffer.from(await got.data.arrayBuffer());
      const up = await target.storage.from(item.bucket).upload(item.path, bytes, { upsert: false, contentType: got.data.type || undefined });
      if (up.error) {
        // The object appeared in the meantime, or the upload was refused: leave whatever is there untouched.
        rec.outcome = /exist|duplicate/i.test(String(up.error.message || up.error)) ? 'already-exists-left-untouched' : 'upload-refused';
        rec.detail = String(up.error.message || up.error);
        continue;
      }
      const back = await target.storage.from(item.bucket).download(item.path);
      const sum = (b) => crypto.createHash('sha256').update(b).digest('hex');
      const copied = back.data ? Buffer.from(await back.data.arrayBuffer()) : null;
      rec.outcome = copied && sum(copied) === sum(bytes) ? 'copied-verified' : 'copied-VERIFICATION-FAILED';
      log(`${rec.outcome}: ${item.bucket}/${item.path}`);
    } catch (e) {
      rec.outcome = 'error';
      rec.detail = String(e?.message || e).slice(0, 300);
    }
  }
  return results;
}

// Development Storage objects that no imported row references any more (reported, never deleted).
export function orphanedDevObjects(references, devInv, buckets = ['signatures', 'signed-waivers', 'physical-waivers', 'order-pictures', 'lot-pictures', 'order-evidence']) {
  const referenced = new Set(references.map((r) => `${r.bucket}/${r.path}`));
  return devInv.objects.filter((o) => buckets.includes(o.bucket) && !referenced.has(`${o.bucket}/${o.path}`));
}
