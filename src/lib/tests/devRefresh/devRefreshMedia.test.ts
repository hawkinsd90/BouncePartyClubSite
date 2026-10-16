/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
// Evidence media planning for the order data refresh: how stored references become bucket + path, how objects are classified, and the
// additive-only copy. Pure (no database, no network): inventories are synthetic and the storage clients are recording fakes.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/devRefresh/devRefreshMedia.test.ts

import { MEDIA_COLUMNS, classifyMedia, copyMissing, orphanedDevObjects, referencesOf } from '../../../../scripts/dev-refresh/lib/media.mjs';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function eq(label: string, a: unknown, b: unknown) {
  ok(`${label} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
}
const spec = (table: string, column: string) => MEDIA_COLUMNS.find((m: any) => m.table === table && m.column === column);
const PROD = 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object';
const ORDER = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';

// ---- references -------------------------------------------------------------------------------------------------------
eq('a Production public URL for a signature becomes bucket + path (the October readers sign it from the CURRENT project)', referencesOf(spec('order_signatures', 'signature_image_url'), `${PROD}/public/signatures/${ORDER}/sig.png`), [{ bucket: 'signatures', path: `${ORDER}/sig.png` }]);
eq('a signed-waiver PDF URL', referencesOf(spec('order_signatures', 'pdf_url'), `${PROD}/public/signed-waivers/${ORDER}/w.pdf`), [{ bucket: 'signed-waivers', path: `${ORDER}/w.pdf` }]);
eq('a bare object path is accepted', referencesOf(spec('order_pictures', 'file_path'), `${ORDER}/pic.jpg`), [{ bucket: 'order-pictures', path: `${ORDER}/pic.jpg` }]);
eq('a physical-waiver path', referencesOf(spec('order_signatures', 'physical_waiver_storage_path'), `${ORDER}/scan.pdf`), [{ bucket: 'physical-waivers', path: `${ORDER}/scan.pdf` }]);
eq('a URL for a DIFFERENT bucket is not a reference of this column', referencesOf(spec('order_signatures', 'signature_image_url'), `${PROD}/public/signed-waivers/${ORDER}/w.pdf`), []);
eq('an external URL is not a storage reference', referencesOf(spec('orders', 'signed_waiver_url'), 'https://evil.example/storage/v1/object/public/signed-waivers/x.pdf'), []);
eq('path traversal is rejected', referencesOf(spec('order_pictures', 'file_path'), '../../etc/passwd'), []);
eq('null / empty is nothing', [referencesOf(spec('orders', 'signed_waiver_url'), null), referencesOf(spec('orders', 'signed_waiver_url'), '')], [[], []]);
const legacy = `${PROD}/public/public-assets/${ORDER}-drop-off-1700000000-photo.jpg`;
const priv = `${ORDER}/${TASK}/delivery/33333333-3333-4333-8333-333333333333.jpg`;
eq('task evidence: a legacy public-assets URL and a private evidence path are both understood', referencesOf(spec('task_status', 'delivery_images'), [legacy, priv]), [
  { bucket: 'public-assets', path: `${ORDER}-drop-off-1700000000-photo.jpg` },
  { bucket: 'order-evidence', path: priv },
]);
eq('task evidence: unrelated strings are ignored', referencesOf(spec('task_status', 'damage_images'), ['not a url', 42, null]), []);

// ---- classification ----------------------------------------------------------------------------------------------------
const inv = (buckets: string[], objects: any[]) => ({ buckets: buckets.map((id) => ({ id, public: true })), objects: objects.map(([bucket, path, size, etag]) => ({ bucket, path, size, etag })) });
const refs = (list: Array<[string, string]>) => list.map(([bucket, path]) => ({ bucket, path, referencedBy: [{ table: 't', id: 'i', column: 'c' }] }));
const dev = inv(['signed-waivers', 'signatures'], [['signed-waivers', 'a.pdf', 10, 'e1'], ['signed-waivers', 'b.pdf', 10, 'eDEV'], ['signed-waivers', 'devonly.pdf', 1, 'x']]);
const prod = inv(['signed-waivers', 'signatures', 'lot-pictures'], [['signed-waivers', 'a.pdf', 10, 'e1'], ['signed-waivers', 'b.pdf', 10, 'ePROD'], ['signatures', 'c.png', 5, 'e3'], ['signatures', 'huge.png', 999999999, 'e9'], ['lot-pictures', 'l.jpg', 3, 'e5']]);
const plan = classifyMedia(refs([['signed-waivers', 'a.pdf'], ['signed-waivers', 'b.pdf'], ['signatures', 'c.png'], ['signatures', 'huge.png'], ['signatures', 'nowhere.png'], ['lot-pictures', 'l.jpg'], ['signed-waivers', 'devonly.pdf']]), dev, prod, { maxBytes: 1000 });
const byPath = Object.fromEntries(plan.items.map((i: any) => [i.path, i.status]));
eq('present in both with equal size and etag -> present', byPath['a.pdf'], 'present');
eq('present in both with a different etag -> conflict (never touched)', byPath['b.pdf'], 'conflict');
eq('only in Production -> missing (a copy candidate)', byPath['c.png'], 'missing');
eq('only in Production but above the size limit -> too-large (not copied)', byPath['huge.png'], 'too-large');
eq('in neither -> unavailable', byPath['nowhere.png'], 'unavailable');
eq('bucket absent in Development -> bucket-missing (buckets are never created)', byPath['l.jpg'], 'bucket-missing');
eq('only in Development -> present', byPath['devonly.pdf'], 'present');
eq('the copy list is exactly the missing objects', plan.toCopy.map((i: any) => i.path), ['c.png']);
ok('the plan carries no file contents', !JSON.stringify(plan).includes('PNGDATA'));
eq('unreferenced Development evidence objects are reported', orphanedDevObjects(refs([['signed-waivers', 'a.pdf']]), dev).map((o: any) => o.path), ['b.pdf', 'devonly.pdf']);
eq('objects outside the evidence buckets are never reported as orphans', orphanedDevObjects([], inv(['unit-images'], [['unit-images', 'x.png', 1, 'e']]), ['signatures']).length, 0);

// ---- copy: additive only -----------------------------------------------------------------------------------------------
async function main() {
  const calls: string[] = [];
  const mk = (s: string) => ({ arrayBuffer: async () => Buffer.from(s), type: 'image/png' });
  const source = { storage: { from: (b: string) => ({ download: async (p: string) => { calls.push(`src.download ${b}/${p}`); return { data: mk('PNGDATA'), error: null }; } }) } };
  const stored: Record<string, string> = {};
  const target = (mode: 'ok' | 'exists' | 'refused' | 'corrupt') => ({ storage: { from: (b: string) => ({
    upload: async (p: string, body: Buffer, o: any) => {
      calls.push(`dst.upload ${b}/${p} upsert=${o.upsert}`);
      if (mode === 'exists') return { error: { message: 'The resource already exists' } };
      if (mode === 'refused') return { error: { message: 'row-level security policy violation' } };
      stored[`${b}/${p}`] = mode === 'corrupt' ? 'OTHER' : body.toString();
      return { error: null };
    },
    download: async (p: string) => ({ data: mk(stored[`${b}/${p}`] ?? ''), error: null }),
  }) } });
  const dry = await copyMissing({ plan, source, target: target('ok'), execute: false });
  ok('dry run: no storage call at all', calls.length === 0 && dry[0].outcome === 'planned');
  const done = await copyMissing({ plan, source, target: target('ok'), execute: true });
  ok('execute: the missing object is copied and verified byte for byte', done[0].outcome === 'copied-verified' && stored['signatures/c.png'] === 'PNGDATA');
  ok('execute: upload is additive (upsert false) and the only calls are download and upload', calls.filter((c) => c.startsWith('dst.upload')).every((c) => c.endsWith('upsert=false')) && calls.every((c) => /^(src|dst)\.(download|upload)/.test(c)));
  eq('an object that appears in Development meanwhile is left untouched', (await copyMissing({ plan, source, target: target('exists'), execute: true }))[0].outcome, 'already-exists-left-untouched');
  eq('a refused upload is reported, not retried with other means', (await copyMissing({ plan, source, target: target('refused'), execute: true }))[0].outcome, 'upload-refused');
  eq('a corrupted copy is flagged', (await copyMissing({ plan, source, target: target('corrupt'), execute: true }))[0].outcome, 'copied-VERIFICATION-FAILED');
  console.log(`dev refresh media tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} dev refresh media test(s) failed`);
}
main();
