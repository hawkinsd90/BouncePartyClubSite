// Delivery and damage evidence photos (task_status.delivery_images / damage_images).
//
// New evidence lives in the private order-evidence bucket and task_status stores bare object paths. Staff upload and view it
// through the task-evidence function, customers see their own delivery photos through customer-portal-data, promote-media reads
// the private source with the service role, and the historical public-assets objects are moved by a controlled, rerunnable
// migration. Layers:
//   UNIT        reference parsing, scope checks and deterministic destinations
//   HANDLER     the CURRENT task-evidence / customer-portal-data / promote-media source run against the in-memory harness with
//               the real shared authorization helpers (denied callers cause zero side effects)
//   MIGRATION   the historical-evidence migration logic against fake Storage and database clients (nothing live is touched)
//   SOURCE      scans proving no code path writes or serves evidence through a public URL
//   EXECUTED    applies the repository migrations inside a rolled-back transaction in a SCRATCH PostgreSQL database and
//               evaluates storage.objects policies for the real anon / authenticated / service_role roles
// NOT executable here (REQUIRES DEV AFTER APPLY): Supabase Storage's HTTP layer - public / private serving, that a signed upload
// token is valid only for the exact bucket and path it was issued for, bucket size / MIME enforcement, and Storage copy.
// Run: node node_modules/jiti/bin/jiti.js src/lib/orderEvidenceAccess.test.ts   (CORE_DB_NAME/CORE_DB_PORT select the scratch DB)

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import { addOrder, callFunction, loadFunction, makeHarness, tokenFor, SERVICE_KEY, ANON_KEY } from '../support/portalTestHarness';
import type { Harness } from '../support/portalTestHarness';
import {
  EVIDENCE_BUCKET, EVIDENCE_MIME_TYPES, EVIDENCE_MAX_FILES_PER_REQUEST, newEvidencePath, isTaskEvidencePath, parseEvidenceReference,
  evidenceReferenceInScope, legacyEvidenceDestination, archivedLegacyDestination, isLegacyEvidenceObjectName, legacyEvidenceOrderId, LEGACY_TASK_LABELS, resolveEvidenceUrls,
} from '../../../../supabase/functions/_shared/evidence-media';
import {
  planEvidenceMigration, copyEvidence, rewriteEvidenceReferences, cleanupVerifiedSources, verifiedDestinations, migrationRunBlocker,
  CLEANUP_CONFIRMATION, PRODUCTION_PROJECT_REF,
} from '../../../../supabase/functions/_shared/evidence-migration';
import type { EvidenceMigrationDeps, EvidenceTaskRow } from '../../../../supabase/functions/_shared/evidence-migration';
import { buildEvidenceScenarios, buildEvidenceAloneScenarios, EVIDENCE_ALONE_FIXTURE_SQL } from '../support/orderEvidenceAccessScenarios';
import { buildPhotoScript } from '../support/customerPhotoAccessScenarios';

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

const MIGRATIONS = [
  'supabase/migrations/20261014120000_protect_waiver_media_and_restrict_storage_access.sql',
  'supabase/migrations/20261015120000_protect_customer_order_photos.sql',
  'supabase/migrations/20261015123000_create_private_order_evidence_storage.sql',
];

const ORDER_A = 'abcdefab-1111-4111-8111-111111111111';
const ORDER_B = '22222222-2222-4222-8222-222222222222';
const TASK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_A2 = 'a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OBJ1 = '00000000-0000-4000-8000-000000000001';
const OBJ2 = '00000000-0000-4000-8000-000000000002';
const OBJ3 = '00000000-0000-4000-8000-000000000003';
const TOK = (suffix: string, id: string) => tokenFor(`${suffix}-${id}`);
const legacyUrl = (order: string, name: string, host = 'qaagfafagdpgzcijnfbw') => `https://${host}.supabase.co/storage/v1/object/public/public-assets/${order}-drop-off-1760000000000-${name}`;
const privatePath = (order: string, task: string, kind: 'delivery' | 'damage', obj: string, ext = 'jpg') => `${order}/${task}/${kind}/${obj}.${ext}`;

