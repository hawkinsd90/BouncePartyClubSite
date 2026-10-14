// Differential tests for the pure admin photo normalizers (adminPhotoNormalizers.ts).
//
// `oracleNormalize` / `oracleCounts` are verbatim copies of the normalization loops and counts in useAdminPhotos
// as they stood before the extraction. The only changes are the two seams: the Supabase storage lookup becomes a
// fake `getPublicUrl`, and `new Date().toISOString()` becomes a deterministic counter-based clock (so the ORDER
// in which the old code consults "now" is compared too). The oracle never calls the new module. Outputs are
// compared with strict structural equality. Known quirks (URL-suffix ids, "now" fallback timestamps) are pinned.

import { normalizeAdminPhotos, countPhotosBySource, extractPathFromPublicUrl, buildCustomerName } from '../../tasks/adminPhotoNormalizers';
import type { AdminPhotoSourceRows } from '../../tasks/adminPhotoNormalizers';
import type { AdminPhoto } from '../../../hooks/admin/useAdminPhotos';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
let compared = 0;

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function eq(label: string, actual: unknown, expected: unknown) {
  if (same(actual, expected)) { passed++; } else {
    failed++;
    console.error(`FAIL ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim old code
// ---------------------------------------------------------------------------
function oldExtractPathFromPublicUrl(fullUrl: string, bucket: string): string | null {
  const marker = `/public/${bucket}/`;
  const idx = fullUrl.indexOf(marker);
  if (idx < 0) return null;
  return fullUrl.slice(idx + marker.length);
}

// Delivery / damage evidence is private: a server-side resolver (faked here) returns the bucket, path and a signed URL for
// every trusted reference of a task, and null for anything untrusted, which the library leaves out.
function fakeEvidence(_taskId: string, _kind: 'delivery' | 'damage', ref: string): { url: string | null; bucket: string | null; path: string | null } | null {
  const m = ref.match(/\/public\/public-assets\/(.+)$/);
  if (m) return { bucket: 'public-assets', path: m[1], url: `https://cdn.test/sign/public-assets/${m[1]}` };
  if (!/^https?:/.test(ref) && ref.includes('/')) return { bucket: 'order-evidence', path: ref, url: `https://cdn.test/sign/order-evidence/${ref}` };
  return null;
}

function oldBuildCustomerName(customers: { first_name: string; last_name: string } | null): string | undefined {
  if (!customers) return undefined;
  return `${customers.first_name} ${customers.last_name}`.trim() || undefined;
}

function oracleNormalize(rows: AdminPhotoSourceRows, supabaseStorage: { from: (b: string) => { getPublicUrl: (p: string) => { data: { publicUrl: string } } } }, clock: { now: () => string }): AdminPhoto[] {
  const supabase = { storage: supabaseStorage };
  const taskRes = { data: rows.taskRows }; const lotRes = { data: rows.lotRows }; const orderPicRes = { data: rows.orderPicRows };
  const unitRes = { data: rows.unitRows }; const carouselRes = { data: rows.carouselRows }; const savedLotRes = { data: rows.savedLotRows };
  const Date_ = { toISO: clock.now };

  const normalized: AdminPhoto[] = [];

  const savedLotMap = new Map<string, string>();
  for (const row of (savedLotRes.data || []) as any[]) {
    savedLotMap.set(`${row.address_id}|${row.file_path}`, row.id);
  }

  for (const row of (taskRes.data || []) as any[]) {
    const orderData = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const customerName = oldBuildCustomerName(orderData?.customers ?? null);
    const addressLine1 = orderData?.addresses
      ? (Array.isArray(orderData.addresses) ? orderData.addresses[0]?.line1 : orderData.addresses.line1)
      : undefined;
    const eventDate = orderData?.event_date ?? undefined;

    for (const url of (row.delivery_images || [])) {
      if (!url || typeof url !== 'string') continue;
      const ev = fakeEvidence(row.id, 'delivery', url);
      if (!ev || !ev.bucket) continue;
      const filePath = ev.path;
      const fileName = filePath ? filePath.split('/').pop() ?? 'delivery-photo.jpg' : 'delivery-photo.jpg';
      normalized.push({
        id: `delivery-${row.id}-${url.slice(-16)}`,
        source: 'delivery',
        public_url: ev.url ?? '',
        file_path: filePath,
        bucket: ev.bucket,
        file_name: fileName,
        created_at: row.created_at ?? Date_.toISO(),
        order_id: row.order_id,
        order_event_date: eventDate,
        customer_name: customerName,
        address_line1: addressLine1,
        task_status_id: row.id,
        is_protected_evidence: true,
        is_marketing_restricted: false,
      });
    }

    for (const url of (row.damage_images || [])) {
      if (!url || typeof url !== 'string') continue;
      const ev = fakeEvidence(row.id, 'damage', url);
      if (!ev || !ev.bucket) continue;
      const filePath = ev.path;
      const fileName = filePath ? filePath.split('/').pop() ?? 'damage-photo.jpg' : 'damage-photo.jpg';
      normalized.push({
        id: `damage-${row.id}-${url.slice(-16)}`,
        source: 'damage',
        public_url: ev.url ?? '',
        file_path: filePath,
        bucket: ev.bucket,
        file_name: fileName,
        created_at: row.created_at ?? Date_.toISO(),
        order_id: row.order_id,
        order_event_date: eventDate,
        customer_name: customerName,
        address_line1: addressLine1,
        task_status_id: row.id,
        is_protected_evidence: true,
        is_marketing_restricted: true,
      });
    }
  }

  for (const row of (lotRes.data || []) as any[]) {
    const { data: urlData } = supabase.storage
      .from('lot-pictures')
      .getPublicUrl(row.file_path);
    const orderData = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const addr = orderData?.addresses
      ? (Array.isArray(orderData.addresses) ? orderData.addresses[0] : orderData.addresses)
      : null;
    const resolvedAddressId = row.address_id ?? addr?.id ?? undefined;
    const savedKey = resolvedAddressId ? `${resolvedAddressId}|${row.file_path}` : null;
    const addressLotPictureId = savedKey ? savedLotMap.get(savedKey) : undefined;
    normalized.push({
      id: row.id,
      source: 'lot',
      public_url: urlData.publicUrl,
      file_path: row.file_path,
      bucket: 'lot-pictures',
      file_name: row.file_name,
      created_at: row.created_at ?? row.uploaded_at ?? Date_.toISO(),
      order_id: row.order_id,
      order_event_date: orderData?.event_date ?? undefined,
      customer_name: oldBuildCustomerName(orderData?.customers ?? null),
      address_id: resolvedAddressId,
      address_line1: addr?.line1,
      notes: row.notes ?? undefined,
      is_protected_evidence: false,
      is_marketing_restricted: false,
      is_saved_to_address: addressLotPictureId !== undefined,
      address_lot_picture_id: addressLotPictureId,
    });
  }

  for (const row of (orderPicRes.data || []) as any[]) {
    const { data: urlData } = supabase.storage
      .from('order-pictures')
      .getPublicUrl(row.file_path);
    const orderData = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const addr = orderData?.addresses
      ? (Array.isArray(orderData.addresses) ? orderData.addresses[0] : orderData.addresses)
      : null;
    normalized.push({
      id: row.id,
      source: 'order',
      public_url: urlData.publicUrl,
      file_path: row.file_path,
      bucket: 'order-pictures',
      file_name: row.file_name,
      created_at: row.created_at ?? row.uploaded_at ?? Date_.toISO(),
      order_id: row.order_id,
      order_event_date: orderData?.event_date ?? undefined,
      customer_name: oldBuildCustomerName(orderData?.customers ?? null),
      address_id: addr?.id,
      address_line1: addr?.line1,
      notes: row.notes ?? undefined,
      is_protected_evidence: false,
      is_marketing_restricted: false,
    });
  }

  for (const row of (unitRes.data || []) as any[]) {
    const unitData = Array.isArray(row.units) ? row.units[0] : row.units;
    const url = row.url;
    const fileName = url.split('/').pop() ?? 'unit-image.jpg';
    normalized.push({
      id: row.id,
      source: 'unit',
      public_url: url,
      file_path: null,
      bucket: 'unit-images',
      file_name: row.alt || fileName,
      created_at: row.created_at ?? Date_.toISO(),
      unit_id: row.unit_id ?? undefined,
      unit_name: unitData?.name ?? undefined,
      is_protected_evidence: false,
      is_marketing_restricted: false,
    });
  }

  for (const row of (carouselRes.data || []) as any[]) {
    if (row.media_type === 'video') continue;
    const url = row.image_url;
    const fileName = row.storage_path
      ? row.storage_path.split('/').pop() ?? 'carousel-image.jpg'
      : url.split('/').pop() ?? 'carousel-image.jpg';
    normalized.push({
      id: row.id,
      source: 'carousel',
      public_url: url,
      file_path: row.storage_path ?? null,
      bucket: row.storage_path ? 'carousel-media' : null,
      file_name: row.title ?? fileName,
      created_at: row.created_at ?? Date_.toISO(),
      is_protected_evidence: false,
      is_marketing_restricted: false,
    });
  }

  normalized.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return normalized;
}

function oracleCounts(photos: AdminPhoto[]) {
  return {
    total: photos.length,
    lot: photos.filter(p => p.source === 'lot').length,
    order: photos.filter(p => p.source === 'order').length,
    delivery: photos.filter(p => p.source === 'delivery').length,
    damage: photos.filter(p => p.source === 'damage').length,
    unit: photos.filter(p => p.source === 'unit').length,
    carousel: photos.filter(p => p.source === 'carousel').length,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const emptyRows = (): AdminPhotoSourceRows => ({ taskRows: [], lotRows: [], orderPicRows: [], unitRows: [], carouselRows: [], savedLotRows: [] });

function counterClock() {
  let n = 0;
  const calls: number[] = [];
  return { now: () => { n++; calls.push(n); return new Date(Date.UTC(2030, 0, 1, 0, 0, n)).toISOString(); }, calls };
}

function run(label: string, rows: AdminPhotoSourceRows) {
  compared++;
  const resolverCalls: Array<[string, string]> = [];
  const storage = { from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }) }) };
  const oc = counterClock();
  const expected = oracleNormalize(rows, storage, oc);
  const nc = counterClock();
  const actual = normalizeAdminPhotos(rows, {
    resolveMediaUrl: (bucket, path) => { resolverCalls.push([bucket, path]); return `https://cdn.test/${bucket}/${path}`; },
    resolveEvidence: (taskId, kind, ref) => fakeEvidence(taskId, kind, ref),
    nowIso: nc.now,
  });
  ok(`${label}: full AdminPhoto[] equals the old normalization`, same(actual, expected));
  ok(`${label}: the clock is consulted the same number of times`, oc.calls.length === nc.calls.length);
  ok(`${label}: counts equal`, same(countPhotosBySource(actual), oracleCounts(expected)));
  return { actual, resolverCalls };
}

