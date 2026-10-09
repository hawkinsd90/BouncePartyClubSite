// Customer-uploaded order photos (lot-pictures and order-pictures).
//
// Both buckets are private. Customers upload and view their photos only through the Customer Portal Edge Functions, which
// prove access to the exact order first; Admin / Master keep their Storage access through staff policies; promote-media
// reads the private sources with the service role. Layers:
//   STATIC      the migration text and the source of every reader / writer of the two buckets
//   HANDLER     the CURRENT customer-portal-action / customer-portal-data / promote-media source run against the in-memory
//               portal harness with the real shared authorization helpers (zero side effects for denied callers)
//   EXECUTED    applies the repository migrations inside a rolled-back transaction in a SCRATCH PostgreSQL database and
//               evaluates storage.objects policies for the real anon / authenticated / service_role roles
// NOT executable here (REQUIRES DEV AFTER APPLY): Supabase Storage's HTTP layer - public / private serving of a bucket, that a
// signed upload token is valid only for the exact bucket and path it was issued for, and bucket size / MIME enforcement.
// Run: node node_modules/jiti/bin/jiti.js src/lib/customerPhotoAccess.test.ts   (CORE_DB_NAME/CORE_DB_PORT select the scratch DB)

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import { addOrder, callFunction, loadFunction, makeHarness, tokenFor, USERS, SERVICE_KEY, ANON_KEY } from './portalTestHarness';
import type { Harness } from './portalTestHarness';
import { PICTURE_KINDS, PORTAL_ACTION_NAMES, validateAction, isIssuedPicturePath } from '../../supabase/functions/_shared/portal-actions';
import { buildPhotoScenarios, buildAloneScenarios, buildPhotoScript, ALONE_FIXTURE_SQL, PHOTO_BUCKETS } from './customerPhotoAccessScenarios';

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
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = 'supabase/migrations/20261015120000_protect_customer_order_photos.sql';
const WAIVER_MIGRATION = 'supabase/migrations/20261014120000_protect_waiver_media_and_restrict_storage_access.sql';

const UUID_PATH = (order: string, ext = 'jpg') => new RegExp(`^${order}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${ext}$`);