(async () => {
  // ======================================================================================================================
  // UNIT: reference parsing, scope and destinations
  // ======================================================================================================================
  {
    const l = legacyUrl(ORDER_A, 'IMG_1.jpg');
    eq('unit: a Production-host public-assets URL is a legacy reference', parseEvidenceReference(l), { bucket: 'public-assets', path: `${ORDER_A}-drop-off-1760000000000-IMG_1.jpg`, legacy: true });
    eq('unit: a Dev-host public-assets URL is a legacy reference', parseEvidenceReference(legacyUrl(ORDER_A, 'x.jpg', 'srxunxiytojjsuhcmzjg'))?.legacy, true);
    eq('unit: a private evidence path is a private reference', parseEvidenceReference(privatePath(ORDER_A, TASK_A, 'delivery', OBJ1)), { bucket: EVIDENCE_BUCKET, path: privatePath(ORDER_A, TASK_A, 'delivery', OBJ1), legacy: false });
    eq('unit: a copied legacy object path is a private reference', parseEvidenceReference(`${ORDER_A}/${TASK_A}/delivery/legacy-drop-off-1760000000000-IMG_1.jpg`)?.legacy, false);
    for (const [what, ref] of [
      ['an external URL', 'https://evil.example.com/photo.jpg'],
      ['a fake Supabase path on another host', 'https://evil.example.com/storage/v1/object/public/public-assets/x.jpg'],
      ['another bucket\'s URL', 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/lot-pictures/x.jpg'],
      ['http', `http://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/${ORDER_A}-drop-off-1-x.jpg`],
      ['a traversal path', `${ORDER_A}/${TASK_A}/delivery/../../x.jpg`],
      ['an unknown kind folder', `${ORDER_A}/${TASK_A}/lot/${OBJ1}.jpg`],
      ['a path with a nested folder', `${ORDER_A}/${TASK_A}/delivery/a/${OBJ1}.jpg`],
      ['an empty string', ''], ['null', null], ['a number', 7], ['an object', {}],
    ] as Array<[string, unknown]>) eq(`unit: ${what} is not a trusted reference`, parseEvidenceReference(what === 'a number' ? 7 : ref), null);

    const p = parseEvidenceReference(l)!;
    ok('unit: a legacy reference is in scope for its own order only', evidenceReferenceInScope(p, { orderId: ORDER_A }) && !evidenceReferenceInScope(p, { orderId: ORDER_B }));
    const priv = parseEvidenceReference(privatePath(ORDER_A, TASK_A, 'delivery', OBJ1))!;
    ok('unit: a private reference is in scope for its own order, task and kind', evidenceReferenceInScope(priv, { orderId: ORDER_A, taskStatusId: TASK_A, kind: 'delivery' }));
    ok('unit: ... but not another order, another task or the other kind', !evidenceReferenceInScope(priv, { orderId: ORDER_B }) && !evidenceReferenceInScope(priv, { orderId: ORDER_A, taskStatusId: TASK_A2 }) && !evidenceReferenceInScope(priv, { orderId: ORDER_A, kind: 'damage' }));
    eq('unit: the destination of a legacy object is deterministic and inside the task folder', legacyEvidenceDestination(ORDER_A, TASK_A, 'delivery', p.path), `${ORDER_A}/${TASK_A}/delivery/legacy-drop-off-1760000000000-IMG_1.jpg`);
    eq('unit: the destination is the same on a second call', legacyEvidenceDestination(ORDER_A, TASK_A, 'delivery', p.path), legacyEvidenceDestination(ORDER_A, TASK_A, 'delivery', p.path));
    eq('unit: a legacy name that does not begin with the order id has no destination', legacyEvidenceDestination(ORDER_B, TASK_A, 'delivery', p.path), null);
    eq('unit: the archive destination for an unreferenced object', archivedLegacyDestination(ORDER_A, p.path), `${ORDER_A}/unreferenced/legacy-drop-off-1760000000000-IMG_1.jpg`);
    ok('unit: a copied destination is itself a valid task evidence path', isTaskEvidencePath(legacyEvidenceDestination(ORDER_A, TASK_A, 'delivery', p.path), ORDER_A, TASK_A, 'delivery'));
    ok('unit: only evidence-looking names are evidence (the logo is not)', isLegacyEvidenceObjectName(`${ORDER_A}-drop-off-1-a.jpg`) && !isLegacyEvidenceObjectName('bounce-party-club-logo.png') && !isLegacyEvidenceObjectName('brand/hero.jpg'));
    // ---- historical task labels: the repository's task types are "drop-off" and "pick-up" ----
    {
      const pickUp = `${ORDER_A}-pick-up-1760000000000-IMG_7.jpg`;
      const pickUpUrl = `https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/${pickUp}`;
      eq('pick-up: the vocabulary of task types in the app includes the hyphenated "pick-up" spelling', ['taskNotificationMessages.ts', 'useCalendarTasks.ts'].map((f) => /'drop-off'\s*\|\s*'pick-up'/.test(fs.readFileSync(f === 'useCalendarTasks.ts' ? `src/hooks/${f}` : `src/components/admin/task-detail/${f}`, 'utf8'))), [true, true]);
      ok('pick-up: the old proof-photo uploader named files with the task\'s own type, so a pick-up task produced "-pick-up-" names', fs.readFileSync('src/components/admin/task-detail/taskPhotoUpload.test.ts', 'utf8').includes('`${task.orderId}-${task.type}-${now()}-'));
      ok('pick-up: every task type of the app is an accepted historical label', ['drop-off', 'pick-up'].every((label) => LEGACY_TASK_LABELS.includes(label) && isLegacyEvidenceObjectName(`${ORDER_A}-${label}-123-photo.jpg`)));
      eq('pick-up: the accepted labels are exactly these (nothing broader)', [...LEGACY_TASK_LABELS], ['drop-off', 'pick-up', 'pickup', 'damage']);
      for (const [what, name, expected] of [
        ['drop-off', `${ORDER_A}-drop-off-123-photo.jpg`, true],
        ['pick-up', `${ORDER_A}-pick-up-123-photo.jpg`, true],
        ['pickup (kept as a defensive spelling)', `${ORDER_A}-pickup-123-photo.jpg`, true],
        ['damage (kept as a defensive spelling)', `${ORDER_A}-damage-123-photo.jpg`, true],
        ['an arbitrary task label', `${ORDER_A}-delivery-123-photo.jpg`, false],
        ['an underscore spelling', `${ORDER_A}-pick_up-123-photo.jpg`, false],
        ['an upper-case spelling', `${ORDER_A}-Pick-Up-123-photo.jpg`, false],
        ['a label prefix attack', `${ORDER_A}-pick-up-extra-123-photo.jpg`, false],
        ['a non-numeric timestamp', `${ORDER_A}-pick-up-abc-photo.jpg`, false],
        ['a missing file name', `${ORDER_A}-pick-up-123-`, false],
        ['a missing order id', 'pick-up-123-photo.jpg', false],
        ['a non-uuid order id', `order-1-pick-up-123-photo.jpg`, false],
        ['the site logo', 'bounce-party-club-logo.png', false],
        ['a marketing file in a folder', 'brand/hero.jpg', false],
        ['a marketing file named like a task', 'pick-up-123-promo.jpg', false],
        ['a nested path', `${ORDER_A}-pick-up-123-a/b.jpg`, false],
      ] as Array<[string, string, boolean]>) {
        eq(`pick-up: isLegacyEvidenceObjectName - ${what}`, isLegacyEvidenceObjectName(name), expected);
      }
      eq('pick-up: legacyEvidenceOrderId finds the order of a pick-up object', legacyEvidenceOrderId(pickUp), ORDER_A);
      eq('pick-up: legacyEvidenceOrderId is null for a name that is not evidence', legacyEvidenceOrderId('bounce-party-club-logo.png'), null);
      eq('pick-up: parseEvidenceReference accepts a Production-host pick-up URL as a legacy reference', parseEvidenceReference(pickUpUrl), { bucket: 'public-assets', path: pickUp, legacy: true });
      const parsed = parseEvidenceReference(pickUpUrl)!;
      ok('pick-up: it is in scope for its own order only', evidenceReferenceInScope(parsed, { orderId: ORDER_A }) && !evidenceReferenceInScope(parsed, { orderId: ORDER_B }));
      eq('pick-up: parseEvidenceReference still accepts the drop-off form', parseEvidenceReference(legacyUrl(ORDER_A, 'IMG_1.jpg'))?.legacy, true);
      eq('pick-up: legacyEvidenceDestination keeps the label and sits in the task folder', legacyEvidenceDestination(ORDER_A, TASK_A2, 'delivery', pickUp), `${ORDER_A}/${TASK_A2}/delivery/legacy-pick-up-1760000000000-IMG_7.jpg`);
      eq('pick-up: legacyEvidenceDestination is null for another order', legacyEvidenceDestination(ORDER_B, TASK_A2, 'delivery', pickUp), null);
      eq('pick-up: legacyEvidenceDestination is null for a malformed name', legacyEvidenceDestination(ORDER_A, TASK_A2, 'delivery', `${ORDER_A}-pick-up-x-photo.jpg`), null);
      eq('pick-up: archivedLegacyDestination for an unreferenced pick-up object', archivedLegacyDestination(ORDER_A, pickUp), `${ORDER_A}/unreferenced/legacy-pick-up-1760000000000-IMG_7.jpg`);
      eq('pick-up: archivedLegacyDestination is null for a marketing file', archivedLegacyDestination(ORDER_A, 'bounce-party-club-logo.png'), null);
      ok('pick-up: the copied destination is itself a trusted private reference in scope for the pick-up task', (() => { const d = legacyEvidenceDestination(ORDER_A, TASK_A2, 'delivery', pickUp)!; const p = parseEvidenceReference(d); return !!p && !p.legacy && evidenceReferenceInScope(p, { orderId: ORDER_A, taskStatusId: TASK_A2, kind: 'delivery' }); })());
      for (const [what, ref] of [['a malformed pick-up URL (traversal)', `https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/../${pickUp}`], ['a pick-up name on an external host', `https://evil.example.com/storage/v1/object/public/public-assets/${pickUp}`], ['another bucket', `https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/lot-pictures/${pickUp}`]] as Array<[string, string]>) {
        eq(`pick-up: parseEvidenceReference rejects ${what}`, parseEvidenceReference(ref), null);
      }
    }
    eq('unit: new paths are server-shaped', newEvidencePath(ORDER_A, TASK_A, 'damage', OBJ1, 'image/heic'), privatePath(ORDER_A, TASK_A, 'damage', OBJ1, 'heic'));
    eq('unit: an unsupported type has no path', newEvidencePath(ORDER_A, TASK_A, 'damage', OBJ1, 'application/pdf'), null);
    eq('unit: an unsafe id has no path', newEvidencePath('../x', TASK_A, 'damage', OBJ1, 'image/jpeg'), null);
    ok('unit: the allowed types are images only', EVIDENCE_MIME_TYPES.every((t) => t.startsWith('image/')));

    // resolving never fetches and signs with the given client only
    const signedBy: string[] = [];
    const client = { storage: { from: (b: string) => ({ createSignedUrl: async (path: string) => { signedBy.push(`${b}:${path}`); return { data: { signedUrl: `https://current/sign/${b}/${path}` }, error: null }; } }) } };
    const realFetch = globalThis.fetch;
    let contacted = 0;
    globalThis.fetch = (async () => { contacted++; throw new Error('network is not allowed'); }) as typeof fetch;
    let resolved: any[] = [];
    try {
      resolved = await resolveEvidenceUrls(client, [l, privatePath(ORDER_A, TASK_A, 'delivery', OBJ1), 'https://evil.example.com/x.jpg', legacyUrl(ORDER_B, 'other.jpg'), 5], { orderId: ORDER_A, taskStatusId: TASK_A, kind: 'delivery' });
    } finally { globalThis.fetch = realFetch; }
    eq('unit: resolving keeps order and length and nulls anything untrusted or out of scope', resolved.map((r) => !!r.url), [true, true, false, false, false]);
    eq('unit: only the two trusted objects were signed, by the current client', signedBy, [`public-assets:${p.path}`, `${EVIDENCE_BUCKET}:${privatePath(ORDER_A, TASK_A, 'delivery', OBJ1)}`]);
    eq('unit: resolving a Production-host reference contacts no host', contacted, 0);
  }

  // ======================================================================================================================
  // HANDLER: task-evidence
  // ======================================================================================================================
  function world(): Harness {
    const h = makeHarness();
    addOrder(h.db, { id: ORDER_A, customer: 'cust-A', status: 'confirmed' });
    addOrder(h.db, { id: ORDER_B, customer: 'cust-B', status: 'confirmed' });
    h.db.privateBuckets = [EVIDENCE_BUCKET, 'lot-pictures', 'order-pictures'];
    h.db.tables.task_status = [
      { id: TASK_A, order_id: ORDER_A, task_type: 'drop-off', status: 'completed', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', completed_time: '2026-10-01T12:00:00Z', delivery_images: [], damage_images: [] },
      { id: TASK_A2, order_id: ORDER_A, task_type: 'pickup', status: 'pending', created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', completed_time: null, delivery_images: [], damage_images: [] },
      { id: TASK_B, order_id: ORDER_B, task_type: 'drop-off', status: 'completed', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', completed_time: '2026-10-01T12:00:00Z', delivery_images: [], damage_images: [] },
    ];
    return h;
  }
  const evidence = async (bearer: string | null, body: unknown, h = world()) => ({ h, r: await callFunction(loadFunction('task-evidence', h), bearer, body) });
  const upBody = (over: Record<string, unknown> = {}) => ({ action: 'request_upload', taskStatusId: TASK_A, kind: 'delivery', files: [{ name: 'front.jpg', size: 1200, mimeType: 'image/jpeg' }], ...over });
  const quiet = (h: Harness) => h.db.storageUploadGrants.length === 0 && h.db.storageRemoved.length === 0 && h.db.storageSigned.length === 0 && h.db.writes.length === 0;
  const task = (h: Harness, id: string) => h.db.tables.task_status.find((t: any) => t.id === id)!;

  // ---- who may use it ---------------------------------------------------------------------------------------------------------------------------------------------------
  {
    for (const [label, bearer] of [['an admin', 'jwt-admin'], ['a master', 'jwt-master'], ['crew (the existing task photo path)', 'jwt-crew'], ['the backend (service role)', SERVICE_KEY]] as Array<[string, string]>) {
      for (const kind of ['delivery', 'damage']) {
        const { h, r } = await evidence(bearer, upBody({ kind }));
        ok(`request: ${label} obtains an upload authorization for ${kind} evidence`, r.status === 200 && r.json?.success === true && r.json?.bucket === EVIDENCE_BUCKET && r.json?.uploads?.length === 1);
        ok(`request: ${label} - the server chose a path inside the task's own ${kind} folder`, new RegExp(`^${ORDER_A}/${TASK_A}/${kind}/[0-9a-f-]{36}\\.jpg$`).test(r.json?.uploads?.[0]?.path ?? ''));
        eq(`request: ${label} - exactly that object was authorized in the evidence bucket`, h.db.storageUploadGrants, [`${EVIDENCE_BUCKET}:${r.json?.uploads?.[0]?.path}`]);
        ok(`request: ${label} - nothing was written to the database or removed`, h.db.writes.length === 0 && h.db.storageRemoved.length === 0 && h.db.storageUploads.length === 0);
      }
    }
    const callers: Array<[string, string | null, Record<string, unknown>]> = [
      ['no credentials', null, {}],
      ['the public anon key', ANON_KEY, {}],
      ['an ordinary customer (the order\'s own owner)', 'jwt-A', {}],
      ['another customer', 'jwt-B', {}],
      ['a signed-in user with no role', 'jwt-none', {}],
      ['a portal token used as a bearer', TOK('p', ORDER_A), {}],
      ['a portal token placed in the body', ANON_KEY, { token: TOK('p', ORDER_A) }],
      ['a made-up bearer', 'z'.repeat(40), {}],
    ];
    for (const action of [
      upBody(), { action: 'register', taskStatusId: TASK_A, kind: 'delivery', paths: [privatePath(ORDER_A, TASK_A, 'delivery', OBJ1)] },
      { action: 'discard', taskStatusId: TASK_A, kind: 'delivery', paths: [privatePath(ORDER_A, TASK_A, 'delivery', OBJ1)] }, { action: 'view', taskStatusIds: [TASK_A] },
    ] as Array<Record<string, unknown>>) {
      for (const [label, bearer, extra] of callers) {
        const h = world();
        h.db.storageObjects.push(`${EVIDENCE_BUCKET}:${privatePath(ORDER_A, TASK_A, 'delivery', OBJ1)}`);
        task(h, TASK_A).delivery_images = [legacyUrl(ORDER_A, 'IMG_1.jpg')];
        const r = await callFunction(loadFunction('task-evidence', h), bearer, { ...action, ...extra });
        ok(`${action.action}: ${label} is denied (403, uniform) with no grant, signing, removal or write`, r.status === 403 && r.json?.error === 'access_required' && quiet(h) && h.db.storageObjects.length === 1);
      }
    }
  }

  // ---- tampering --------------------------------------------------------------------------------------------------------------------------------------------------------
  {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['a bucket in the request', { bucket: 'public-assets' }],
      ['a path in the request', { path: `${ORDER_B}/${TASK_B}/delivery/${OBJ1}.jpg` }],
      ['an order id in the request', { orderId: ORDER_B }],
      ['a path inside a file entry', { files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg', path: 'x/y.jpg' }] }],
      ['a bucket inside a file entry', { files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg', bucket: 'public-assets' }] }],
      ['an unknown kind', { kind: 'public' }],
      ['a lot picture kind', { kind: 'lot_picture' }],
      ['a path-like kind', { kind: '../../x' }],
      ['a malformed task id', { taskStatusId: '../../x' }],
      ['an empty file list', { files: [] }],
      [`more than ${EVIDENCE_MAX_FILES_PER_REQUEST} files`, { files: Array.from({ length: EVIDENCE_MAX_FILES_PER_REQUEST + 1 }, () => ({ name: 'a.jpg', size: 10, mimeType: 'image/jpeg' })) }],
      ['a PDF', { files: [{ name: 'a.pdf', size: 10, mimeType: 'application/pdf' }] }],
      ['an SVG', { files: [{ name: 'a.svg', size: 10, mimeType: 'image/svg+xml' }] }],
      ['HTML', { files: [{ name: 'a.jpg', size: 10, mimeType: 'text/html' }] }],
      ['an unknown mime type', { files: [{ name: 'a.jpg', size: 10, mimeType: 'unknown' }] }],
      ['a valid file followed by an unsupported one (nothing may be authorized for the first)', { files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg' }, { name: 'b.pdf', size: 10, mimeType: 'application/pdf' }] }],
      ['a missing mime type', { files: [{ name: 'a.jpg', size: 10 }] }],
      ['an empty file', { files: [{ name: 'a.jpg', size: 0, mimeType: 'image/jpeg' }] }],
      ['an over-size file', { files: [{ name: 'a.jpg', size: 10 * 1024 * 1024 + 1, mimeType: 'image/jpeg' }] }],
      ['a fractional size', { files: [{ name: 'a.jpg', size: 1.5, mimeType: 'image/jpeg' }] }],
      ['a blank name', { files: [{ name: '  ', size: 10, mimeType: 'image/jpeg' }] }],
    ];
    for (const [label, over] of bad) {
      const { h, r } = await evidence('jwt-admin', upBody(over));
      ok(`tamper: ${label} is rejected (400) with no authorization issued`, r.status === 400 && r.json?.error === 'invalid_request' && quiet(h));
    }
    const missing = await evidence('jwt-admin', upBody({ taskStatusId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }));
    ok('request: an unknown task is a 404 and authorizes nothing', missing.r.status === 404 && quiet(missing.h));
    const hostile = await evidence('jwt-admin', upBody({ files: [{ name: '../../../etc/passwd.jpg', size: 10, mimeType: 'image/png' }, { name: 'b.jpg', size: 10, mimeType: 'image/heic' }] }));
    ok('path: a hostile file name is only a label and never reaches the path', hostile.r.status === 200 && hostile.r.json.uploads.every((u: any) => !/passwd|\.\./.test(u.path)) && /\.png$/.test(hostile.r.json.uploads[0].path) && /\.heic$/.test(hostile.r.json.uploads[1].path));
    ok('path: the order and task come from the database, not the request (order B\'s task gets order B\'s folder)', (await evidence('jwt-admin', upBody({ taskStatusId: TASK_B }))).r.json.uploads[0].path.startsWith(`${ORDER_B}/${TASK_B}/delivery/`));
    const two = await evidence('jwt-admin', upBody({ files: [{ name: 'a.jpg', size: 10, mimeType: 'image/jpeg' }, { name: 'a.jpg', size: 10, mimeType: 'image/jpeg' }] }));
    ok('path: every object gets its own random path', two.r.json.uploads[0].path !== two.r.json.uploads[1].path);
    const act = await evidence('jwt-admin', { ...upBody(), action: 'REQUEST_UPLOAD' });
    ok('request: action names are matched exactly', act.r.status === 400 && quiet(act.h));
  }

  // ---- registration ---------------------------------------------------------------------------------------------------------------------------------------------------
  {
    const register = (h: Harness, kind: string, paths: unknown, taskStatusId = TASK_A, bearer = 'jwt-admin') =>
      callFunction(loadFunction('task-evidence', h), bearer, { action: 'register', taskStatusId, kind, paths });
    const issue = async (h: Harness, kind: 'delivery' | 'damage', count = 1) => {
      const r = await callFunction(loadFunction('task-evidence', h), 'jwt-admin', upBody({ kind, files: Array.from({ length: count }, (_, i) => ({ name: `p${i}.jpg`, size: 100, mimeType: 'image/jpeg' })) }));
      return r.json.uploads.map((u: any) => u.path) as string[];
    };
    const uploaded = (h: Harness, paths: string[]) => h.db.storageObjects.push(...paths.map((p) => `${EVIDENCE_BUCKET}:${p}`));

    for (const kind of ['delivery', 'damage'] as const) {
      const col = kind === 'delivery' ? 'delivery_images' : 'damage_images';
      const other = kind === 'delivery' ? 'damage_images' : 'delivery_images';
      const h = world();
      const legacy = legacyUrl(ORDER_A, 'IMG_0.jpg');
      task(h, TASK_A)[col] = [legacy];
      const paths = await issue(h, kind, 2);
      uploaded(h, paths);
      const r = await register(h, kind, paths);
      ok(`register ${kind}: uploaded, issued objects are recorded on the task`, r.status === 200 && r.json?.success === true);
      eq(`register ${kind}: the historical entry stays first and the new bare paths follow in upload order`, task(h, TASK_A)[col], [legacy, ...paths]);
      eq(`register ${kind}: the other kind's column is untouched`, task(h, TASK_A)[other], []);
      ok(`register ${kind}: no public URL is stored and nothing is removed`, task(h, TASK_A)[col].slice(1).every((p: string) => !/^https?:/.test(p)) && h.db.storageRemoved.length === 0);
      const again = await register(h, kind, paths);
      ok(`register ${kind}: registering the same objects again is refused (409) and removes nothing`, again.status === 409 && again.json?.error === 'already_registered' && h.db.storageRemoved.length === 0 && task(h, TASK_A)[col].length === 3);
    }
    {
      const h = world();
      const paths = await issue(h, 'delivery', 2);
      uploaded(h, [paths[0]]); // the second upload never arrived
      const r = await register(h, 'delivery', paths);
      ok('register: a batch with a missing upload is refused as a whole (409)', r.status === 409 && r.json?.error === 'upload_missing' && task(h, TASK_A).delivery_images.length === 0);
      ok('register: ... and the server removes the objects that did arrive (service-role remove)', h.db.storageRemoved.includes(`${EVIDENCE_BUCKET}:${paths[0]}`));
    }
    const hostile: Array<[string, string]> = [
      ['a browser-chosen name in the task folder', `${ORDER_A}/${TASK_A}/delivery/mine.jpg`],
      ['another task\'s folder', privatePath(ORDER_A, TASK_A2, 'delivery', OBJ1)],
      ['another order\'s folder', privatePath(ORDER_B, TASK_B, 'delivery', OBJ1)],
      ['the damage folder while registering delivery', privatePath(ORDER_A, TASK_A, 'damage', OBJ1)],
      ['a parent-directory path', `${ORDER_A}/${TASK_A}/delivery/../../${ORDER_B}/${TASK_B}/delivery/${OBJ1}.jpg`],
      ['a legacy-copy name (only the migration creates those)', `${ORDER_A}/${TASK_A}/delivery/legacy-drop-off-1-x.jpg`],
      ['a public-assets URL', legacyUrl(ORDER_A, 'IMG_1.jpg')],
      ['an external URL', 'https://evil.example.com/x.jpg'],
      ['a disallowed extension', `${ORDER_A}/${TASK_A}/delivery/${OBJ1}.html`],
    ];
    for (const [label, path] of hostile) {
      const h = world();
      h.db.storageObjects.push(`${EVIDENCE_BUCKET}:${path}`);
      const r = await register(h, 'delivery', [path]);
      ok(`register: ${label} is rejected (400) and nothing is recorded or removed`, r.status === 400 && task(h, TASK_A).delivery_images.length === 0 && h.db.storageRemoved.length === 0 && h.db.writes.length === 0);
    }
    for (const kind of ['public', 'lot_picture']) {
      const h = world();
      const r = await register(h, kind, [privatePath(ORDER_A, TASK_A, 'delivery', OBJ1)]);
      ok(`register: kind "${kind}" is rejected`, r.status === 400 && h.db.writes.length === 0);
    }
    {
      const h = world();
      const [p] = await issue(h, 'delivery');
      uploaded(h, [p]);
      const wrongTask = await register(h, 'delivery', [p], TASK_A2);
      ok('register: a path issued for one task cannot be registered on another task', wrongTask.status === 400 && task(h, TASK_A2).delivery_images.length === 0);
      const wrongKind = await register(h, 'damage', [p]);
      ok('register: a delivery path cannot be registered as damage evidence', wrongKind.status === 400 && task(h, TASK_A).damage_images.length === 0);
    }

    // discard
    {
      const h = world();
      const [p1, p2] = await issue(h, 'delivery', 2);
      uploaded(h, [p1, p2]);
      task(h, TASK_A).delivery_images = [p2];
      const r = await callFunction(loadFunction('task-evidence', h), 'jwt-crew', { action: 'discard', taskStatusId: TASK_A, kind: 'delivery', paths: [p1, p2] });
      ok('discard: removes an unregistered issued object', r.status === 200 && h.db.storageRemoved.includes(`${EVIDENCE_BUCKET}:${p1}`));
      ok('discard: ... never a registered one', !h.db.storageRemoved.includes(`${EVIDENCE_BUCKET}:${p2}`) && h.db.storageObjects.includes(`${EVIDENCE_BUCKET}:${p2}`));
      const cross = await callFunction(loadFunction('task-evidence', h), 'jwt-admin', { action: 'discard', taskStatusId: TASK_A, kind: 'delivery', paths: [privatePath(ORDER_B, TASK_B, 'delivery', OBJ1)] });
      ok('discard: another order\'s object cannot be named (400)', cross.status === 400);
    }
  }

  // ---- view ------------------------------------------------------------------------------------------------------------------------------------------------------------
  {
    const h = world();
    const priv = privatePath(ORDER_A, TASK_A, 'delivery', OBJ1);
    const dmg = privatePath(ORDER_A, TASK_A, 'damage', OBJ2);
    const legacy = legacyUrl(ORDER_A, 'IMG_9.jpg');
    task(h, TASK_A).delivery_images = [legacy, priv, 'https://evil.example.com/x.jpg', privatePath(ORDER_B, TASK_B, 'delivery', OBJ3), legacyUrl(ORDER_B, 'o.jpg')];
    task(h, TASK_A).damage_images = [dmg];
    task(h, TASK_B).delivery_images = [privatePath(ORDER_B, TASK_B, 'delivery', OBJ1)];
    const r = await callFunction(loadFunction('task-evidence', h), 'jwt-admin', { action: 'view', taskStatusIds: [TASK_A, TASK_B, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'] });
    const a = r.json?.tasks?.[TASK_A];
    ok('view: staff receive one entry per stored reference, in stored order', r.status === 200 && a.delivery.length === 5 && a.damage.length === 1);
    ok('view: a legacy URL and a private path are signed with short-lived URLs from their own buckets', /object\/sign\/public-assets\/.*ttl=3600/.test(a.delivery[0].url) && /object\/sign\/order-evidence\/.*ttl=3600/.test(a.delivery[1].url) && a.delivery[0].legacy === true && a.delivery[1].legacy === false);
    ok('view: an external URL, another order\'s path and another order\'s legacy object get no URL and no bucket', [2, 3, 4].every((i) => a.delivery[i].url === null && a.delivery[i].bucket === null));
    ok('view: damage evidence is available to staff', /object\/sign\/order-evidence\//.test(a.damage[0].url));
    ok('view: the response never contains a public URL', !/object\/public/.test(r.text));
    ok('view: only trusted objects were signed', [...h.db.storageSigned].sort().join() === [`public-assets:${ORDER_A}-drop-off-1760000000000-IMG_9.jpg`, `${EVIDENCE_BUCKET}:${priv}`, `${EVIDENCE_BUCKET}:${dmg}`, `${EVIDENCE_BUCKET}:${privatePath(ORDER_B, TASK_B, 'delivery', OBJ1)}`].sort().join());
    ok('view: an unknown task id is simply absent', r.json.tasks['cccccccc-cccc-4ccc-8ccc-cccccccccccc'] === undefined);
    {
      // a historical pick-up photo (task type "pick-up") stored as a public-assets URL is shown to staff through a signed URL
      const hp = world();
      const pickUp = `${ORDER_A}-pick-up-1760000000000-IMG_7.jpg`;
      task(hp, TASK_A2).delivery_images = [`https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/${pickUp}`];
      const pv = await callFunction(loadFunction('task-evidence', hp), 'jwt-admin', { action: 'view', taskStatusIds: [TASK_A2] });
      ok('view: a historical pick-up photo is recognized and signed for staff', /object\/sign\/public-assets\/.*pick-up-1760000000000-IMG_7\.jpg/.test(pv.json?.tasks?.[TASK_A2]?.delivery?.[0]?.url ?? '') && pv.json.tasks[TASK_A2].delivery[0].legacy === true);
    }
    const bad = await callFunction(loadFunction('task-evidence', world()), 'jwt-admin', { action: 'view', taskStatusIds: ['../x'] });
    ok('view: malformed ids are rejected', bad.status === 400);
    const extra = await callFunction(loadFunction('task-evidence', world()), 'jwt-admin', { action: 'view', taskStatusIds: [TASK_A], refs: ['x'] });
    ok('view: the browser cannot send references to be signed (400)', extra.status === 400);
  }

  // ======================================================================================================================
  // HANDLER: customer-portal-data - delivery photos for the customer's own order only
  // ======================================================================================================================
  {
    const dataWorld = (): Harness => {
      const h = world();
      task(h, TASK_A).delivery_images = [
        legacyUrl(ORDER_A, 'IMG_1.jpg'),
        privatePath(ORDER_A, TASK_A, 'delivery', OBJ1),
        privatePath(ORDER_B, TASK_B, 'delivery', OBJ2),
        privatePath(ORDER_A, TASK_A2, 'delivery', OBJ3),
        privatePath(ORDER_A, TASK_A, 'damage', OBJ3),
        legacyUrl(ORDER_B, 'theirs.jpg'),
        'https://evil.example.com/photo.jpg',
      ];
      task(h, TASK_A).damage_images = [privatePath(ORDER_A, TASK_A, 'damage', OBJ2), 'DAMAGE-SECRET-MARKER'];
      return h;
    };
    const data = async (bearer: string | null, body: Record<string, unknown>, h = dataWorld()) => ({ h, r: await callFunction(loadFunction('customer-portal-data', h), bearer, { sections: ['delivery'], ...body }) });
    const expectUrls = [
      new RegExp(`/object/sign/public-assets/${ORDER_A}-drop-off-1760000000000-IMG_1\\.jpg\\?.*ttl=3600`),
      new RegExp(`/object/sign/order-evidence/${ORDER_A}/${TASK_A}/delivery/${OBJ1}\\.jpg\\?.*ttl=3600`),
    ];
    for (const [label, bearer, token] of [['a valid portal token', ANON_KEY, TOK('p', ORDER_A)], ['the signed-in owner', 'jwt-A', undefined], ['the backend', SERVICE_KEY, undefined], ['an admin opening the portal read-only', 'jwt-admin', undefined]] as Array<[string, string, string | undefined]>) {
      const { h, r } = await data(bearer, { orderId: ORDER_A, ...(token ? { token } : {}) });
      const d = r.json?.data?.delivery;
      ok(`portal: ${label} receives the order's own delivery photos as signed URLs, same order and count as trusted references`, r.status === 200 && d.delivery_images.length === 2 && expectUrls.every((re, i) => re.test(d.delivery_images[i])));
      ok(`portal: ${label} - status and completion time are unchanged`, d.status === 'completed' && d.completed_time === '2026-10-01T12:00:00Z');
      ok(`portal: ${label} - no stored path, no public URL, no other order's photo and no damage evidence appears`, !/object\/public|evil\.example|DAMAGE-SECRET|damage_images|theirs\.jpg/.test(r.text) && !r.text.includes(ORDER_B) && !r.text.includes('/damage/'));
      eq(`portal: ${label} - only the two trusted delivery objects were signed`, [...h.db.storageSigned].sort(), [`${EVIDENCE_BUCKET}:${privatePath(ORDER_A, TASK_A, 'delivery', OBJ1)}`, `public-assets:${ORDER_A}-drop-off-1760000000000-IMG_1.jpg`].sort());
    }
    for (const [label, bearer, token] of [
      ['no credentials', null, undefined], ['the anon key and an order id only', ANON_KEY, undefined], ['a made-up token', ANON_KEY, 'z'.repeat(64)], ['an expired token', ANON_KEY, TOK('e', ORDER_A)],
      ['a revoked token', ANON_KEY, TOK('r', ORDER_A)], ['order B\'s token', ANON_KEY, TOK('p', ORDER_B)], ['an unrelated customer', 'jwt-B', undefined], ['a user who owns nothing', 'jwt-none', undefined],
    ] as Array<[string, string | null, string | undefined]>) {
      const { h, r } = await data(bearer, { orderId: ORDER_A, ...(token ? { token } : {}) });
      ok(`portal: ${label} is denied (403) and nothing is signed or returned`, r.status === 403 && h.db.storageSigned.length === 0 && !/order-evidence|public-assets|drop-off/.test(r.text));
    }
    {
      const { h, r } = await data(ANON_KEY, { orderId: ORDER_B, token: TOK('p', ORDER_A) });
      ok('portal: order A\'s token cannot read order B\'s delivery photos', r.status === 403 && h.db.storageSigned.length === 0);
    }
    {
      // the other task of the order (pickup) is not the delivery task; an order with no delivery photos returns none
      const h = world();
      const { r } = await data(ANON_KEY, { orderId: ORDER_A, token: TOK('p', ORDER_A) }, h);
      ok('portal: an order without delivery photos returns an empty list and signs nothing', r.json.data.delivery.delivery_images.length === 0 && h.db.storageSigned.length === 0);
    }
    const dt = read('src/components/customer-portal/DeliveryTab.tsx');
    ok('portal: the Delivery tab input contract is unchanged (an array of image URLs, rendered in order)', /delivery_images: string\[\]/.test(dt) && /deliveryImages\.map\(\(url, idx\)/.test(dt) && /<img\s+src=\{url\}/.test(dt));
    ok('portal: customer-portal-data never selects damage evidence', !/damage_images/.test(read('supabase/functions/customer-portal-data/index.ts').replace(/\/\/.*$/gm, '')));
  }

  // ======================================================================================================================
  // HANDLER: promote-media from private evidence
  // ======================================================================================================================
  {
    const promoteWorld = (): Harness => {
      const h = world();
      h.db.rpcResults.get_user_role = 'admin';
      h.db.tables.hero_carousel_images = [];
      h.db.tables.unit_media = [];
      h.db.tables.units = [{ id: 'unit-1', name: 'Castle' }];
      return h;
    };
    const idFor = (taskId: string, ref: string) => `delivery-${taskId}-${ref.slice(-16)}`;
    const priv = privatePath(ORDER_A, TASK_A, 'delivery', OBJ1);
    const legacy = legacyUrl(ORDER_A, 'IMG_5.jpg');
    for (const [label, ref, bucket, path] of [['a private evidence photo', priv, EVIDENCE_BUCKET, priv], ['a historical public-assets photo', legacy, 'public-assets', `${ORDER_A}-drop-off-1760000000000-IMG_5.jpg`]] as const) {
      const h = promoteWorld();
      task(h, TASK_A).delivery_images = [ref];
      const r = await callFunction(loadFunction('promote-media', h), 'jwt-admin', { source_type: 'delivery', source_id: idFor(TASK_A, ref), action: 'carousel', consent_confirmed: true });
      ok(`promote: ${label} is promoted by the admin`, r.status === 200 && r.json?.success === true);
      ok(`promote: ${label} - the source is read by the service-role client`, h.db.storageDownloads.includes(`${bucket}:${path}`));
      ok(`promote: ${label} - a COPY is written to the public marketing bucket and the source is unchanged`, h.db.storageUploads.some((u) => u.startsWith('carousel-media:promoted/')) && h.db.storageRemoved.length === 0 && task(h, TASK_A).delivery_images[0] === ref);
      const unit = promoteWorld();
      task(unit, TASK_A).delivery_images = [ref];
      const u = await callFunction(loadFunction('promote-media', unit), 'jwt-admin', { source_type: 'delivery', source_id: idFor(TASK_A, ref), action: 'unit', target_unit_id: 'unit-1', consent_confirmed: true });
      ok(`promote: ${label} can be promoted to a unit gallery`, u.status === 200 && unit.db.storageUploads.some((x) => x.startsWith('unit-images:promoted/')));
    }
    {
      const h = promoteWorld();
      task(h, TASK_A).delivery_images = [priv];
      h.db.rpcResults.get_user_role = 'customer';
      const r = await callFunction(loadFunction('promote-media', h), 'jwt-A', { source_type: 'delivery', source_id: idFor(TASK_A, priv), action: 'carousel', consent_confirmed: true });
      ok('promote: an ordinary customer cannot promote evidence and nothing is downloaded', r.status === 403 && h.db.storageDownloads.length === 0);
      const anon = await callFunction(loadFunction('promote-media', h), null, { source_type: 'delivery', source_id: idFor(TASK_A, priv), action: 'carousel', consent_confirmed: true });
      ok('promote: no credentials are refused', anon.status === 401 && h.db.storageDownloads.length === 0);
    }
    {
      const h = promoteWorld();
      task(h, TASK_A).damage_images = [privatePath(ORDER_A, TASK_A, 'damage', OBJ2)];
      const r = await callFunction(loadFunction('promote-media', h), 'jwt-admin', { source_type: 'damage', source_id: `damage-${TASK_A}-${privatePath(ORDER_A, TASK_A, 'damage', OBJ2).slice(-16)}`, action: 'carousel', consent_confirmed: true });
      ok('promote: damage evidence stays marketing-restricted (400, nothing downloaded or copied)', r.status === 400 && h.db.storageDownloads.length === 0 && h.db.storageUploads.length === 0);
      const noConsent = await callFunction(loadFunction('promote-media', h), 'jwt-admin', { source_type: 'delivery', source_id: idFor(TASK_A, priv), action: 'carousel' });
      ok('promote: the consent confirmation is still required', noConsent.status === 400);
    }
    {
      // a reference that does not belong to the task's order, or is untrusted, is never used as a source
      for (const [label, ref] of [['another order\'s private path', privatePath(ORDER_B, TASK_B, 'delivery', OBJ1)], ['another order\'s historical object', legacyUrl(ORDER_B, 'o.jpg')], ['an external URL', 'https://evil.example.com/x.jpg'], ['the damage folder', privatePath(ORDER_A, TASK_A, 'damage', OBJ1)]] as Array<[string, string]>) {
        const h = promoteWorld();
        task(h, TASK_A).delivery_images = [ref];
        const r = await callFunction(loadFunction('promote-media', h), 'jwt-admin', { source_type: 'delivery', source_id: idFor(TASK_A, ref), action: 'carousel', consent_confirmed: true });
        ok(`promote: ${label} in a task's delivery list is not a promotable source (400, nothing downloaded)`, r.status === 400 && h.db.storageDownloads.length === 0);
      }
      const h = promoteWorld();
      const r = await callFunction(loadFunction('promote-media', h), 'jwt-admin', { source_type: 'delivery', source_id: idFor(TASK_A, 'https://evil.example.com/x.jpg'), action: 'carousel', consent_confirmed: true });
      ok('promote: a reference that is not stored on the task cannot be promoted', r.status === 400 && h.db.storageDownloads.length === 0);
    }
  }

  // ======================================================================================================================
  // MIGRATION: historical evidence (fake Storage and database; nothing live)
  // ======================================================================================================================
  {
    const SIZE = 1000;
    function fakeWorld(opts: { failCopyFor?: (dst: string) => boolean; setColumnFails?: boolean; mutateDuringRewrite?: boolean } = {}) {
      const objects = new Map<string, number>();
      const log: string[] = [];
      const tasks: EvidenceTaskRow[] = [];
      const put = (bucket: string, path: string, size = SIZE) => objects.set(`${bucket}:${path}`, size);
      const deps: EvidenceMigrationDeps = {
        listTasks: async () => tasks.map((t) => JSON.parse(JSON.stringify(t))),
        listLegacyObjects: async () => [...objects.keys()].filter((k) => k.startsWith('public-assets:')).map((k) => k.slice('public-assets:'.length)),
        head: async (bucket, path) => (objects.has(`${bucket}:${path}`) ? { size: objects.get(`${bucket}:${path}`) ?? null } : null),
        copy: async (fb, fp, tb, tp) => {
          log.push(`copy ${fb}:${fp} -> ${tb}:${tp}`);
          if (opts.failCopyFor?.(tp)) return { ok: false, error: 'boom' };
          if (!objects.has(`${fb}:${fp}`)) return { ok: false, error: 'missing' };
          objects.set(`${tb}:${tp}`, objects.get(`${fb}:${fp}`) as number);
          return { ok: true };
        },
        setColumn: async (id, column, expected, next) => {
          log.push(`set ${id}.${column}`);
          if (opts.setColumnFails) return { ok: false, error: 'db down' };
          const row = tasks.find((t) => t.id === id) as any;
          if (JSON.stringify(row[column]) !== JSON.stringify(expected)) return { ok: false, conflict: true };
          row[column] = next;
          return { ok: true };
        },
        remove: async (bucket, paths) => {
          log.push(`remove ${bucket}:${paths.join(',')}`);
          for (const p of paths) objects.delete(`${bucket}:${p}`);
          return { ok: true };
        },
      };
      return { objects, log, tasks, put, deps };
    }
    const n = (o: string, name: string) => `${o}-drop-off-1760000000000-${name}`;
    const dest = (o: string, t: string, k: 'delivery' | 'damage', name: string) => `${o}/${t}/${k}/legacy-drop-off-1760000000000-${name}`;
    function seed(w: ReturnType<typeof fakeWorld>) {
      w.put('public-assets', 'bounce-party-club-logo.png', 50);
      for (const name of ['a.jpg', 'b.jpg', 'c.jpg', 'dmg.jpg', 'shared.jpg', 'orphan1.jpg', 'orphan2.jpg']) w.put('public-assets', n(ORDER_A, name));
      w.put('public-assets', n(ORDER_B, 'other.jpg'));
      w.tasks.push(
        { id: TASK_A, order_id: ORDER_A, delivery_images: [legacyUrl(ORDER_A, 'a.jpg'), legacyUrl(ORDER_A, 'b.jpg'), legacyUrl(ORDER_A, 'shared.jpg'), legacyUrl(ORDER_A, 'c.jpg')], damage_images: [legacyUrl(ORDER_A, 'dmg.jpg'), legacyUrl(ORDER_A, 'shared.jpg')] },
        { id: TASK_B, order_id: ORDER_B, delivery_images: [legacyUrl(ORDER_B, 'other.jpg')], damage_images: [] },
        { id: TASK_A2, order_id: ORDER_A, delivery_images: [], damage_images: [] },
      );
    }
    const refsOf = (w: ReturnType<typeof fakeWorld>, id: string, col: 'delivery_images' | 'damage_images') => (w.tasks.find((t) => t.id === id) as any)[col];

    // ---- plan (read only) ----
    {
      const w = fakeWorld();
      seed(w);
      w.tasks.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', order_id: ORDER_A, delivery_images: ['https://evil.example.com/x.jpg', legacyUrl(ORDER_B, 'other.jpg'), 7 as any, privatePath(ORDER_A, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'delivery', OBJ1)], damage_images: [] });
      const before = JSON.stringify([...w.objects.entries(), w.tasks]);
      const plan = await planEvidenceMigration(w.deps);
      eq('plan: counts', plan.counts, { tasksWithEvidence: 3, deliveryRefs: 9, damageRefs: 2, alreadyPrivate: 1, legacy: 7, malformed: 3, legacySourceMissing: 0, duplicateLegacyRefs: 1, unreferencedEvidenceObjects: 2, nonEvidenceObjectsIgnored: 1 });
      eq('plan: the same object referenced by delivery and damage is two planned entries with separate destinations', [plan.refs.filter((r) => r.sourcePath === n(ORDER_A, 'shared.jpg')).map((r) => r.destination)], [[dest(ORDER_A, TASK_A, 'delivery', 'shared.jpg'), dest(ORDER_A, TASK_A, 'damage', 'shared.jpg')]]);
      eq('plan: unreferenced evidence-named objects are listed for archiving, the logo is not', plan.archives.map((a) => a.sourcePath).sort(), [n(ORDER_A, 'orphan1.jpg'), n(ORDER_A, 'orphan2.jpg')]);
      ok('plan: malformed, external, wrong-order and non-string entries are classified and left alone', plan.refs.filter((r) => r.class === 'malformed').length === 3);
      eq('plan: it changes nothing', JSON.stringify([...w.objects.entries(), w.tasks]), before);
      ok('plan: it performs no copy, set or remove', w.log.length === 0);
    }

    // ---- full run ----
    {
      const w = fakeWorld();
      seed(w);
      const logoBefore = w.objects.get('public-assets:bounce-party-club-logo.png');
      const plan = await planEvidenceMigration(w.deps);
      const copy = await copyEvidence(w.deps, plan);
      eq('copy: each distinct destination is copied once (shared object twice: delivery and damage)', [copy.copied, copy.alreadyPresent, copy.failures.length], [7, 0, 0]);
      ok('copy: sources are untouched (copy never deletes)', [...w.objects.keys()].filter((k) => k.startsWith('public-assets:')).length === 9 && !w.log.some((l) => l.startsWith('remove')));
      ok('copy: every destination exists in the private bucket with the source size', plan.refs.filter((r) => r.class === 'legacy').every((r) => w.objects.get(`${EVIDENCE_BUCKET}:${r.destination}`) === SIZE));
      ok('copy: the database is not touched by the copy stage', w.log.every((l) => l.startsWith('copy')) && refsOf(w, TASK_A, 'delivery_images').every((r: string) => /^https:/.test(r)));
      const verified = await verifiedDestinations(w.deps, plan);
      const rewrite = await rewriteEvidenceReferences(w.deps, plan, verified);
      eq('rewrite: tasks and entries rewritten', [rewrite.tasksUpdated, rewrite.entriesRewritten, rewrite.conflicts.length, rewrite.failures.length], [2, 7, 0, 0]);
      eq('rewrite: delivery array order is preserved and every entry is now a private path', refsOf(w, TASK_A, 'delivery_images'), ['a.jpg', 'b.jpg', 'shared.jpg', 'c.jpg'].map((x) => dest(ORDER_A, TASK_A, 'delivery', x)));
      eq('rewrite: the damage array keeps its kind and order', refsOf(w, TASK_A, 'damage_images'), ['dmg.jpg', 'shared.jpg'].map((x) => dest(ORDER_A, TASK_A, 'damage', x)));
      ok('rewrite: the other order\'s task was rewritten into its own folder only', refsOf(w, TASK_B, 'delivery_images')[0] === dest(ORDER_B, TASK_B, 'delivery', 'other.jpg'));
      ok('rewrite: a rewritten entry is a trusted private reference in scope for its task', refsOf(w, TASK_A, 'delivery_images').every((r: string) => { const p = parseEvidenceReference(r); return !!p && !p.legacy && evidenceReferenceInScope(p, { orderId: ORDER_A, taskStatusId: TASK_A, kind: 'delivery' }); }));
      ok('rewrite: the source objects are still there (rewrite never deletes)', [...w.objects.keys()].filter((k) => k.startsWith('public-assets:')).length === 9);

      // rerun: nothing duplicates, nothing changes
      const snapshot = JSON.stringify([w.tasks, [...w.objects.entries()]]);
      const plan2 = await planEvidenceMigration(w.deps);
      eq('rerun: the plan finds no legacy references left', [plan2.counts.legacy, plan2.counts.alreadyPrivate], [0, 7]);
      const copy2 = await copyEvidence(w.deps, plan2);
      const rewrite2 = await rewriteEvidenceReferences(w.deps, plan2, await verifiedDestinations(w.deps, plan2));
      ok('rerun: no copy, no rewrite, no array change', copy2.copied === 0 && rewrite2.entriesRewritten === 0 && JSON.stringify([w.tasks, [...w.objects.entries()]]) === snapshot);

      // cleanup is a separate, explicit, verified step
      let refused = false;
      try { await cleanupVerifiedSources(w.deps, 'yes'); } catch { refused = true; }
      ok('cleanup: refused without the explicit confirmation token', refused && ![...w.log].some((l) => l.startsWith('remove')));
      const cleanup = await cleanupVerifiedSources(w.deps, CLEANUP_CONFIRMATION);
      eq('cleanup: only referenced-and-copied evidence sources are deleted; unreferenced objects (no archive yet) and the logo are kept', [cleanup.deleted.length, cleanup.keptUnverified.length, cleanup.keptStillReferenced.length], [6, 2, 0]);
      ok('cleanup: the logo and every unrelated asset survive', w.objects.get('public-assets:bounce-party-club-logo.png') === logoBefore);
      ok('cleanup: the unreferenced objects are still in public-assets until archived', w.objects.has(`public-assets:${n(ORDER_A, 'orphan1.jpg')}`));
      ok('cleanup: every private copy is still present', refsOf(w, TASK_A, 'delivery_images').every((r: string) => w.objects.has(`${EVIDENCE_BUCKET}:${r}`)));
      // archive the unreferenced evidence-looking objects, then clean them too
      const plan3 = await planEvidenceMigration(w.deps);
      const archive = await copyEvidence(w.deps, plan3, { includeUnreferenced: true });
      eq('archive: unreferenced evidence-named objects are copied to a private archive path', [archive.copied, archive.failures.length], [2, 0]);
      const cleanup2 = await cleanupVerifiedSources(w.deps, CLEANUP_CONFIRMATION);
      eq('cleanup: archived objects are then deleted from public-assets, nothing else', [cleanup2.deleted.length, [...w.objects.keys()].filter((k) => k.startsWith('public-assets:')).join()], [2, 'public-assets:bounce-party-club-logo.png']);
    }

    // ---- failure and recovery ----
    {
      const w = fakeWorld({ failCopyFor: (d) => d.endsWith('b.jpg') });
      seed(w);
      const plan = await planEvidenceMigration(w.deps);
      const copy = await copyEvidence(w.deps, plan);
      ok('failure: one failed copy is reported and the others continue', copy.failures.length === 1 && copy.copied === 6);
      const rewrite = await rewriteEvidenceReferences(w.deps, plan, await verifiedDestinations(w.deps, plan));
      const arr = refsOf(w, TASK_A, 'delivery_images');
      ok('failure: only verified entries are rewritten; the unverified one stays a historical URL, in place', arr[0] === dest(ORDER_A, TASK_A, 'delivery', 'a.jpg') && /^https:/.test(arr[1]) && arr[2] === dest(ORDER_A, TASK_A, 'delivery', 'shared.jpg') && rewrite.conflicts.length === 0);
      ok('failure: the mixed array is still fully readable (private path + historical URL)', arr.every((r: string) => !!parseEvidenceReference(r)));
      // rerun after the failure is fixed
      const healthy = w.deps;
      const plan2 = await planEvidenceMigration(healthy);
      const copy2 = await copyEvidence({ ...healthy, copy: async (fb, fp, tb, tp) => { w.objects.set(`${tb}:${tp}`, w.objects.get(`${fb}:${fp}`) as number); return { ok: true }; } }, plan2);
      ok('recovery: the rerun copies only what is missing', copy2.copied === 1);
      await rewriteEvidenceReferences(healthy, plan2, await verifiedDestinations(healthy, plan2));
      ok('recovery: after the rerun the array is fully private and ordered', refsOf(w, TASK_A, 'delivery_images')[1] === dest(ORDER_A, TASK_A, 'delivery', 'b.jpg') && refsOf(w, TASK_A, 'delivery_images').length === 4);
    }
    {
      const w = fakeWorld({ setColumnFails: true });
      seed(w);
      const plan = await planEvidenceMigration(w.deps);
      await copyEvidence(w.deps, plan);
      const rewrite = await rewriteEvidenceReferences(w.deps, plan, await verifiedDestinations(w.deps, plan));
      ok('failure: a database update that fails after the copy is reported, leaves the legacy URLs in place and keeps both objects', rewrite.failures.length > 0 && refsOf(w, TASK_A, 'delivery_images').every((r: string) => /^https:/.test(r)) && [...w.objects.keys()].filter((k) => k.startsWith('public-assets:')).length === 9);
      const cleanup = await cleanupVerifiedSources(w.deps, CLEANUP_CONFIRMATION);
      ok('failure: cleanup then refuses to delete anything still referenced by a historical URL', cleanup.deleted.length === 0 && cleanup.keptStillReferenced.length > 0);
    }
    {
      const w = fakeWorld();
      seed(w);
      const plan = await planEvidenceMigration(w.deps);
      await copyEvidence(w.deps, plan);
      // a task changes between the plan and the rewrite: the compare-and-set reports a conflict instead of overwriting
      const racing: EvidenceMigrationDeps = { ...w.deps, setColumn: async (id, column, expected, next) => { (w.tasks.find((t) => t.id === id) as any)[column] = [...expected, 'new-entry-added-meanwhile']; return await w.deps.setColumn(id, column, expected, next); } };
      const rewrite = await rewriteEvidenceReferences(racing, plan, await verifiedDestinations(racing, plan));
      ok('concurrency: an entry added during the rewrite is never overwritten (conflict, rerunnable)', rewrite.conflicts.length > 0 && refsOf(w, TASK_A, 'delivery_images').includes('new-entry-added-meanwhile'));
    }
    {
      // partial states
      const w = fakeWorld();
      seed(w);
      const plan = await planEvidenceMigration(w.deps);
      // copy exists, database still legacy
      w.objects.set(`${EVIDENCE_BUCKET}:${dest(ORDER_A, TASK_A, 'delivery', 'a.jpg')}`, SIZE);
      const copy = await copyEvidence(w.deps, plan);
      ok('partial: a destination that already exists with the right size is accepted, not copied again', copy.alreadyPresent === 1 && !w.log.some((l) => l.endsWith(`-> ${EVIDENCE_BUCKET}:${dest(ORDER_A, TASK_A, 'delivery', 'a.jpg')}`)));
      // destination exists with a different size: never overwritten
      const w2 = fakeWorld();
      seed(w2);
      w2.objects.set(`${EVIDENCE_BUCKET}:${dest(ORDER_A, TASK_A, 'delivery', 'a.jpg')}`, 7);
      const plan2 = await planEvidenceMigration(w2.deps);
      const copy2 = await copyEvidence(w2.deps, plan2);
      ok('partial: a destination with a different size is reported and never overwritten, and its reference is not rewritten', copy2.failures.some((f) => /different size/.test(f.reason)) && w2.objects.get(`${EVIDENCE_BUCKET}:${dest(ORDER_A, TASK_A, 'delivery', 'a.jpg')}`) === 7 && !(await verifiedDestinations(w2.deps, plan2)).has(dest(ORDER_A, TASK_A, 'delivery', 'a.jpg')));
      // database already rewritten but source still present: rerun is a no-op
      const w3 = fakeWorld();
      seed(w3);
      const p3 = await planEvidenceMigration(w3.deps);
      await copyEvidence(w3.deps, p3);
      await rewriteEvidenceReferences(w3.deps, p3, await verifiedDestinations(w3.deps, p3));
      const p3b = await planEvidenceMigration(w3.deps);
      ok('partial: database rewritten while the source remains - nothing more to do', p3b.counts.legacy === 0);
      // source already deleted, destination present, DB still legacy (cleanup ran early elsewhere)
      const w4 = fakeWorld();
      seed(w4);
      const p4 = await planEvidenceMigration(w4.deps);
      await copyEvidence(w4.deps, p4);
      w4.objects.delete(`public-assets:${n(ORDER_A, 'a.jpg')}`);
      const p4b = await planEvidenceMigration(w4.deps);
      const verified4 = await verifiedDestinations(w4.deps, p4b);
      ok('partial: a missing source with a present copy still verifies, so the reference can be rewritten', verified4.has(dest(ORDER_A, TASK_A, 'delivery', 'a.jpg')));
      // source missing and no copy: reported, left alone
      const w5 = fakeWorld();
      seed(w5);
      w5.objects.delete(`public-assets:${n(ORDER_A, 'c.jpg')}`);
      const p5 = await planEvidenceMigration(w5.deps);
      ok('partial: a reference whose source and copy are both missing is reported', p5.counts.legacySourceMissing === 1);
      const c5 = await copyEvidence(w5.deps, p5);
      ok('partial: ... it is a failure, not a silent skip, and it is not rewritten', c5.failures.some((f) => /missing/.test(f.reason)) && !(await verifiedDestinations(w5.deps, p5)).has(dest(ORDER_A, TASK_A, 'delivery', 'c.jpg')));
    }
    {
      // unrelated public-assets assets are never touched, even if named like a historical object belonging to nobody
      const w = fakeWorld();
      w.put('public-assets', 'bounce-party-club-logo.png', 50);
      w.put('public-assets', 'brand/hero.jpg', 60);
      w.put('public-assets', 'drop-off-1760000000000-promo.jpg', 70);
      const plan = await planEvidenceMigration(w.deps);
      await copyEvidence(w.deps, plan, { includeUnreferenced: true });
      await cleanupVerifiedSources(w.deps, CLEANUP_CONFIRMATION);
      ok('unrelated: marketing and brand assets are never copied, rewritten or deleted', w.objects.size === 3 && !w.log.some((l) => l.startsWith('copy') || l.startsWith('set') || l.startsWith('remove')));
    }
    // ---- a historical pick-up object (task type "pick-up") goes through every stage ----
    {
      const w = fakeWorld();
      const pk = (name: string) => `${ORDER_A}-pick-up-1760000000000-${name}`;
      const pkUrl = (name: string) => `https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/${pk(name)}`;
      w.put('public-assets', 'bounce-party-club-logo.png', 50);
      w.put('public-assets', pk('ref.jpg'));
      w.put('public-assets', pk('orphan.jpg'));
      w.put('public-assets', n(ORDER_A, 'drop.jpg'));
      w.tasks.push(
        { id: TASK_A, order_id: ORDER_A, delivery_images: [legacyUrl(ORDER_A, 'drop.jpg')], damage_images: [] },
        { id: TASK_A2, order_id: ORDER_A, delivery_images: [pkUrl('ref.jpg')], damage_images: [] },
      );
      const plan = await planEvidenceMigration(w.deps);
      eq('pick-up plan: both the drop-off and the pick-up reference are legacy evidence; the orphan is archivable; the logo is ignored', [plan.counts.legacy, plan.counts.malformed, plan.counts.unreferencedEvidenceObjects, plan.counts.nonEvidenceObjectsIgnored], [2, 0, 1, 1]);
      const ref = plan.refs.find((r) => r.sourcePath === pk('ref.jpg'));
      eq('pick-up plan: the destination keeps the pick-up label inside the pick-up task\'s own folder', ref?.destination, `${ORDER_A}/${TASK_A2}/delivery/legacy-pick-up-1760000000000-ref.jpg`);
      eq('pick-up plan: the unreferenced pick-up object is archived under the order', plan.archives.map((a) => a.destination), [`${ORDER_A}/unreferenced/legacy-pick-up-1760000000000-orphan.jpg`]);
      const copy = await copyEvidence(w.deps, plan, { includeUnreferenced: true });
      eq('pick-up copy: all three evidence objects are copied and verified, nothing else', [copy.copied, copy.failures.length, [...w.objects.keys()].filter((k) => k.startsWith(`${EVIDENCE_BUCKET}:`)).length], [3, 0, 3]);
      ok('pick-up copy: the logo is not copied and the sources are untouched', !w.objects.has(`${EVIDENCE_BUCKET}:bounce-party-club-logo.png`) && w.objects.has(`public-assets:${pk('ref.jpg')}`));
      const rewrite = await rewriteEvidenceReferences(w.deps, plan, await verifiedDestinations(w.deps, plan));
      eq('pick-up rewrite: both tasks are rewritten', [rewrite.tasksUpdated, rewrite.entriesRewritten, rewrite.conflicts.length, rewrite.failures.length], [2, 2, 0, 0]);
      eq('pick-up rewrite: the pick-up task now references its private copy', (w.tasks.find((t) => t.id === TASK_A2) as any).delivery_images, [`${ORDER_A}/${TASK_A2}/delivery/legacy-pick-up-1760000000000-ref.jpg`]);
      const cleanup = await cleanupVerifiedSources(w.deps, CLEANUP_CONFIRMATION);
      eq('pick-up cleanup: the referenced and archived pick-up sources and the drop-off source are deleted; the logo survives', [cleanup.deleted.length, [...w.objects.keys()].filter((k) => k.startsWith('public-assets:')).join()], [3, 'public-assets:bounce-party-club-logo.png']);
      ok('pick-up cleanup: every private copy is still there', [...w.objects.keys()].filter((k) => k.startsWith(`${EVIDENCE_BUCKET}:`)).length === 3);
    }
    {
      const src = read('supabase/functions/_shared/evidence-migration.ts');
      ok('migration source: it never fetches a stored URL (references are parsed to bucket and path only)', !/\bfetch\(/.test(src));
      ok('migration source: the delete is only reachable through the confirmed cleanup stage', (src.match(/deps\.remove\(/g) ?? []).length === 1 && /CLEANUP_CONFIRMATION\) throw/.test(src.replace(/ !== /g, ' ')) || /if \(confirmation !== CLEANUP_CONFIRMATION\) throw/.test(src));
      ok('migration source: cleanup deletes only after the copy is verified (same size) and no task references the source', /copy\.size !== source\.size/.test(src) && /stillReferenced\.has\(name\)/.test(src));
      const cli = read('scripts/migrate-order-evidence.mjs');
      ok('script: the default stage is read-only', /stage: 'plan'/.test(cli));
      ok('script: cleanup needs the explicit confirmation token', /args\.confirm !== CLEANUP_CONFIRMATION/.test(cli));
      ok('script: it refuses to run unless the project ref matches SUPABASE_URL and is not Production', /migrationRunBlocker\(/.test(cli));
      ok('script: it prints counts only (no file names)', !/console\.log\([^)]*\.(path|source|destination|ref)\b/.test(cli));
    }
    eq('guard: no SUPABASE_URL', migrationRunBlocker({ supabaseUrl: undefined, projectRef: 'x', stage: 'plan' }), 'SUPABASE_URL is not a Supabase project URL');
    eq('guard: a project ref that does not match the URL', migrationRunBlocker({ supabaseUrl: 'https://srxunxiytojjsuhcmzjg.supabase.co', projectRef: 'other', stage: 'copy' }), '--project-ref must name the project in SUPABASE_URL');
    eq('guard: a missing project ref', migrationRunBlocker({ supabaseUrl: 'https://srxunxiytojjsuhcmzjg.supabase.co', projectRef: undefined, stage: 'copy' }), '--project-ref must name the project in SUPABASE_URL');
    eq('guard: Production is refused', migrationRunBlocker({ supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`, projectRef: PRODUCTION_PROJECT_REF, stage: 'plan' }), 'refusing to run against Production');
    eq('guard: Dev with a matching ref is allowed', migrationRunBlocker({ supabaseUrl: 'https://srxunxiytojjsuhcmzjg.supabase.co', projectRef: 'srxunxiytojjsuhcmzjg', stage: 'plan' }), null);
    // ---- Production is refused unconditionally: no option, flag or environment variable lifts it ----
    {
      const DEV = 'srxunxiytojjsuhcmzjg';
      const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
      eq('guard: Production URL with the matching Production ref is refused', migrationRunBlocker({ supabaseUrl: PROD_URL, projectRef: PRODUCTION_PROJECT_REF, stage: 'cleanup' }), 'refusing to run against Production');
      eq('guard: Production URL with a wrong ref is refused (as Production)', migrationRunBlocker({ supabaseUrl: PROD_URL, projectRef: DEV, stage: 'plan' }), 'refusing to run against Production');
      eq('guard: a Dev URL with the Production ref is refused (the ref must match the URL)', migrationRunBlocker({ supabaseUrl: `https://${DEV}.supabase.co`, projectRef: PRODUCTION_PROJECT_REF, stage: 'plan' }), '--project-ref must name the project in SUPABASE_URL');
      for (const stage of ['plan', 'copy', 'rewrite', 'cleanup'] as const) {
        eq(`guard: Dev with the matching ref is allowed for the ${stage} stage`, migrationRunBlocker({ supabaseUrl: `https://${DEV}.supabase.co`, projectRef: DEV, stage }), null);
      }
      eq('guard: an unknown option object cannot lift it (a JavaScript caller adding allowProduction is ignored)', migrationRunBlocker({ supabaseUrl: PROD_URL, projectRef: PRODUCTION_PROJECT_REF, stage: 'plan', allowProduction: true } as any), 'refusing to run against Production');
      eq('guard: a Production URL with a port, path or upper-case host is still Production', [`${PROD_URL}:443`, `${PROD_URL}/rest/v1`, PROD_URL.toUpperCase()].map((u) => migrationRunBlocker({ supabaseUrl: u, projectRef: PRODUCTION_PROJECT_REF, stage: 'plan' })), ['refusing to run against Production', 'refusing to run against Production', 'refusing to run against Production']);

      // The real command line, run with arguments that cannot reach the network: every case ends before a client is created.
      // The command line runs with outbound network access disabled by a preload, so even a broken guard could not reach any project:
      // it would stop with "NETWORK BLOCKED" and the assertions below would fail.
      const blockNet = `${process.env.TEMP ?? process.env.TMPDIR ?? '.'}/block-network-for-cli-tests.cjs`;
      fs.writeFileSync(blockNet, [
        "const blocked = () => { throw new Error('NETWORK BLOCKED'); };",
        'globalThis.fetch = blocked;',
        "const net = require('net'); net.Socket.prototype.connect = blocked; net.connect = blocked; net.createConnection = blocked;",
        "const dns = require('dns'); dns.lookup = blocked; dns.promises.lookup = blocked;",
        "const tls = require('tls'); tls.connect = blocked;",
        '',
      ].join('\n'));
      const cli = (args: string[], env: Record<string, string>) => {
        const r = spawnSync('node', ['--require', blockNet, 'scripts/migrate-order-evidence.mjs', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env }, timeout: 60000 });
        return { status: r.status, text: `${r.stdout ?? ''}${r.stderr ?? ''}` };
      };
      const prodEnv = { SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key' };
      const a = cli(['--project-ref', PRODUCTION_PROJECT_REF, '--plan'], prodEnv);
      ok('cli: Production URL + matching Production ref is refused (exit 2)', a.status === 2 && /refusing to run against Production/.test(a.text));
      for (const flag of ['--allow-production', '--allowProduction', '--production', '--force', '--yes-really']) {
        const b = cli(['--project-ref', PRODUCTION_PROJECT_REF, '--copy', flag], prodEnv);
        ok(`cli: Production URL with the extra argument ${flag} is refused as an unknown argument (exit 2)`, b.status === 2 && new RegExp(`unknown argument: ${flag}`).test(b.text));
      }
      for (const [name, value] of [['ALLOW_PRODUCTION', '1'], ['MIGRATION_ALLOW_PRODUCTION', 'true'], ['I_KNOW_WHAT_I_AM_DOING', 'yes']] as Array<[string, string]>) {
        const c = cli(['--project-ref', PRODUCTION_PROJECT_REF, '--plan'], { ...prodEnv, [name]: value });
        ok(`cli: the environment variable ${name} does not lift the Production refusal`, c.status === 2 && /refusing to run against Production/.test(c.text));
      }
      const d = cli(['--project-ref', DEV, '--plan'], { SUPABASE_URL: `https://${DEV}.supabase.co.evil.example`, SUPABASE_SERVICE_ROLE_KEY: 'x' });
      ok('cli: a look-alike Supabase host is refused', d.status === 2 && /not a Supabase project URL/.test(d.text));
      const e = cli(['--project-ref', 'wrongwrongwrongwrong', '--plan'], { SUPABASE_URL: `https://${DEV}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'x' });
      ok('cli: Dev URL with a wrong project ref is refused', e.status === 2 && /--project-ref must name the project/.test(e.text));
      const f = cli(['--plan'], { SUPABASE_URL: `https://${DEV}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'x' });
      ok('cli: a missing project ref is refused', f.status === 2 && /--project-ref must name the project/.test(f.text));
      const g = cli(['--project-ref', DEV, '--plan'], { SUPABASE_URL: `https://${DEV}.supabase.co` });
      ok('cli: Dev URL with the matching ref passes the project guard (it then stops only because no service key is set, before any network use)', g.status === 2 && /SUPABASE_SERVICE_ROLE_KEY is not set/.test(g.text) && !/refusing|must name|not a Supabase/.test(g.text));
      const h = cli(['--project-ref', DEV, '--cleanup'], { SUPABASE_URL: `https://${DEV}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'x' });
      ok('cli: cleanup without the confirmation token never starts, even for Dev', h.status === 2 && /--cleanup needs --confirm/.test(h.text));

      const tooling = ['scripts/migrate-order-evidence.mjs', 'supabase/functions/_shared/evidence-migration.ts', 'supabase/functions/_shared/evidence-media.ts'].map((f) => [f, read(f)] as [string, string]);
      ok('source: no Production override exists in the migration tooling (no allowProduction, no --allow-production, no variant)', tooling.every(([, s]) => !/allowProduction|allow-production|allow_production/i.test(s)));
      ok('source: the Production check is unconditional in the guard and the command line cannot bypass it', /if \(urlRef === PRODUCTION_PROJECT_REF\) return "refusing to run against Production";/.test(tooling[1][1]) && !/process\.env\.[A-Z_]*PROD/.test(tooling[0][1]) && /migrationRunBlocker\(\{ supabaseUrl: url, projectRef: args\.projectRef, stage: args\.stage \}\)/.test(tooling[0][1]));
      ok('source: the guard takes no option that could widen it', /input: \{ supabaseUrl: string \| undefined; projectRef: string \| undefined; stage: "plan" \| "copy" \| "rewrite" \| "cleanup" \}/.test(tooling[1][1]));
    }
    eq('guard: a look-alike host is refused', migrationRunBlocker({ supabaseUrl: 'https://srxunxiytojjsuhcmzjg.supabase.co.evil.example', projectRef: 'srxunxiytojjsuhcmzjg', stage: 'plan' }), 'SUPABASE_URL is not a Supabase project URL');
  }

  // ======================================================================================================================
  // SOURCE: nothing writes or serves evidence through a public URL
  // ======================================================================================================================
  {
    const walk = (dir: string): string[] => (fs.readdirSync(dir, { withFileTypes: true }) as any[]).flatMap((e) => {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
      return /\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.|Scenarios\.ts$/.test(e.name) ? [p] : [];
    });
    const files = [...walk('src'), ...walk('supabase/functions'), ...walk('scripts')];
    const text = new Map<string, string>(files.map((f) => [f, read(f)]));
    const hits = (re: RegExp, only?: string) => files.filter((f) => (only ? f.startsWith(only) : true) && re.test(text.get(f)!));
    const code = (f: string) => text.get(f)!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    eq('scan: no browser code uploads into or serves from public-assets', hits(/from\(['"]public-assets['"]\)/, 'src'), []);
    eq('scan: no code builds a public URL for public-assets', hits(/getPublicUrl\(\s*['"]public-assets['"]|from\(['"]public-assets['"]\)\s*\.getPublicUrl/), []);
    eq('scan: the only code that names the public-assets bucket is the reference parser, the migration logic and the promotion function', files.filter((f) => /['"]public-assets['"]/.test(code(f))).sort(), ['scripts/migrate-order-evidence.mjs', 'supabase/functions/_shared/evidence-media.ts']);
    const upload = code('src/components/admin/task-detail/taskPhotoUpload.ts');
    ok('scan: the task photo pipeline uploads only through a server-issued signed upload', /uploadToSignedUrl\(target\.path, target\.token, uploadBlob/.test(upload) && !/\.upload\(/.test(upload) && !/getPublicUrl/.test(upload) && !/public-assets/.test(upload));
    ok('scan: the pipeline never writes task_status itself (the server records the paths)', !/from\('task_status'\)|\.update\(/.test(upload) && /action: 'register'/.test(upload));
    ok('scan: the pipeline sends only a task id, a kind and file metadata (never a bucket or a path to write)', /request_upload',\s*taskStatusId,\s*kind,\s*files: \[\{ name: uploadLabel, size: uploadBlob\.size, mimeType: uploadType \}\]/.test(upload));
    eq('scan: no browser code writes the evidence columns', hits(/update\(\{[^}]*(delivery_images|damage_images)|update\(\{ \[col\]/, 'src'), []);
    ok('scan: the evidence columns are written only by the task-evidence function and the migration logic', hits(/update\(\{\s*\[EVIDENCE_COLUMNS|setColumn|\.update\(\{ \[column\]/).sort().join() === ['scripts/migrate-order-evidence.mjs', 'supabase/functions/_shared/evidence-migration.ts', 'supabase/functions/task-evidence/index.ts'].sort().join() || hits(/EVIDENCE_COLUMNS\[task\.kind\]\]: \[\.\.\.current/).join() === 'supabase/functions/task-evidence/index.ts');
    const grid = code('src/components/admin/task-detail/TaskDetailPhotosGrid.tsx');
    ok('scan: the task photo grid never uses a stored reference as an image source', /useTaskEvidenceUrls\(taskStatusId, deliveryImages, damageImages\)/.test(grid) && /tile\(urls\.delivery\[idx\]/.test(grid) && /tile\(urls\.damage\[idx\]/.test(grid) && !/src=\{(ref|_ref|deliveryImages|damageImages)/.test(grid));
    const admin = code('src/hooks/useAdminPhotos.ts');
    ok('scan: the Admin photo library gets evidence URLs from the task-evidence function', /fetchTaskEvidenceViews\(/.test(admin) && /resolveEvidence:/.test(admin) && !/getPublicUrl/.test(admin));
    ok('scan: the Admin library resolves each evidence photo from the server views by task, kind and position, and drops untrusted ones', /evidenceViews\[taskStatusId\]\?\.\[kind\]\?\.\[index\]/.test(admin) && /view && view\.bucket \? \{ url: view\.url, bucket: view\.bucket, path: view\.path \} : null/.test(admin));
    const api = code('src/lib/tasks/taskEvidenceApi.ts');
    ok('scan: the evidence view API sends task ids only', /body: \{ action: 'view', taskStatusIds:/.test(api));
    const fn = code('supabase/functions/task-evidence/index.ts');
    ok('scan: task-evidence checks the caller before reading the request body fields or touching Storage', fn.indexOf('resolveCaller(') > 0 && fn.indexOf('resolveCaller(') < fn.indexOf('createSignedUploadUrl') && fn.indexOf('resolveCaller(') < fn.indexOf('.storage') && /return denied\(\);\s*if \(!isObj\(body\)/.test(fn));
    ok('scan: task-evidence accepts no bucket or path to write (the bucket is a constant)', !/\bbody\.(bucket|path)\b/.test(fn) && (fn.match(/from\(EVIDENCE_BUCKET\)/g) ?? []).length >= 3);
    ok('scan: task-evidence is a signed-in function (verify_jwt) and is the only new function', /\[functions\.task-evidence\]\s*verify_jwt = true/.test(read('supabase/config.toml')));
    const pm = code('supabase/functions/promote-media/index.ts');
    ok('scan: promote-media reads the evidence source with the service-role client and resolves it through the shared parser', /parseEvidenceReference\(verifiedUrl\)/.test(pm) && /adminClient\.storage\s*\.from\(sourceBucket\)\s*\.download\(sourceStoragePath\)/.test(pm) && !/\/public\/public-assets\//.test(pm));
    ok('scan: damage photos stay ineligible for promotion', /const ELIGIBLE_SOURCE_TYPES = \["lot", "order", "delivery"\] as const;/.test(text.get('supabase/functions/promote-media/index.ts')!));
    ok('scan: proof-photo requirement wording and confirmation are unchanged in the task modal', /No delivery photos have been taken yet/.test(text.get('src/components/admin/TaskDetailModal.tsx')!) && /Proceed without photos\?/.test(text.get('src/components/admin/TaskDetailModal.tsx')!));
  }

  // ---- task photo flow: the pipeline against a fake server and Storage -----------------------------------------------------------------------------------------------
  {
    const mod = await import('../../../components/admin/task-detail/taskPhotoUpload');
    const mkFile = (name: string, type: string, size: number): File => ({ name, type, size } as unknown as File);
    const makeClient = (opts: { uploadError?: (path: string) => any; registerFails?: boolean; requestFails?: boolean } = {}) => {
      const calls: any[] = [];
      let n = 0;
      const client: any = {
        functions: {
          invoke: async (name: string, o: any) => {
            calls.push(['invoke', name, o.body]);
            if (o.body.action === 'request_upload') {
              if (opts.requestFails) return { data: { success: false }, error: null };
              return { data: { success: true, bucket: EVIDENCE_BUCKET, uploads: [{ name: o.body.files[0].name, path: `${ORDER_A}/${o.body.taskStatusId}/${o.body.kind}/00000000-0000-4000-8000-00000000000${++n}.jpg`, token: `tok${n}` }] }, error: null };
            }
            if (o.body.action === 'register') return opts.registerFails ? { data: null, error: { message: 'x' } } : { data: { success: true }, error: null };
            return { data: { success: true }, error: null };
          },
        },
        storage: { from: (bucket: string) => ({ uploadToSignedUrl: async (path: string, token: string, _blob: any, o: any) => { calls.push(['upload', bucket, path, token, o?.contentType]); return { data: { path }, error: opts.uploadError?.(path) ?? null }; } }) },
      };
      return { client, calls };
    };
    const compress = async (f: File): Promise<Blob | null> => ({ size: Math.max(1, Math.floor(f.size / 3)) } as unknown as Blob);
    const run = (files: File[], isDamage: boolean | undefined, c: ReturnType<typeof makeClient>, comp = compress) => {
      const log = console.log; const warn = console.warn; const err = console.error;
      console.log = () => {}; console.warn = () => {}; console.error = () => {};
      return mod.uploadTaskPhotos({ files, orderId: ORDER_A, taskType: 'drop-off', taskStatusId: TASK_A, isDamage }, { client: c.client, compress: comp }).finally(() => { console.log = log; console.warn = warn; console.error = err; });
    };

    const c1 = makeClient();
    const r1 = await run([mkFile('a b.png', 'image/png', 3_000_000), mkFile('c.JPG', '', 1_000_000)], undefined, c1);
    eq('flow: two photos are authorized, uploaded in picker order and registered once as delivery evidence', c1.calls.map((c) => (c[0] === 'invoke' ? `${c[1]}:${c[2].action}:${c[2].kind}` : `upload:${c[1]}`)), ['task-evidence:request_upload:delivery', 'upload:order-evidence', 'task-evidence:request_upload:delivery', 'upload:order-evidence', 'task-evidence:register:delivery']);
    eq('flow: the label sent for authorization keeps the old naming rule (sanitized, .jpg when compressed)', c1.calls.filter((c) => c[0] === 'invoke' && c[2].action === 'request_upload').map((c) => c[2].files[0].name), ['a_b.jpg', 'c.jpg']);
    ok('flow: files are uploaded as compressed JPEG with the issued token and path', c1.calls.filter((c) => c[0] === 'upload').every((c) => c[4] === 'image/jpeg' && /^tok\d$/.test(c[3])));
    ok('flow: the registered paths are the issued paths in order, and no URL is involved', r1.uploadedPaths.length === 2 && JSON.stringify(c1.calls.find((c) => c[0] === 'invoke' && c[2].action === 'register')![2].paths) === JSON.stringify(r1.uploadedPaths) && r1.uploadedPaths.every((p: string) => !/^https?:/.test(p)));
    const c2 = makeClient();
    await run([mkFile('d.png', 'image/png', 1_000_000)], true, c2);
    ok('flow: damage photos are registered as damage evidence', c2.calls.some((c) => c[0] === 'invoke' && c[2].action === 'register' && c[2].kind === 'damage'));
    // HEIC, oversize, unsupported
    const c3 = makeClient();
    const r3 = await run([mkFile('x.heic', 'image/heic', 9 * 1024 * 1024), mkFile('y.HEIC', '', 11 * 1024 * 1024), mkFile('z.bmp', 'image/bmp', 1000)], undefined, c3, async () => null);
    eq('flow: HEIC under the limit uploads as-is; oversize HEIC and an unsupported type are skipped', [r3.uploadedPaths.length, r3.skippedHeic, r3.skippedLarge], [1, ['y.HEIC'], ['z.bmp']]);
    ok('flow: the HEIC original keeps its own type', c3.calls.some((c) => c[0] === 'upload' && c[4] === 'image/heic'));
    // nothing uploaded -> nothing registered, no server call at all
    const c4 = makeClient();
    await run([mkFile('big.heic', 'image/heic', 11 * 1024 * 1024)], undefined, c4);
    ok('flow: when nothing can be uploaded the server is not called', c4.calls.length === 0);
    // storage size rejection skips and continues
    const c5 = makeClient({ uploadError: (p) => (p.endsWith('0001.jpg') ? { message: 'The object exceeded the maximum allowed size' } : null) });
    const r5 = await run([mkFile('a.jpg', 'image/jpeg', 1000), mkFile('b.jpg', 'image/jpeg', 1000)], undefined, c5);
    eq('flow: a storage size rejection is skipped (not fatal) and the rest is registered', [r5.skippedLarge, r5.uploadedPaths.length], [['a.jpg'], 1]);
    // fatal storage error: abort, nothing registered, server cleans up issued objects
    const c6 = makeClient({ uploadError: (p) => (p.endsWith('0002.jpg') ? { message: 'network down' } : null) });
    let threw6: any = null;
    await run([mkFile('a.jpg', 'image/jpeg', 1000), mkFile('b.jpg', 'image/jpeg', 1000), mkFile('c.jpg', 'image/jpeg', 1000)], undefined, c6).catch((e) => { threw6 = e; });
    ok('flow: a fatal storage error aborts the batch (the third file never starts) and nothing is registered', !!threw6 && c6.calls.filter((c) => c[0] === 'upload').length === 2 && !c6.calls.some((c) => c[0] === 'invoke' && c[2].action === 'register'));
    ok('flow: ... and the server is asked to discard what was issued (the browser never deletes)', c6.calls.some((c) => c[0] === 'invoke' && c[2].action === 'discard' && c[2].paths.length === 2) && !c6.calls.some((c) => c[0] === 'remove'));
    // register failure: the task is not marked as having photos, error surfaces for retry
    const c7 = makeClient({ registerFails: true });
    let threw7: any = null;
    await run([mkFile('a.jpg', 'image/jpeg', 1000)], undefined, c7).catch((e) => { threw7 = e; });
    ok('flow: a failed registration throws (the modal shows the failure) and the server is asked to discard the upload', !!threw7 && c7.calls.some((c) => c[0] === 'invoke' && c[2].action === 'discard'));
    ok('flow: the thrown message never mentions "size" (so the modal shows the generic failure alert, as before)', !/size|maximum/i.test(threw7?.message ?? ''));
    // authorization failure
    const c8 = makeClient({ requestFails: true });
    let threw8: any = null;
    await run([mkFile('a.jpg', 'image/jpeg', 1000)], undefined, c8).catch((e) => { threw8 = e; });
    ok('flow: an authorization failure aborts before any upload', !!threw8 && !c8.calls.some((c) => c[0] === 'upload'));
    // retry: the same call again works from scratch
    const c9 = makeClient();
    const again = await run([mkFile('a.jpg', 'image/jpeg', 1000)], undefined, c9);
    ok('flow: retrying after a failure is an ordinary fresh upload', again.uploadedPaths.length === 1);
    eq('flow: summary text is unchanged', mod.buildPhotoUploadSummary({ uploadedPaths: ['p'], skippedHeic: [], skippedLarge: [] }, true), '1 damage photo(s) uploaded and saved successfully!');
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
      const run = (label: string, scenarios: ReturnType<typeof buildEvidenceScenarios>, script: string) => {
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
      const sql = MIGRATIONS.map((m) => read(m));
      const all = buildEvidenceScenarios();
      run('all three Storage migrations', all, buildPhotoScript(all, sql));
      const alone = buildEvidenceAloneScenarios();
      run('evidence migration alone, twice', alone, buildPhotoScript(alone, [sql[2], sql[2]], EVIDENCE_ALONE_FIXTURE_SQL));
    }
  }

  // ---- static facts about the new migration --------------------------------------------------------------------------------------------------------------------------------
  {
    const raw = read(MIGRATIONS[2]);
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
    ok('static: the evidence bucket is created private with image-only types and a 10 MB limit', /VALUES \(\s*'order-evidence',\s*'order-evidence',\s*false,\s*10485760,/.test(code) && /ARRAY\['image\/jpeg', 'image\/jpg', 'image\/png', 'image\/webp', 'image\/heic', 'image\/heif', 'image\/gif'\]/.test(code));
    ok('static: re-running keeps it private', /ON CONFLICT \(id\) DO UPDATE\s+SET public = false/.test(code));
    ok('static: it creates no policy at all', !/CREATE POLICY/i.test(code));
    ok('static: it removes only the staff upload policy for public-assets', /DROP POLICY IF EXISTS "Staff upload public assets" ON storage\.objects/.test(code) && (code.match(/DROP POLICY/g) ?? []).length === 2);
    ok('static: it does not touch any other bucket, object or table row', !/UPDATE storage\.buckets|DELETE FROM|UPDATE (storage\.objects|public\.)|INSERT INTO storage\.objects/i.test(code) && (code.match(/storage\.buckets/g) ?? []).length === 1);
    ok('static: its allowed types match the server list', EVIDENCE_MIME_TYPES.every((t) => code.includes(`'${t}'`)));
    ok('static: it does not use internal coordination labels', !/\b(A1|A2|Phase|Stage|Payment Safety)\b/.test(raw));
    const names = fs.readdirSync('supabase/migrations').filter((f: string) => f.endsWith('.sql')).sort();
    const lastStorage = names.indexOf(MIGRATIONS[MIGRATIONS.length - 1].split('/').pop());
    eq('static: the three Storage migrations are consecutive and in order', names.slice(lastStorage - 2, lastStorage + 1), MIGRATIONS.map((m) => m.split('/').pop()));
    ok('static: the committed waiver migration is not edited by this work', read(MIGRATIONS[0]).includes('signed-waivers'));
  }

  console.log(`Order evidence access tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} order evidence access test(s) failed`);
})();