const ORDER = (over: any = {}) => ({ event_date: '2026-07-04', customers: { first_name: 'Ann', last_name: 'Lee' }, addresses: { id: 'addr-1', line1: '1 Main St' }, ...over });
const URL = (name: string) => `https://x.supabase.co/storage/v1/object/public/public-assets/${name}`;

// ---- one row from every source ----
{
  const rows: AdminPhotoSourceRows = {
    taskRows: [{ id: 'ts1', order_id: 'o1', task_type: 'drop-off', delivery_images: [URL('o1-drop-off-111-a.jpg')], damage_images: [URL('o1-drop-off-222-b.jpg')], created_at: '2026-06-03T10:00:00Z', orders: ORDER() }],
    lotRows: [{ id: 'lot1', order_id: 'o1', file_path: 'o1/lot.jpg', file_name: 'lot.jpg', notes: 'gate', created_at: '2026-06-05T10:00:00Z', uploaded_at: null, address_id: null, orders: ORDER() }],
    orderPicRows: [{ id: 'op1', order_id: 'o1', file_path: 'o1/p.jpg', file_name: 'p.jpg', file_size: 5, mime_type: 'image/jpeg', notes: null, uploaded_at: '2026-06-02T10:00:00Z', created_at: '2026-06-04T10:00:00Z', orders: ORDER() }],
    unitRows: [{ id: 'um1', unit_id: 'u1', url: 'https://x.supabase.co/storage/v1/object/public/unit-images/castle.jpg', alt: 'Castle front', sort: 1, mode: 'dry', is_featured: true, created_at: '2026-06-01T10:00:00Z', units: { name: 'Castle' } }],
    carouselRows: [{ id: 'car1', image_url: 'https://x.supabase.co/storage/v1/object/public/carousel-media/hero.jpg', title: 'Hero', description: null, media_type: 'image', storage_path: 'carousel/hero.jpg', display_order: 1, is_active: true, created_at: '2026-06-06T10:00:00Z', updated_at: null }],
    savedLotRows: [{ id: 'saved1', address_id: 'addr-1', file_path: 'o1/lot.jpg' }],
  };
  const { actual, resolverCalls } = run('one row of every source', rows);
  eq('every source is present, newest first', actual.map((p) => p.source), ['carousel', 'lot', 'order', 'delivery', 'damage', 'unit']);
  eq('resolver is asked for lot and order buckets only, with the row paths', resolverCalls, [['lot-pictures', 'o1/lot.jpg'], ['order-pictures', 'o1/p.jpg']]);
  const lot = actual.find((p) => p.source === 'lot')!;
  eq('lot photo: saved to address via the address_lot_pictures map', [lot.is_saved_to_address, lot.address_lot_picture_id, lot.address_id, lot.public_url], [true, 'saved1', 'addr-1', 'https://cdn.test/lot-pictures/o1/lot.jpg']);
  const delivery = actual.find((p) => p.source === 'delivery')!; const damage = actual.find((p) => p.source === 'damage')!;
  eq('protection and marketing flags: delivery protected + promotable, damage protected + restricted', [delivery.is_protected_evidence, delivery.is_marketing_restricted, damage.is_protected_evidence, damage.is_marketing_restricted], [true, false, true, true]);
  eq('delivery file name and path come from the public URL', [delivery.file_path, delivery.file_name, delivery.bucket], ['o1-drop-off-111-a.jpg', 'o1-drop-off-111-a.jpg', 'public-assets']);
  eq('counts', countPhotosBySource(actual), { total: 6, lot: 1, order: 1, delivery: 1, damage: 1, unit: 1, carousel: 1 });
}