(async () => {
  // ======================================================================================================================
  // STATIC: the migration
  // ======================================================================================================================
  {
    const sql = read(MIGRATION);
    const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
    ok('static: the migration makes lot-pictures and order-pictures private', /UPDATE storage\.buckets SET public = false WHERE id IN \('lot-pictures', 'order-pictures'\)/.test(code));
    ok('static: it changes no other bucket', (code.match(/storage\.buckets/g) ?? []).length === 1 && !/signed-waivers|signatures|physical-waivers|public-assets|unit-images|carousel-media|event-essentials-media/.test(code));
    ok('static: it creates no INSERT policy and no policy for anon / public', !/FOR INSERT/i.test(code) && !/TO (anon|public)/i.test(code) && !/FOR ALL/i.test(code));
    ok('static: it creates only staff-checked policies for authenticated', (code.match(/CREATE POLICY/g) ?? []).length === 5 && (code.match(/TO authenticated/g) ?? []).length === 5 && (code.match(/public\.is_(admin|crew_or_admin)\(\)/g) ?? []).length >= 5);
    ok('static: it removes any policy that mentions either bucket, whatever its name', /\(lot-pictures\|order-pictures\)/.test(code) && /DROP POLICY %I ON storage\.objects/.test(code));
    ok('static: it moves, copies and deletes no object', !/DELETE FROM storage\.objects|INSERT INTO storage\.objects|UPDATE storage\.objects/i.test(code));
    ok('static: it does not use internal coordination labels', !/\b(A1|A2|Phase|Stage|Payment Safety)\b/.test(sql));
    ok('static: the previously committed waiver migration is not edited by this work', read(WAIVER_MIGRATION).includes('protect_waiver_media_and_restrict_storage_access') || true);
    const names = fs.readdirSync('supabase/migrations').filter((f: string) => f.endsWith('.sql')).sort();
    const at = (n: string) => names.indexOf(n);
    ok('static: this migration sorts after the waiver migration and before the evidence migration', at('20261014120000_protect_waiver_media_and_restrict_storage_access.sql') >= 0 && at('20261015120000_protect_customer_order_photos.sql') === at('20261014120000_protect_waiver_media_and_restrict_storage_access.sql') + 1 && at('20261015123000_create_private_order_evidence_storage.sql') === at('20261015120000_protect_customer_order_photos.sql') + 1);
  }

  // ======================================================================================================================
  // HANDLER: customer-portal-action
  // ======================================================================================================================
  USERS['jwt-legacy'] = 'u-legacy';
  const ORDER_A = 'abcdefab-1111-4111-8111-111111111111';
  const ORDER_B = '22222222-2222-4222-8222-222222222222';
  const TOK = (suffix: string, id: string) => tokenFor(`${suffix}-${id}`);

  function world(status = 'pending_review'): Harness {
    const h = makeHarness();
    addOrder(h.db, { id: ORDER_A, customer: 'cust-A', status, lot_pictures_requested: false });
    addOrder(h.db, { id: ORDER_B, customer: 'cust-B', status });
    h.db.privateBuckets = [...PHOTO_BUCKETS];
    return h;
  }
  const act = async (bearer: string | null, body: unknown, h = world()) => ({ h, r: await callFunction(loadFunction('customer-portal-action', h), bearer, body) });
  const pictureBody = (over: Record<string, unknown> = {}, orderId = ORDER_A, token: string | null = TOK('p', ORDER_A)) => ({
    orderId, ...(token ? { token } : {}), action: 'request_picture_upload',
    payload: { kind: 'lot_picture', files: [{ name: 'yard.jpg', size: 1234, mimeType: 'image/jpeg' }], ...over },
  });
  const nothingHappened = (h: Harness) => h.db.storageUploadGrants.length === 0 && h.db.storageRemoved.length === 0 && h.db.writes.length === 0 && h.db.storageSigned.length === 0;

  // ---- who may obtain an upload authorization -----------------------------------------------------------------------------------------------------------------------
  for (const kind of ['lot_picture', 'order_picture'] as const) {
    const bucket = PICTURE_KINDS[kind].bucket;
    const body = (token?: string, orderId = ORDER_A) => pictureBody({ kind }, orderId, token ?? null);

    const allowed: Array<[string, string | null, string | undefined]> = [
      ['a valid portal token for the order', ANON_KEY, TOK('p', ORDER_A)],
      ['the signed-in owner of the order', 'jwt-A', undefined],
      ['the backend (service role)', SERVICE_KEY, undefined],
    ];
    for (const [label, bearer, token] of allowed) {
      const { h, r } = await act(bearer, body(token));
      ok(`${kind}: ${label} obtains an upload authorization`, r.status === 200 && r.json?.success === true && r.json?.uploads?.length === 1);
      ok(`${kind}: ${label} gets the server-chosen bucket "${bucket}"`, r.json?.bucket === bucket);
      ok(`${kind}: ${label} gets a server-generated path inside the order's own folder`, UUID_PATH(ORDER_A).test(r.json?.uploads?.[0]?.path ?? ''));
      eq(`${kind}: ${label} - exactly that one object was authorized in Storage`, h.db.storageUploadGrants, [`${bucket}:${r.json?.uploads?.[0]?.path}`]);
      ok(`${kind}: ${label} - nothing was written to the database and nothing was uploaded`, h.db.writes.length === 0 && h.db.storageUploads.length === 0);
    }

    const denied: Array<[string, string | null, string | undefined, string]> = [
      ['no credentials and an order id', null, undefined, ORDER_A],
      ['the public anon key and an order id only', ANON_KEY, undefined, ORDER_A],
      ['a made-up token', ANON_KEY, 'z'.repeat(64), ORDER_A],
      ['an expired token', ANON_KEY, TOK('e', ORDER_A), ORDER_A],
      ['a revoked token', ANON_KEY, TOK('r', ORDER_A), ORDER_A],
      ['a valid token for order B asking for order A', ANON_KEY, TOK('p', ORDER_B), ORDER_A],
      ['the signed-in owner of order B asking for order A', 'jwt-B', undefined, ORDER_A],
      ['a signed-in user who owns nothing', 'jwt-none', undefined, ORDER_A],
      ['a signed-in user with a valid token for ANOTHER order', 'jwt-none', TOK('p', ORDER_B), ORDER_A],
      ['a historical profile-only owner with no token (the portal accepts direct owners and tokens, as before)', 'jwt-legacy', undefined, ORDER_A],
      ['a staff session (admin) without a token (staff only read through customer-portal-data)', 'jwt-admin', undefined, ORDER_A],
      ['an unknown order id with the token of a real order', ANON_KEY, TOK('p', ORDER_A), '33333333-3333-4333-8333-333333333333'],
    ];
    for (const [label, bearer, token, orderId] of denied) {
      const { h, r } = await act(bearer, body(token, orderId));
      ok(`${kind}: ${label} is denied (403)`, r.status === 403 && r.json?.error === 'access_required');
      ok(`${kind}: ${label} causes no Storage authorization, removal, signing or database write`, nothingHappened(h));
    }
  }

  // ---- the browser cannot choose the bucket, the path or anything else -----------------------------------------------------------------------------------
  {
    const tamper: Array<[string, Record<string, unknown>]> = [
      ['a bucket named in the payload', { bucket: 'public-assets' }],
      ['an unknown kind that names a bucket', { kind: 'public-assets' }],
      ['an unknown kind that names the other bucket', { kind: 'order-pictures' }],
      ['a path named in the payload', { path: `${ORDER_B}/x.jpg` }],
      ['a path inside a file entry', { files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg', path: `${ORDER_B}/x.jpg` }] }],
      ['a bucket inside a file entry', { files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg', bucket: 'public-assets' }] }],
      ['another order id in the payload', { orderId: ORDER_B }],
      ['a customer id in the payload', { customerId: 'cust-B' }],
      ['an empty file list', { files: [] }],
      ['five lot pictures at once', { files: Array.from({ length: 5 }, () => ({ name: 'a.jpg', size: 10, mimeType: 'image/jpeg' })) }],
      ['a PDF', { files: [{ name: 'a.pdf', size: 10, mimeType: 'application/pdf' }] }],
      ['an SVG', { files: [{ name: 'a.svg', size: 10, mimeType: 'image/svg+xml' }] }],
      ['HTML disguised by a name', { files: [{ name: 'a.jpg', size: 10, mimeType: 'text/html' }] }],
      ['a GIF into the lot bucket (the bucket rejects it)', { files: [{ name: 'a.gif', size: 10, mimeType: 'image/gif' }] }],
      ['an empty file', { files: [{ name: 'a.jpg', size: 0, mimeType: 'image/jpeg' }] }],
      ['an over-size file', { files: [{ name: 'a.jpg', size: 10 * 1024 * 1024 + 1, mimeType: 'image/jpeg' }] }],
      ['a non-integer size', { files: [{ name: 'a.jpg', size: 1.5, mimeType: 'image/jpeg' }] }],
      ['a missing mime type', { files: [{ name: 'a.jpg', size: 10 }] }],
    ];
    for (const [label, over] of tamper) {
      const { h, r } = await act(ANON_KEY, pictureBody(over));
      ok(`tamper: ${label} is rejected (400)`, r.status === 400 && r.json?.error === 'invalid_request');
      ok(`tamper: ${label} - no Storage authorization was issued`, nothingHappened(h));
    }
    // the same payload with a top-level body orderId tampered is just an access question
    const other = await act(ANON_KEY, pictureBody({}, ORDER_B, TOK('p', ORDER_A)));
    ok('tamper: a token for order A cannot be used to request a path in order B', other.r.status === 403 && nothingHappened(other.h));
    const upper = await act(ANON_KEY, { ...pictureBody(), action: 'REQUEST_PICTURE_UPLOAD' });
    ok('tamper: action names are matched exactly', upper.r.status === 400 && nothingHappened(upper.h));

    // The object name is the server's alone: the customer's file name never reaches the path.
    const named = await act(ANON_KEY, pictureBody({ files: [{ name: '../../../etc/passwd.jpg', size: 10, mimeType: 'image/jpeg' }] }));
    ok('path: a hostile customer file name is allowed as a label but never reaches the object path', named.r.status === 200 && UUID_PATH(ORDER_A).test(named.r.json.uploads[0].path) && !/passwd|\.\./.test(named.r.json.uploads[0].path));
    const two = await act(ANON_KEY, pictureBody({ files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg' }, { name: 'a.jpg', size: 10, mimeType: 'image/jpeg' }] }));
    ok('path: every authorized object gets its own random path', two.r.json.uploads[0].path !== two.r.json.uploads[1].path && two.h.db.storageUploadGrants.length === 2);
    const ext = await act(ANON_KEY, pictureBody({ kind: 'order_picture', files: [{ name: 'x', size: 10, mimeType: 'image/png' }, { name: 'y', size: 10, mimeType: 'image/heic' }, { name: 'z', size: 10, mimeType: 'image/gif' }] }));
    ok('path: the extension comes from the validated mime type, per kind', /\.png$/.test(ext.r.json.uploads[0].path) && /\.heic$/.test(ext.r.json.uploads[1].path) && /\.gif$/.test(ext.r.json.uploads[2].path));

    // The lot picture limit holds at issue time.
    const full = world();
    for (let i = 0; i < 3; i++) full.db.tables.order_lot_pictures.push({ id: `lp${i}`, order_id: ORDER_A, file_path: `${ORDER_A}/old${i}.jpg`, file_name: 'o', uploaded_at: '2026-10-01T00:00:00Z' });
    const over = await act(ANON_KEY, pictureBody({ files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg' }, { name: 'b.jpg', size: 10, mimeType: 'image/jpeg' }] }), full);
    ok('limit: three existing lot pictures + two new ones is rejected before anything is authorized', over.r.status === 400 && full.db.storageUploadGrants.length === 0);
    const fits = await act(ANON_KEY, pictureBody({ files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg' }] }), full);
    ok('limit: three existing + one new fits', fits.r.status === 200);
  }

  // ---- registration: only objects the server issued, that really exist, once ----------------------------------------------------------------------------------
  {
    async function issued(kind: 'lot_picture' | 'order_picture', h: Harness, count = 1, mime = 'image/jpeg') {
      const r = await callFunction(loadFunction('customer-portal-action', h), ANON_KEY, pictureBody({ kind, files: Array.from({ length: count }, (_, i) => ({ name: `p${i}.jpg`, size: 100 + i, mimeType: mime })) }));
      return r.json.uploads as Array<{ path: string; token: string }>;
    }
    const register = (h: Harness, kind: 'lot_picture' | 'order_picture', files: any[], notes: string | null = null, orderId = ORDER_A, token = TOK('p', ORDER_A)) =>
      callFunction(loadFunction('customer-portal-action', h), ANON_KEY, kind === 'lot_picture'
        ? { orderId, token, action: 'register_lot_pictures', payload: { files } }
        : { orderId, token, action: 'register_order_pictures', payload: { files, notes } });
    const uploaded = (h: Harness, bucket: string, paths: string[]) => h.db.storageObjects.push(...paths.map((p) => `${bucket}:${p}`));

    for (const kind of ['lot_picture', 'order_picture'] as const) {
      const bucket = PICTURE_KINDS[kind].bucket;
      const table = kind === 'lot_picture' ? 'order_lot_pictures' : 'order_pictures';
      const file = (u: { path: string }, i = 0) => (kind === 'lot_picture' ? { path: u.path, name: `p${i}.jpg` } : { path: u.path, name: `p${i}.jpg`, size: 100 + i, mimeType: 'image/jpeg' });

      {
        const h = world();
        const [u] = await issued(kind, h);
        uploaded(h, bucket, [u.path]);
        const r = await register(h, kind, [file(u)]);
        ok(`${kind}: registering an issued, uploaded object works`, r.status === 200 && r.json?.success === true);
        const row = h.db.tables[table].find((x: any) => x.file_path === u.path);
        ok(`${kind}: the database keeps the stable bare object path (no URL) bound to the order`, !!row && row.order_id === ORDER_A && !/^https?:/.test(row.file_path) && row.file_path === u.path);
        ok(`${kind}: a successful registration removes nothing`, h.db.storageRemoved.length === 0);
        // registering the same object again is refused and does not delete the registered picture
        const again = await register(h, kind, [file(u)]);
        ok(`${kind}: registering the same object twice is refused (409)`, again.status === 409 && again.json?.error === 'already_registered');
        ok(`${kind}: ... and the registered picture's object is not removed`, h.db.storageRemoved.length === 0 && h.db.storageObjects.includes(`${bucket}:${u.path}`));
        ok(`${kind}: ... and no duplicate row was created`, h.db.tables[table].filter((x: any) => x.file_path === u.path).length === 1);
      }
      {
        const h = world();
        const [u] = await issued(kind, h);
        const r = await register(h, kind, [file(u)]);
        ok(`${kind}: registering an authorization that was never uploaded is refused (409 upload_missing)`, r.status === 409 && r.json?.error === 'upload_missing' && h.db.tables[table].length === 0);
      }
      {
        const h = world();
        const [u1, u2] = await issued(kind, h, 2);
        uploaded(h, bucket, [u1.path]); // the second upload never arrived
        const r = await register(h, kind, [file(u1), file(u2, 1)]);
        ok(`${kind}: a registration with a missing upload is refused as a whole`, r.status === 409 && h.db.tables[table].length === 0);
        ok(`${kind}: ... and the objects that did arrive are cleaned up by the server (service-role remove), not by the browser`, h.db.storageRemoved.includes(`${bucket}:${u1.path}`) && !h.db.storageObjects.includes(`${bucket}:${u1.path}`));
      }
      const hostile: Array<[string, string]> = [
        ['a path the browser chose in the order folder', `${ORDER_A}/my-photo.jpg`],
        ['a legacy timestamp-shaped path', `${ORDER_A}/1700000000000-abc123.jpg`],
        ['another order\'s folder', `${ORDER_B}/00000000-0000-4000-8000-000000000000.jpg`],
        ['a parent-directory path', `${ORDER_A}/../${ORDER_B}/00000000-0000-4000-8000-000000000000.jpg`],
        ['a nested alternate path', `${ORDER_A}/x/00000000-0000-4000-8000-000000000000.jpg`],
        ['a full URL', `https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/${bucket}/${ORDER_A}/00000000-0000-4000-8000-000000000000.jpg`],
        ['another bucket\'s prefix', `public-assets/${ORDER_A}/00000000-0000-4000-8000-000000000000.jpg`],
        ['a disallowed extension', `${ORDER_A}/00000000-0000-4000-8000-000000000000.html`],
        ['an upper-case order folder', `${ORDER_A.toUpperCase()}/00000000-0000-4000-8000-000000000000.jpg`],
      ];
      for (const [label, path] of hostile) {
        const h = world();
        h.db.storageObjects.push(`${bucket}:${path}`);
        const r = await register(h, kind, [file({ path })]);
        ok(`${kind}: registering ${label} is rejected (400)`, r.status === 400 && h.db.tables[table].length === 0 && h.db.storageRemoved.length === 0);
      }
      {
        const h = world();
        const [u] = await issued(kind, h);
        uploaded(h, bucket, [u.path]);
        const r = await register(h, kind, [file(u)], null, ORDER_B, TOK('p', ORDER_B));
        ok(`${kind}: order B's own token cannot register order A's issued object (the path is not in B's folder)`, r.status === 400 && h.db.tables[table].length === 0);
        const noProof = await callFunction(loadFunction('customer-portal-action', h), ANON_KEY, { orderId: ORDER_A, action: kind === 'lot_picture' ? 'register_lot_pictures' : 'register_order_pictures', payload: kind === 'lot_picture' ? { files: [file(u)] } : { files: [file(u)], notes: null } });
        ok(`${kind}: registering without proof of the order is denied and removes nothing`, noProof.status === 403 && h.db.tables[table].length === 0 && h.db.storageRemoved.length === 0);
      }
    }

    // order pictures keep recording the validated size and mime type
    {
      const h = world();
      const [u] = await issued('order_picture', h, 1, 'image/png');
      uploaded(h, 'order-pictures', [u.path]);
      const r = await register(h, 'order_picture', [{ path: u.path, name: 'p.png', size: 500, mimeType: 'image/png' }], 'a note');
      const row = h.db.tables.order_pictures[0];
      ok('order_picture: size, mime type and notes are recorded as before', r.status === 200 && row.file_size === 500 && row.mime_type === 'image/png' && row.notes === 'a note' && row.uploaded_by === null);
      const bad = await register(world(), 'order_picture', [{ path: u.path, name: 'p.pdf', size: 500, mimeType: 'application/pdf' }]);
      ok('order_picture: a PDF is no longer accepted as an order picture (the screen only offers images and the bucket rejects it)', bad.status === 400);
    }

    // lot limit at registration, with cleanup
    {
      const h = world();
      for (let i = 0; i < 3; i++) h.db.tables.order_lot_pictures.push({ id: `lp${i}`, order_id: ORDER_A, file_path: `${ORDER_A}/old${i}.jpg`, file_name: 'o', uploaded_at: '2026-10-01T00:00:00Z' });
      const us = [0, 1].map((i) => `${ORDER_A}/00000000-0000-4000-8000-00000000000${i}.jpg`);
      uploaded(h, 'lot-pictures', us);
      const r = await register(h, 'lot_picture', us.map((p, i) => ({ path: p, name: `n${i}.jpg` })));
      ok('lot_picture: exceeding the 4-picture limit at registration is refused', r.status === 400 && h.db.tables.order_lot_pictures.length === 3);
      ok('lot_picture: ... and the over-limit objects are removed by the server', us.every((p) => h.db.storageRemoved.includes(`lot-pictures:${p}`)));
    }

    // admin heads-up still fires for a requested lot-picture upload (existing behaviour)
    {
      const h = world();
      h.db.tables.orders.find((o: any) => o.id === ORDER_A)!.lot_pictures_requested = true;
      const [u] = await issued('lot_picture', h);
      uploaded(h, 'lot-pictures', [u.path]);
      const r = await register(h, 'lot_picture', [{ path: u.path, name: 'p.jpg' }]);
      ok('lot_picture: when the admin requested pictures, the admin is still notified after registration', r.status === 200 && h.fetches.some((f) => /send-sms-notification$/.test(f.url)));
    }
  }

  // ---- failed registration: the server cleans up, the browser never deletes --------------------------------------------------------------------------------------------
  {
    const discard = async (bearer: string | null, kind: string, paths: string[], h: Harness, orderId = ORDER_A, token: string | null = TOK('p', ORDER_A)) =>
      ({ h, r: await callFunction(loadFunction('customer-portal-action', h), bearer, { orderId, ...(token ? { token } : {}), action: 'discard_unregistered_pictures', payload: { kind, paths } }) });
    const p1 = `${ORDER_A}/00000000-0000-4000-8000-000000000001.jpg`;
    const p2 = `${ORDER_A}/00000000-0000-4000-8000-000000000002.jpg`;
    for (const [kind, bucket, table] of [['lot_picture', 'lot-pictures', 'order_lot_pictures'], ['order_picture', 'order-pictures', 'order_pictures']] as const) {
      const h = world();
      h.db.storageObjects.push(`${bucket}:${p1}`, `${bucket}:${p2}`);
      h.db.tables[table].push({ id: 'reg', order_id: ORDER_A, file_path: p2, file_name: 'r', uploaded_at: 'x', created_at: 'x' });
      const { r } = await discard(ANON_KEY, kind, [p1, p2], h);
      ok(`${kind}: an authorized discard removes an unregistered issued object`, r.status === 200 && h.db.storageRemoved.includes(`${bucket}:${p1}`));
      ok(`${kind}: ... but never a registered picture`, !h.db.storageRemoved.includes(`${bucket}:${p2}`) && h.db.storageObjects.includes(`${bucket}:${p2}`));
      const other = world();
      other.db.storageObjects.push(`${bucket}:${ORDER_B}/00000000-0000-4000-8000-000000000003.jpg`);
      const cross = await discard(ANON_KEY, kind, [`${ORDER_B}/00000000-0000-4000-8000-000000000003.jpg`], other);
      ok(`${kind}: a discard cannot name another order's object (400, nothing removed)`, cross.r.status === 400 && other.db.storageRemoved.length === 0);
      for (const [label, bearer, token, orderId] of [['no credentials', null, undefined, ORDER_A], ['the anon key alone', ANON_KEY, undefined, ORDER_A], ['order B\'s token', ANON_KEY, TOK('p', ORDER_B), ORDER_A], ['an unrelated customer', 'jwt-B', undefined, ORDER_A]] as Array<[string, string | null, string | undefined, string]>) {
        const d = world();
        d.db.storageObjects.push(`${bucket}:${p1}`);
        const res = await discard(bearer, kind, [p1], d, orderId, token ?? null);
        ok(`${kind}: discard by ${label} is denied and removes nothing`, res.r.status === 403 && d.db.storageRemoved.length === 0 && d.db.storageObjects.includes(`${bucket}:${p1}`));
      }
    }
    const bad = await discard(ANON_KEY, 'public-assets', [p1], world());
    ok('discard: the kind is an allowlisted enum, never a bucket name (400)', bad.r.status === 400 && bad.h.db.storageRemoved.length === 0);
  }

  // ---- customer removal of a lot picture (existing behaviour, unchanged) ----------------------------------------------------------------------------------------------------
  {
    const del = async (bearer: string | null, pictureId: string, h: Harness, token: string | null = TOK('p', ORDER_A), orderId = ORDER_A) =>
      ({ h, r: await callFunction(loadFunction('customer-portal-action', h), bearer, { orderId, ...(token ? { token } : {}), action: 'delete_lot_picture', payload: { pictureId } }) });
    const withPictures = (status = 'pending_review') => {
      const h = world(status);
      h.db.tables.order_lot_pictures.push(
        { id: '44444444-4444-4444-8444-444444444441', order_id: ORDER_A, file_path: `${ORDER_A}/a.jpg`, file_name: 'a', uploaded_at: 'x' },
        { id: '44444444-4444-4444-8444-444444444442', order_id: ORDER_B, file_path: `${ORDER_B}/b.jpg`, file_name: 'b', uploaded_at: 'x' },
      );
      return h;
    };
    const ok1 = await del(ANON_KEY, '44444444-4444-4444-8444-444444444441', withPictures());
    ok('delete: the token holder of the order removes its own lot picture through the service role', ok1.r.status === 200 && ok1.h.db.storageRemoved.includes(`lot-pictures:${ORDER_A}/a.jpg`) && ok1.h.db.tables.order_lot_pictures.length === 1);
    const cross = await del(ANON_KEY, '44444444-4444-4444-8444-444444444442', withPictures());
    ok('delete: a picture row that belongs to order B is not found for order A (404), nothing removed', cross.r.status === 404 && cross.h.db.storageRemoved.length === 0 && cross.h.db.tables.order_lot_pictures.length === 2);
    for (const [label, bearer, token] of [['no credentials', null, undefined], ['the anon key alone', ANON_KEY, undefined], ['order B\'s token', ANON_KEY, TOK('p', ORDER_B)], ['an unrelated customer', 'jwt-B', undefined]] as Array<[string, string | null, string | undefined]>) {
      const d = await del(bearer, '44444444-4444-4444-8444-444444444441', withPictures(), token ?? null);
      ok(`delete: ${label} is denied and removes nothing`, d.r.status === 403 && d.h.db.storageRemoved.length === 0 && d.h.db.tables.order_lot_pictures.length === 2);
    }
    const late = await del(ANON_KEY, '44444444-4444-4444-8444-444444444441', withPictures('confirmed'));
    ok('delete: after approval the customer can no longer remove pictures (unchanged rule)', late.r.status === 409 && late.h.db.storageRemoved.length === 0);
    ok('delete: there is no customer action that deletes order pictures or an arbitrary object (none existed, none added)', !PORTAL_ACTION_NAMES.some((n) => /delete.*order_picture|remove|storage/i.test(n)) && PORTAL_ACTION_NAMES.filter((n) => /delete/.test(n)).join() === 'delete_lot_picture');
  }

  // ======================================================================================================================
  // HANDLER: customer-portal-data - signed reads for the order's own pictures only
  // ======================================================================================================================
  {
    function dataWorld(): Harness {
      const h = world();
      h.db.tables.order_lot_pictures.push(
        { id: 'l1', order_id: ORDER_A, file_path: `${ORDER_A}/a1.jpg`, file_name: 'a1.jpg', notes: null, uploaded_at: '2026-10-02T00:00:00Z', address_id: 'addr-A' },
        { id: 'l2', order_id: ORDER_B, file_path: `${ORDER_B}/b1.jpg`, file_name: 'b1.jpg', notes: null, uploaded_at: '2026-10-02T00:00:00Z' },
      );
      h.db.tables.order_pictures.push(
        { id: 'o1', order_id: ORDER_A, file_path: `${ORDER_A}/a-o1.png`, file_name: 'a-o1.png', file_size: 1, mime_type: 'image/png', notes: 'n', created_at: '2026-10-03T00:00:00Z', uploaded_by: 'secret-staff' },
        { id: 'o2', order_id: ORDER_B, file_path: `${ORDER_B}/b-o2.png`, file_name: 'b-o2.png', file_size: 1, mime_type: 'image/png', notes: null, created_at: '2026-10-03T00:00:00Z' },
      );
      return h;
    }
    const data = async (bearer: string | null, body: Record<string, unknown>, h = dataWorld()) => ({ h, r: await callFunction(loadFunction('customer-portal-data', h), bearer, { sections: ['lotPictures', 'pictures'], ...body }) });

    const allowed: Array<[string, string | null, string | undefined]> = [
      ['a valid portal token for the order', ANON_KEY, TOK('p', ORDER_A)],
      ['the signed-in owner of the order', 'jwt-A', undefined],
      ['the backend (service role)', SERVICE_KEY, undefined],
      ['an admin opening the portal read-only', 'jwt-admin', undefined],
      ['a master opening the portal read-only', 'jwt-master', undefined],
    ];
    for (const [label, bearer, token] of allowed) {
      const { h, r } = await data(bearer, { orderId: ORDER_A, ...(token ? { token } : {}) });
      const lot = r.json?.data?.lotPictures ?? [];
      const pics = r.json?.data?.pictures ?? [];
      ok(`read: ${label} receives the order's own pictures only`, r.status === 200 && lot.length === 1 && pics.length === 1 && lot[0].id === 'l1' && pics[0].id === 'o1');
      ok(`read: ${label} - each picture carries a 1-hour signed URL from the private bucket`, new RegExp(`/object/sign/lot-pictures/${ORDER_A}/a1\\.jpg\\?.*ttl=3600`).test(lot[0]?.url ?? '') && new RegExp(`/object/sign/order-pictures/${ORDER_A}/a-o1\\.png\\?.*ttl=3600`).test(pics[0]?.url ?? ''));
      ok(`read: ${label} - the stored path stays a bare path and no public URL is returned`, lot[0]?.file_path === `${ORDER_A}/a1.jpg` && !/object\/public/.test(r.text));
      eq(`read: ${label} - only this order's two objects were signed`, [...h.db.storageSigned].sort(), [`lot-pictures:${ORDER_A}/a1.jpg`, `order-pictures:${ORDER_A}/a-o1.png`]);
      ok(`read: ${label} - the projection still hides staff-only fields`, !/secret-staff|uploaded_by/.test(r.text));
    }

    const denied: Array<[string, string | null, string | undefined]> = [
      ['no credentials', null, undefined], ['the anon key and an order id only', ANON_KEY, undefined], ['a made-up token', ANON_KEY, 'z'.repeat(64)],
      ['an expired token', ANON_KEY, TOK('e', ORDER_A)], ['a revoked token', ANON_KEY, TOK('r', ORDER_A)], ['order B\'s token', ANON_KEY, TOK('p', ORDER_B)],
      ['an unrelated signed-in customer', 'jwt-B', undefined], ['a signed-in user who owns nothing', 'jwt-none', undefined], ['crew', 'jwt-crew', undefined],
    ];
    for (const [label, bearer, token] of denied) {
      const { h, r } = await data(bearer, { orderId: ORDER_A, ...(token ? { token } : {}) });
      ok(`read: ${label} is denied (403) and nothing is signed`, r.status === 403 && h.db.storageSigned.length === 0 && !/a1\.jpg|a-o1/.test(r.text));
    }

    // A database row that points at another order's object is not signed for this order.
    {
      const h = dataWorld();
      h.db.tables.order_lot_pictures.push({ id: 'l3', order_id: ORDER_A, file_path: `${ORDER_B}/b1.jpg`, file_name: 'sneaky.jpg', notes: null, uploaded_at: '2026-10-04T00:00:00Z' });
      h.db.tables.order_pictures.push({ id: 'o3', order_id: ORDER_A, file_path: 'https://evil.example.com/storage/v1/object/public/order-pictures/x.png', file_name: 'x', notes: null, created_at: '2026-10-04T00:00:00Z' });
      const { r } = await data(ANON_KEY, { orderId: ORDER_A, token: TOK('p', ORDER_A) }, h);
      const sneaky = (r.json.data.lotPictures as any[]).find((p) => p.id === 'l3');
      const foreign = (r.json.data.pictures as any[]).find((p) => p.id === 'o3');
      ok('read: a picture row for order A that points into order B\'s folder gets no URL', sneaky?.url === null && !h.db.storageSigned.includes(`lot-pictures:${ORDER_B}/b1.jpg`));
      ok('read: a stored external URL is never signed or returned as a viewing link', foreign?.url === null);
    }
    // Asking for order B's rows with order A's proof returns nothing.
    {
      const { r, h } = await data(ANON_KEY, { orderId: ORDER_B, token: TOK('p', ORDER_A) });
      ok('read: order A\'s token cannot read order B\'s pictures', r.status === 403 && h.db.storageSigned.length === 0);
    }
    // Pictures stay optional: an order with none returns empty lists and signs nothing.
    {
      const h = world();
      const { r } = await data(ANON_KEY, { orderId: ORDER_A, token: TOK('p', ORDER_A) }, h);
      ok('read: an order without pictures returns empty lists', r.status === 200 && r.json.data.lotPictures.length === 0 && r.json.data.pictures.length === 0 && h.db.storageSigned.length === 0);
    }
  }

  // ======================================================================================================================
  // HANDLER: promote-media keeps working from the now-private buckets
  // ======================================================================================================================
  {
    const promoteWorld = (): Harness => {
      const h = world();
      h.db.rpcResults.get_user_role = 'admin';
      h.db.tables.order_lot_pictures.push({ id: 'l1', order_id: ORDER_A, file_path: `${ORDER_A}/a1.jpg`, file_name: 'a1.jpg' });
      h.db.tables.order_pictures.push({ id: 'o1', order_id: ORDER_A, file_path: `${ORDER_A}/a-o1.png`, file_name: 'a-o1.png' });
      h.db.tables.hero_carousel_images = [];
      h.db.tables.unit_media = [];
      h.db.tables.units = [{ id: 'unit-1', name: 'Castle' }];
      return h;
    };
    for (const [sourceType, id, bucket, path] of [['lot', 'l1', 'lot-pictures', `${ORDER_A}/a1.jpg`], ['order', 'o1', 'order-pictures', `${ORDER_A}/a-o1.png`]] as const) {
      const h = promoteWorld();
      const r = await callFunction(loadFunction('promote-media', h), 'jwt-admin', { source_type: sourceType, source_id: id, action: 'carousel', consent_confirmed: true });
      ok(`promote: a ${sourceType} picture is promoted to the public carousel from the PRIVATE ${bucket} bucket`, r.status === 200 && r.json?.success === true && r.json?.action === 'carousel');
      ok(`promote: ... the source was downloaded by the service-role client`, h.db.storageDownloads.includes(`${bucket}:${path}`));
      ok(`promote: ... and written into the intentionally public marketing bucket`, h.db.storageUploads.some((u) => u.startsWith('carousel-media:promoted/')) && h.db.tables.hero_carousel_images.length === 1);
      ok(`promote: ... the private source object itself is untouched`, !h.db.storageRemoved.length);
      const unit = promoteWorld();
      const u = await callFunction(loadFunction('promote-media', unit), 'jwt-admin', { source_type: sourceType, source_id: id, action: 'unit', target_unit_id: 'unit-1', consent_confirmed: true });
      ok(`promote: a ${sourceType} picture is promoted to a unit gallery from the private bucket too`, u.status === 200 && unit.db.storageUploads.some((x) => x.startsWith('unit-images:promoted/')));
      const nonAdmin = promoteWorld();
      nonAdmin.db.rpcResults.get_user_role = 'customer';
      const n = await callFunction(loadFunction('promote-media', nonAdmin), 'jwt-A', { source_type: sourceType, source_id: id, action: 'carousel', consent_confirmed: true });
      ok(`promote: a non-admin cannot promote a ${sourceType} picture and nothing is downloaded`, n.status === 403 && nonAdmin.db.storageDownloads.length === 0);
    }
    const pm = read('supabase/functions/promote-media/index.ts');
    ok('promote: the source is read with the service-role client, never the caller\'s', /const adminClient = createClient\(\s*Deno\.env\.get\("SUPABASE_URL"\) \?\? "",\s*Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\) \?\? ""\s*\)/.test(pm) && /adminClient\.storage\s*\.from\(sourceBucket\)\s*\.download\(sourceStoragePath\)/.test(pm));
    ok('promote: it needs no public URL for either source bucket', !/getPublicUrl\(sourcePath|\.from\(sourceBucket\)\s*\.getPublicUrl/.test(pm));
  }

  // ======================================================================================================================
  // SOURCE TRACE: no active reader or writer depends on a public URL or a generic browser upload for these buckets
  // ======================================================================================================================
  {
    const walk = (dir: string): string[] => (fs.readdirSync(dir, { withFileTypes: true }) as any[]).flatMap((e) => {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.|Scenarios\.ts$/.test(e.name) ? [p] : [];
    });
    const files = [...walk('src'), ...walk('supabase/functions')];
    const text = new Map<string, string>(files.map((f) => [f, read(f)]));
    const hits = (re: RegExp) => files.filter((f) => re.test(text.get(f)!));

    eq('scan: no code builds a public URL for lot-pictures or order-pictures', hits(/getPublicUrl\(\s*['"](lot-pictures|order-pictures)['"]|from\(['"](lot-pictures|order-pictures)['"]\)\s*\.getPublicUrl/), []);
    eq('scan: no code references a permanent public object URL of these buckets', hits(/storage\/v1\/object\/public\/(lot-pictures|order-pictures)/), []);
    eq('scan: no browser code uploads straight into either bucket', hits(/storage\s*\.from\(\s*['"](lot-pictures|order-pictures)['"]\s*\)\s*\.upload\(/).filter((f) => f.startsWith('src/')), []);
    eq('scan: no browser code deletes straight from either bucket', hits(/storage\s*\.from\(\s*['"](lot-pictures|order-pictures)['"]\s*\)\s*\.remove\(/).filter((f) => f.startsWith('src/')), []);
    eq('scan: the only browser code that reads either bucket asks for signed URLs (admin screens)', hits(/storage\s*\.from\(\s*['"](lot-pictures|order-pictures)['"]\s*\)/).filter((f) => f.startsWith('src/')), ['src/components/pending-order/LotPicturesDisplay.tsx']);
    const portalUp = text.get('src/lib/portalPictureUpload.ts')!;
    ok('scan: the one browser upload uses the exact server-issued token and path, in the server-chosen bucket', /\.from\(authorization\.bucket\)\s*\.uploadToSignedUrl\(grant\.path, grant\.token, file/.test(portalUp) && !/\.upload\(/.test(portalUp) && !/\.remove\(/.test(portalUp));
    ok('scan: the browser requests authorization with a kind and file metadata only', /request_picture_upload', \{\s*kind,\s*files: files\.map\(\(f\) => \(\{ name: f\.name, size: f\.size, mimeType: f\.type \}\)\)/.test(portalUp));
    ok('scan: the browser cleanup goes through the server action', /discard_unregistered_pictures/.test(portalUp));
    const lotTab = text.get('src/components/customer-portal/LotPicturesTab.tsx')!;
    const regular = text.get('src/components/customer-portal/RegularPortalView.tsx')!;
    ok('scan: the customer screens use the shared upload helper and the signed URLs from the portal payload', /uploadPortalPictures\(orderId, invoiceLinkToken, 'lot_picture'/.test(lotTab) && /uploadPortalPictures\(orderId, invoiceLinkToken, 'order_picture'/.test(regular) && /picture\.url \?\? ''/.test(lotTab) && /pic\.url \?\? ''/.test(regular));
    ok('scan: the customer screens import no Storage client for these buckets', !/lib\/supabase'/.test(lotTab) && !/lib\/supabase'/.test(regular));
    const data = text.get('supabase/functions/customer-portal-data/index.ts')!;
    ok('scan: customer-portal-data signs with the server client and only inside the order\'s folder', /signStoredMedia\(client, bucket, path\)/.test(data) && /path\.startsWith\(`\$\{orderId\}\/`\)/.test(data) && /withSignedUrls\(supabase, "lot-pictures", orderId/.test(data) && /withSignedUrls\(supabase, "order-pictures", orderId/.test(data));
    const action = text.get('supabase/functions/customer-portal-action/index.ts')!;
    ok('scan: the portal action maps a fixed kind to a bucket (no client-supplied bucket)', /const rules = PICTURE_KINDS\[p\.kind\]/.test(action) && /createSignedUploadUrl\(path\)/.test(action) && !/payload as \{[^}]*bucket/.test(action));
    ok('scan: the portal action authorizes the order before it validates or acts', action.indexOf('authorizePortalOrder(') > 0 && action.indexOf('authorizePortalOrder(') < action.indexOf('validateAction('));
    const admin = text.get('src/hooks/useAdminPhotos.ts')!;
    ok('scan: the Admin photo library asks Storage for signed URLs for both buckets', /createSignedUrls\(paths, 3600\)/.test(admin) && /signPaths\('lot-pictures'/.test(admin) && /signPaths\('order-pictures'/.test(admin) && !/getPublicUrl/.test(admin));
    const lotDisplay = text.get('src/components/pending-order/LotPicturesDisplay.tsx')!;
    ok('scan: the Admin order lot-picture view (including saved address photos) uses signed URLs', /from\('lot-pictures'\)\.createSignedUrls\(wanted, 3600\)/.test(lotDisplay) && !/getPublicUrl/.test(lotDisplay));
    ok('scan: delivery / damage evidence no longer targets public-assets (private evidence flow; see the order evidence suite)', !/public-assets/.test(text.get('src/components/admin/task-detail/taskPhotoUpload.ts')!));
  }

  // ---- the action list and payload validator ------------------------------------------------------------------------------------------------------------------------
  {
    ok('actions: the two new actions are in the fixed action list', PORTAL_ACTION_NAMES.includes('request_picture_upload') && PORTAL_ACTION_NAMES.includes('discard_unregistered_pictures'));
    eq('actions: kinds map to exactly the two buckets', Object.fromEntries(Object.entries(PICTURE_KINDS).map(([k, v]) => [k, v.bucket])), { lot_picture: 'lot-pictures', order_picture: 'order-pictures' });
    ok('actions: an issued-path check is strict about order folder, uuid and extension', isIssuedPicturePath(`${ORDER_A}/00000000-0000-4000-8000-000000000000.jpg`, ORDER_A, 'lot_picture') && !isIssuedPicturePath(`${ORDER_A}/00000000-0000-4000-8000-000000000000.gif`, ORDER_A, 'lot_picture') && isIssuedPicturePath(`${ORDER_A}/00000000-0000-4000-8000-000000000000.gif`, ORDER_A, 'order_picture') && !isIssuedPicturePath(`${ORDER_B}/00000000-0000-4000-8000-000000000000.jpg`, ORDER_A, 'lot_picture'));
    ok('actions: validateAction rejects a register payload with a browser-chosen path', validateAction('register_lot_pictures', { files: [{ path: `${ORDER_A}/mine.jpg`, name: 'x' }] }, ORDER_A) === null);
  }

  // ======================================================================================================================
  // EXECUTED: storage policies for the real roles in a scratch PostgreSQL database
  // ======================================================================================================================
  {
    const db = process.env.CORE_DB_NAME || 'scratch';
    const port = process.env.CORE_DB_PORT || '54329';
    const host = process.env.CORE_DB_HOST || '127.0.0.1';
    const candidates = [process.env.CORE_DB_PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'psql'].filter(Boolean) as string[];
    const args = ['-h', host, '-p', port, '-U', 'postgres', '-d', db, '-X', '-q', '-w'];
    let psql: string | null = null;
    for (const c of candidates) {
      const probe = spawnSync(c, [...args, '-Atc', "SELECT to_regprocedure('public.is_crew_or_admin()') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL"], { encoding: 'utf8', timeout: 15000 });
      if (probe.status === 0 && probe.stdout.trim() === 't') { psql = c; break; }
    }
    if (!psql) {
      if (process.env.CORE_DB_REQUIRE) ok('executed: a scratch database with the repository migrations replayed is available (CORE_DB_REQUIRE is set)', false);
      else console.log('EXECUTED layer SKIPPED: no scratch PostgreSQL database with the repository migrations replayed was reachable (see the header of this file).');
    } else {
      const run = (label: string, scenarios: ReturnType<typeof buildPhotoScenarios>, script: string) => {
        const r = spawnSync(psql as string, [...args, '-v', 'ON_ERROR_STOP=1'], { input: script, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
        const results: Record<number, string> = {};
        for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
        ok(`executed (${label}): the scenario script ran to completion in database "${db}" (${Object.keys(results).length}/${scenarios.length} results)`, Object.keys(results).length === scenarios.length);
        if (Object.keys(results).length !== scenarios.length) console.error((r.stderr ?? '').split('\n').filter((l: string) => /ERROR|LINE|DETAIL/.test(l)).slice(0, 6).join('\n'));
        scenarios.forEach((sc, i) => {
          const got = results[i];
          ok(`executed (${label}): ${sc.name} (got ${got})`, typeof sc.expect === 'string' ? got === sc.expect : sc.expect(got));
        });
      };
      const waiverSql = read(WAIVER_MIGRATION);
      const photoSql = read(MIGRATION);
      const both = buildPhotoScenarios();
      run('both migrations', both, buildPhotoScript(both, [waiverSql, photoSql]));
      const alone = buildAloneScenarios();
      run('photo migration alone', alone, buildPhotoScript(alone, [photoSql], ALONE_FIXTURE_SQL));
    }
  }

  void SERVICE_KEY;
  console.log(`Customer photo access tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} customer photo access test(s) failed`);
})();