// ---- joined order / address shapes (object vs array vs missing) ----
{
  const shapes: any[] = [
    ORDER(), { ...ORDER(), customers: null }, { ...ORDER(), addresses: null }, { ...ORDER(), event_date: null },
    null, [ORDER()], [], [{ ...ORDER(), addresses: [{ id: 'a2', line1: '2 Oak' }] }], { ...ORDER(), addresses: [{ id: 'a3', line1: '3 Elm' }] },
    { ...ORDER(), addresses: [] }, { ...ORDER(), customers: { first_name: '', last_name: '' } }, { ...ORDER(), customers: { first_name: 'Solo', last_name: '' } },
  ];
  shapes.forEach((orders, i) => {
    run(`joined order shape ${i}`, {
      ...emptyRows(),
      taskRows: [{ id: `ts${i}`, order_id: 'o1', task_type: 'drop-off', delivery_images: [URL(`d${i}.jpg`)], damage_images: [URL(`x${i}.jpg`)], created_at: '2026-06-03T10:00:00Z', orders }],
      lotRows: [{ id: `lot${i}`, order_id: 'o1', file_path: `p${i}.jpg`, file_name: 'l.jpg', notes: null, created_at: '2026-06-05T10:00:00Z', uploaded_at: null, address_id: i % 2 ? 'row-addr' : null, orders }],
      orderPicRows: [{ id: `op${i}`, order_id: 'o1', file_path: `q${i}.jpg`, file_name: 'q.jpg', file_size: 1, mime_type: 'image/jpeg', notes: 'n', uploaded_at: '2026-06-02T10:00:00Z', created_at: '2026-06-04T10:00:00Z', orders }],
      savedLotRows: [{ id: 'sv', address_id: 'row-addr', file_path: `p${i}.jpg` }, { id: 'sv2', address_id: 'a2', file_path: `p${i}.jpg` }, { id: 'sv3', address_id: 'addr-1', file_path: `p${i}.jpg` }],
    });
  });
}

// ---- file names, missing timestamps ("now" fallback), ids ----
{
  const t0 = '2026-06-03T10:00:00Z';
  const rows: AdminPhotoSourceRows = {
    taskRows: [
      { id: 'tsA', order_id: 'o1', task_type: 'drop-off', delivery_images: ['https://other.host/not-supabase/photo.jpg', 'https://x.supabase.co/public-assets/no-public-segment.jpg', '', null as any, 42 as any, URL('nested/dir/leaf.png'), URL('')], damage_images: ['plain', URL('sub/'), URL('a.b.c')], created_at: null as any, orders: ORDER() },
      { id: 'tsB', order_id: 'o2', task_type: 'pick-up', delivery_images: null, damage_images: null, created_at: t0, orders: null },
    ],
    lotRows: [
      { id: 'l1', order_id: 'o1', file_path: 'a.jpg', file_name: 'a.jpg', notes: null, created_at: null, uploaded_at: '2026-06-09T00:00:00Z', address_id: null, orders: null },
      { id: 'l2', order_id: 'o1', file_path: 'b.jpg', file_name: 'b.jpg', notes: 'x', created_at: null, uploaded_at: null, address_id: null, orders: null },
    ],
    orderPicRows: [{ id: 'o1', order_id: 'o1', file_path: 'c.jpg', file_name: 'c.jpg', file_size: 1, mime_type: 'image/png', notes: null, uploaded_at: '2026-06-08T00:00:00Z', created_at: null as any, orders: null }, { id: 'o2', order_id: 'o1', file_path: 'd.jpg', file_name: 'd.jpg', file_size: 1, mime_type: 'image/png', notes: null, uploaded_at: null as any, created_at: null as any, orders: null }],
    unitRows: [
      { id: 'u1', unit_id: null, url: 'https://x/y/z.jpg', alt: '', sort: null, mode: null, is_featured: null, created_at: null, units: null },
      { id: 'u2', unit_id: 'uu', url: 'https://x/y/castle.jpg', alt: 'Alt text', sort: 2, mode: 'water', is_featured: false, created_at: t0, units: [{ name: 'Arr' }] as any },
      { id: 'u3', unit_id: 'uu', url: 'no-slash', alt: '', sort: null, mode: null, is_featured: null, created_at: t0, units: { name: 'Obj' } },
    ],
    carouselRows: [
      { id: 'c1', image_url: 'https://x/c/one.jpg', title: null, description: null, media_type: 'image', storage_path: null, display_order: 1, is_active: true, created_at: null, updated_at: null },
      { id: 'c2', image_url: 'https://x/c/two.mp4', title: 'Vid', description: null, media_type: 'video', storage_path: 'c/two.mp4', display_order: 2, is_active: true, created_at: t0, updated_at: null },
      { id: 'c3', image_url: 'https://x/c/three.jpg', title: '', description: null, media_type: 'image', storage_path: 'folder/three.jpg', display_order: 3, is_active: false, created_at: t0, updated_at: null },
      { id: 'c5', image_url: 'https://x/c/url-leaf.jpg', title: null, description: null, media_type: 'image', storage_path: 'folder/sub/storage-leaf.jpg', display_order: 5, is_active: true, created_at: t0, updated_at: null },
      { id: 'c4', image_url: 'https://x/c/four.jpg', title: 'Four', description: null, media_type: 'image', storage_path: '', display_order: 4, is_active: true, created_at: t0, updated_at: null },
    ],
    savedLotRows: [],
  };
  const { actual } = run('file names, fallbacks and ids', rows);
  ok('video carousel entries are skipped', !actual.some((p) => p.id === 'c2'));
  eq('carousel file name falls back to the storage path leaf before the URL leaf', actual.find((p) => p.id === 'c5')?.file_name, 'storage-leaf.jpg');
  eq('empty carousel title is kept (nullish coalescing), not replaced', actual.find((p) => p.id === 'c3')?.file_name, '');
  eq('empty storage_path counts as no storage path', [actual.find((p) => p.id === 'c4')?.bucket, actual.find((p) => p.id === 'c4')?.file_path], [null, '']);
  eq('lot with no timestamps falls back to "now" via the injected clock', actual.find((p) => p.id === 'l2')?.created_at.startsWith('2030-'), true);
  eq('lot falls back to uploaded_at before "now"', actual.find((p) => p.id === 'l1')?.created_at, '2026-06-09T00:00:00Z');
  eq('non-string and empty delivery entries are skipped; references the server does not trust (foreign hosts, other buckets, empty paths) are left out of the library', actual.filter((p) => p.source === 'delivery').map((p) => [p.file_name, p.file_path]).sort(), [['leaf.png', 'nested/dir/leaf.png']]);
}

// ---- KNOWN QUIRK: URL-suffix ids can collide within one task status ----
{
  const sameTail = 'https://x.supabase.co/storage/v1/object/public/public-assets/';
  const rows: AdminPhotoSourceRows = { ...emptyRows(), taskRows: [{ id: 'tsQ', order_id: 'o1', task_type: 'drop-off', delivery_images: [`${sameTail}first/aaaaaaaaaaaaaaaa.jpg`, `${sameTail}second/aaaaaaaaaaaaaaaa.jpg`], damage_images: [], created_at: '2026-06-03T10:00:00Z', orders: ORDER() }] };
  const { actual } = run('URL suffix collision', rows);
  eq('KNOWN QUIRK: two photos ending the same way get the same id', [actual.length, actual[0].id === actual[1].id], [2, true]);
  eq('the id is delivery-<task status id>-<last 16 URL characters>', actual[0].id, 'delivery-tsQ-aaaaaaaaaaaaaaaa.jpg'.slice(0, 'delivery-tsQ-'.length) + ('https://x.supabase.co/storage/v1/object/public/public-assets/first/aaaaaaaaaaaaaaaa.jpg').slice(-16));
}

// ---- empty sources and counts ----
{
  const { actual } = run('empty sources', emptyRows());
  eq('empty input yields no photos and zero counts', [actual, countPhotosBySource(actual)], [[], { total: 0, lot: 0, order: 0, delivery: 0, damage: 0, unit: 0, carousel: 0 }]);
  run('only carousel videos', { ...emptyRows(), carouselRows: [{ id: 'v', image_url: 'x', title: null, description: null, media_type: 'video', storage_path: null, display_order: 1, is_active: true, created_at: null, updated_at: null }] });
}

// ---- helpers ----
{
  for (const [url, bucket] of [[URL('a/b.jpg'), 'public-assets'], [URL('a/b.jpg'), 'other'], ['no-marker', 'public-assets'], ['x/public/public-assets/', 'public-assets']] as Array<[string, string]>) {
    ok(`extractPathFromPublicUrl(${url}, ${bucket}) matches the old function`, extractPathFromPublicUrl(url, bucket) === oldExtractPathFromPublicUrl(url, bucket));
  }
  for (const c of [null, { first_name: 'A', last_name: 'B' }, { first_name: '', last_name: '' }, { first_name: ' A ', last_name: '' }, { first_name: 'A', last_name: ' ' }]) {
    ok(`buildCustomerName(${JSON.stringify(c)}) matches the old function`, buildCustomerName(c as any) === oldBuildCustomerName(c as any));
  }
}

// ---- seeded grid ----
{
  let s = 20261008;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const times = ['2026-06-01T10:00:00Z', '2026-06-02T10:00:00Z', '2026-06-01T10:00:00Z', null, '', 'not-a-date'];
  const joined = () => pick([ORDER(), null, [ORDER()], { ...ORDER(), addresses: null }, { ...ORDER(), customers: null, event_date: null }, { ...ORDER(), addresses: [{ id: 'g2', line1: 'G' }] }]);
  for (let n = 0; n < 250; n++) {
    const rows: AdminPhotoSourceRows = {
      taskRows: Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({ id: `t${n}-${i}`, order_id: 'o', task_type: pick(['drop-off', 'pick-up']), delivery_images: pick([null, [], [URL(`d${i}.jpg`)], [URL('same-tail-aaaaaaaa.jpg'), URL('other/same-tail-aaaaaaaa.jpg')]]), damage_images: pick([null, [], [URL(`x${i}.jpg`), '', 7 as any]]), created_at: pick(times) as any, orders: joined() as any })),
      lotRows: Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({ id: `l${n}-${i}`, order_id: 'o', file_path: `lot${i}.jpg`, file_name: `lot${i}.jpg`, notes: pick([null, 'n']), created_at: pick(times) as any, uploaded_at: pick(times) as any, address_id: pick([null, 'row-addr', 'addr-1']), orders: joined() as any })),
      orderPicRows: Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({ id: `p${n}-${i}`, order_id: 'o', file_path: `op${i}.jpg`, file_name: `op${i}.jpg`, file_size: 1, mime_type: 'image/jpeg', notes: pick([null, 'n']), uploaded_at: pick(times) as any, created_at: pick(times) as any, orders: joined() as any })),
      unitRows: Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({ id: `u${n}-${i}`, unit_id: pick([null, 'u']), url: pick(['https://x/y/a.jpg', 'plain']), alt: pick(['', 'Alt']), sort: null, mode: null, is_featured: null, created_at: pick(times) as any, units: pick([null, { name: 'U' }, [{ name: 'A' }]]) as any })),
      carouselRows: Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({ id: `c${n}-${i}`, image_url: 'https://x/c/a.jpg', title: pick([null, '', 'T']), description: null, media_type: pick(['image', 'video']), storage_path: pick([null, '', 'f/a.jpg']), display_order: 1, is_active: true, created_at: pick(times) as any, updated_at: null })),
      savedLotRows: pick([[], [{ id: 'sv', address_id: 'addr-1', file_path: 'lot0.jpg' }], [{ id: 'sv', address_id: 'row-addr', file_path: 'lot1.jpg' }, { id: 'sv2', address_id: 'g2', file_path: 'lot0.jpg' }]]),
    };
    run(`seeded ${n}`, rows);
  }
}

console.log(`Admin photo normalizer differential tests: ${passed} passed, ${failed} failed (${compared} compared scenarios)`);
if (failed > 0) throw new Error(`${failed} admin photo normalizer test(s) failed`);
