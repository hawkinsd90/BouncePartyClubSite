// Waiver Edge Function caller authorization.
//
// The functions that create, generate, read and upload legal waiver artifacts all run with the service role, so what a caller
// may do is decided entirely by the proof the function demands. These tests load the CURRENT source of each function, run it
// against the in-memory portal harness with the real shared authorization helpers, and check for every kind of caller:
//   - what it receives, and
//   - that a denied caller causes ZERO side effects (no Storage upload or download, no row written, no background work, no
//     call to another function).
// Functions covered: get-waiver-status, save-signature, generate-signed-waiver, upload-physical-waiver.
// Run: node node_modules/jiti/bin/jiti.js src/lib/waiverAuthorization.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');

import { storagePathFromReference, signStoredMedia } from '../../supabase/functions/_shared/media-paths';
import { addOrder, callFunction, loadFunction, makeHarness, tokenFor, USERS, SERVICE_KEY, ANON_KEY, FUTURE } from './portalTestHarness';
import type { Harness } from './portalTestHarness';

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

const PUB = 'https://srxunxiytojjsuhcmzjg.supabase.co/storage/v1/object/public';
const TOK_A = tokenFor('p-order-A');
const TOK_B = tokenFor('p-order-B');
const TOK_EXPIRED = tokenFor('e-order-A');
const TOK_REVOKED = tokenFor('r-order-A');
USERS['jwt-legacy'] = 'u-legacy';
USERS['jwt-profile-other'] = 'u-profile-other';

function world(): Harness {
  const h = makeHarness();
  addOrder(h.db, { id: 'order-A', customer: 'cust-A', status: 'confirmed' });
  addOrder(h.db, { id: 'order-B', customer: 'cust-B', status: 'confirmed' });
  addOrder(h.db, { id: 'order-U', customer: 'cust-A', status: 'confirmed' }); // never signed
  // A historical account: no customers.user_id, ownership only through customer_profiles -> contacts.customer_id.
  h.db.tables.customers.push({ id: 'cust-L', first_name: 'Lee', last_name: 'Legacy', email: 'lee@example.test', phone: '+15555550199', user_id: null });
  addOrder(h.db, { id: 'order-L', customer: 'cust-A', status: 'confirmed' });
  (h.db.tables.orders.find((o: any) => o.id === 'order-L') as any).customer_id = 'cust-L';
  h.db.tables.contacts = [
    { id: 'contact-L', customer_id: 'cust-L', email: 'lee@example.test' },
    { id: 'contact-X', customer_id: 'cust-B', email: 'bo@example.test' },
  ];
  h.db.tables.customer_profiles = [
    { id: 'prof-L', user_id: 'u-legacy', contact_id: 'contact-L' },
    { id: 'prof-X', user_id: 'u-profile-other', contact_id: 'contact-X' },
  ];
  h.db.tables.order_signatures.push(
    { id: 'sig-A', order_id: 'order-A', signed_at: '2026-10-01T10:00:00Z', signer_name: 'Ann Adams', waiver_version: 'v7', initials_data: { Assumption: 'AA' }, signature_image_url: `${PUB}/signatures/order-A-1.png`, pdf_url: `${PUB}/signed-waivers/waiver-order-A-1.pdf`, electronic_consent_given: true },
    { id: 'sig-L', order_id: 'order-L', signed_at: '2026-10-02T10:00:00Z', signer_name: 'Lee Legacy', waiver_version: 'v7', initials_data: {}, signature_image_url: 'order-L-1.png', pdf_url: 'waiver-order-L-1.pdf', electronic_consent_given: true },
    { id: 'sig-B', order_id: 'order-B', signed_at: '2026-10-03T10:00:00Z', signer_name: 'Bo Burns', waiver_version: 'paper', initials_data: {}, signature_image_url: '', pdf_url: null, electronic_consent_given: false, physical_waiver_storage_path: 'order-B/paper.pdf', physical_waiver_file_type: 'application/pdf', physical_waiver_uploaded_at: '2026-10-03T10:00:00Z', physical_waiver_upload_source: 'admin' },
  );
  return h;
}
const status = async (bearer: string | null, body: unknown, h = world()) => ({ h, r: await callFunction(loadFunction('get-waiver-status', h), bearer, body) });
const FAIL_CLOSED = { signed: false, data: null };
const NONE = (h: Harness) => h.db.storageSigned.length === 0;

(async () => {
  // ======================================================================================================================
  // get-waiver-status: an unauthorized caller learns nothing about the order's waiver
  // ======================================================================================================================
  {
    const unknown = (await status(ANON_KEY, { orderId: 'no-such-order' })).r.json;
    const callers: Array<[string, string | null, Record<string, unknown>]> = [
      ['no Authorization header and an order id', null, { orderId: 'order-A' }],
      ['the public anon key and an order id', ANON_KEY, { orderId: 'order-A' }],
      ['a made-up portal token', ANON_KEY, { orderId: 'order-A', token: 'z'.repeat(64) }],
      ['an expired portal token', ANON_KEY, { orderId: 'order-A', token: TOK_EXPIRED }],
      ['a revoked portal token', ANON_KEY, { orderId: 'order-A', token: TOK_REVOKED }],
      ['a portal token for another order', ANON_KEY, { orderId: 'order-A', token: TOK_B }],
      ['an unrelated signed-in customer', 'jwt-B', { orderId: 'order-A' }],
      ['a signed-in user with no customer ownership', 'jwt-none', { orderId: 'order-A' }],
      ['a signed-in user whose historical profile points at another customer', 'jwt-profile-other', { orderId: 'order-A' }],
      ['an unrelated customer naming the other order id with their own token', 'jwt-B', { orderId: 'order-A', token: TOK_B }],
    ];
    for (const [label, bearer, body] of callers) {
      const { h, r } = await status(bearer, body);
      eq(`status: ${label} receives the fail-closed answer`, r.json, FAIL_CLOSED);
      ok(`status: ${label} receives no signer name, initials, timestamp, version or file metadata`, !/Ann Adams|"AA"|2026-10-01|v7|has_pdf|has_signature|physical_waiver|signer_name|initials|object\/(public|sign)/.test(r.text));
      ok(`status: ${label} causes no signing request`, NONE(h));
      eq(`status: ${label} gets the same answer as for an order that does not exist (no existence oracle)`, r.json, unknown);
    }
    // Paper waiver: nothing leaks either.
    const paper = await status(ANON_KEY, { orderId: 'order-B' });
    eq('status: an unauthorized caller learns nothing about a paper waiver', paper.r.json, FAIL_CLOSED);
    // An unsigned order looks the same as everything above.
    eq('status: an unsigned order answers identically', (await status(ANON_KEY, { orderId: 'order-U' })).r.json, FAIL_CLOSED);
  }

  // ---- authorized callers still receive what they need -----------------------------------------------------------------------------------------
  {
    const authorized: Array<[string, string | null, Record<string, unknown>]> = [
      ['a valid portal token for the order', ANON_KEY, { orderId: 'order-A', token: TOK_A }],
      ['the signed-in owner (direct ownership)', 'jwt-A', { orderId: 'order-A' }],
      ['an admin', 'jwt-admin', { orderId: 'order-A' }],
      ['a master', 'jwt-master', { orderId: 'order-A' }],
      ['crew (existing shared behaviour, unchanged)', 'jwt-crew', { orderId: 'order-A' }],
      ['the service role', SERVICE_KEY, { orderId: 'order-A' }],
    ];
    for (const [label, bearer, body] of authorized) {
      const { r } = await status(bearer, body);
      const d = r.json?.data;
      ok(`status: ${label} receives the waiver data`, r.json?.signed === true && d?.signer_name === 'Ann Adams' && d?.waiver_version === 'v7' && d?.initials_data?.Assumption === 'AA' && d?.waiver_type === 'digital');
      ok(`status: ${label} receives 1-hour signed URLs for the PDF and the signature`, /\/object\/sign\/signed-waivers\/waiver-order-A-1\.pdf\?.*ttl=3600/.test(d?.pdf_url ?? '') && /\/object\/sign\/signatures\/order-A-1\.png\?.*ttl=3600/.test(d?.signature_image_url ?? ''));
      ok(`status: ${label} never receives a stored public URL`, !/object\/public/.test(r.text));
    }
    const paper = await status('jwt-admin', { orderId: 'order-B' });
    ok('status: an admin receives the paper-waiver metadata and a signed scan link', paper.r.json?.data?.waiver_type === 'paper_with_photo' && paper.r.json?.data?.physical_waiver?.has_file === true && /object\/sign\/physical-waivers\/order-B\/paper\.pdf/.test(paper.r.json?.data?.physical_waiver?.signed_url ?? ''));
    const own = await status('jwt-B', { orderId: 'order-B' });
    ok('status: the owner of the paper-waiver order receives it', own.r.json?.data?.physical_waiver?.has_file === true && /object\/sign\/physical-waivers/.test(own.r.json?.data?.physical_waiver?.signed_url ?? ''));
    eq('status: an authorized caller asking about an unsigned order is told it is unsigned', (await status('jwt-A', { orderId: 'order-U' })).r.json, FAIL_CLOSED);
    eq('status: an unknown order is answered the same way', (await status(SERVICE_KEY, { orderId: 'no-such-order' })).r.json, FAIL_CLOSED);
  }

  // ---- the historical profile -> contact -> customer ownership -------------------------------------------------------------------------------------------------
  {
    const { r } = await status('jwt-legacy', { orderId: 'order-L' });
    ok('status: a historical account (no customers.user_id, owner through profile -> contact -> customer) receives its own waiver', r.json?.signed === true && /object\/sign\/signed-waivers\/waiver-order-L-1\.pdf/.test(r.json?.data?.pdf_url ?? '') && /object\/sign\/signatures\/order-L-1\.png/.test(r.json?.data?.signature_image_url ?? ''));
    eq('status: the historical owner does not receive another customer\'s waiver', (await status('jwt-legacy', { orderId: 'order-A' })).r.json, FAIL_CLOSED);
    eq('status: another signed-in user does not receive the historical owner\'s waiver', (await status('jwt-B', { orderId: 'order-L' })).r.json, FAIL_CLOSED);
    eq('status: a profile that points at a different customer does not own the order', (await status('jwt-profile-other', { orderId: 'order-L' })).r.json, FAIL_CLOSED);
    eq('status: knowing the historical customer\'s email is not ownership', (await status(ANON_KEY, { orderId: 'order-L', email: 'lee@example.test' })).r.json, FAIL_CLOSED);
    const direct = await status('jwt-A', { orderId: 'order-A' });
    ok('status: direct ownership (customers.user_id) still works', direct.r.json?.signed === true);
  }

  // ======================================================================================================================
  // save-signature
  // ======================================================================================================================
  const sigBody = (over: Record<string, unknown> = {}) => ({
    orderId: 'order-A', customerId: 'cust-A', renterName: 'Ann Adams', renterPhone: '+15555550101', renterEmail: 'ann@example.test',
    eventDate: '2026-11-10', eventEndDate: '2026-11-10', eventAddressLine1: '1 Main St', eventAddressLine2: '', eventCity: 'Detroit', eventState: 'MI', eventZip: '48201',
    signatureDataUrl: 'data:image/png;base64,iVBORw0KGgo=', initialsData: { Assumption: 'AA' }, typedName: 'Ann Adams', waiverVersion: 'v7', waiverText: 'text',
    electronicConsentText: 'I agree', sendEmailConfirmation: false, ...over,
  });
  const sign = async (bearer: string | null, body: Record<string, unknown>, h = world()) => {
    const r = await callFunction(loadFunction('save-signature', h), bearer, body);
    await Promise.all(h.pending);
    return { h, r };
  };
  const noSideEffects = (h: Harness) =>
    h.db.storageUploads.length === 0 && h.db.storageDownloads.length === 0 && h.db.storageSigned.length === 0 &&
    !h.db.writes.some((w) => ['order_signatures', 'consent_records', 'orders', 'invoice_links'].includes(w.table)) &&
    h.fetches.length === 0 && h.pending.length === 0 && h.db.invokes.length === 0;
  {
    const denied: Array<[string, string | null, Record<string, unknown>]> = [
      ['no credentials', null, sigBody()],
      ['the public anon key and an order id + customer id', ANON_KEY, sigBody()],
      ['a made-up portal token', ANON_KEY, sigBody({ token: 'z'.repeat(64) })],
      ['an expired portal token', ANON_KEY, sigBody({ token: TOK_EXPIRED })],
      ['a revoked portal token', ANON_KEY, sigBody({ token: TOK_REVOKED })],
      ['a portal token for another order', ANON_KEY, sigBody({ token: TOK_B })],
      ['an unrelated signed-in customer', 'jwt-B', sigBody()],
      ['a signed-in user with no customer ownership', 'jwt-none', sigBody()],
      ['a signed-in user whose profile points at another customer', 'jwt-profile-other', sigBody()],
      ['an admin session without a portal token (no staff signing flow exists)', 'jwt-admin', sigBody()],
      ['an unrelated customer who names someone else\'s order and customer', 'jwt-B', sigBody({ orderId: 'order-A', customerId: 'cust-A', token: TOK_B })],
      ['an unknown order id with a token for a real order', ANON_KEY, sigBody({ orderId: 'no-such-order', token: TOK_A })],
    ];
    for (const [label, bearer, body] of denied) {
      const { h, r } = await sign(bearer, body);
      ok(`sign: ${label} is denied (403)`, r.status === 403 && r.json?.success === false && r.json?.error === 'access_required');
      ok(`sign: ${label} causes no side effect (no upload, no row, no waiver field, no consent, no background work, no function call)`, noSideEffects(h));
    }
  }
  {
    // A request that is authorized for the order but names a different customer is rejected before any side effect.
    const { h, r } = await sign(ANON_KEY, sigBody({ token: TOK_A, customerId: 'cust-B' }));
    ok('sign: a valid token with a mismatched customer id is rejected (400)', r.status === 400 && r.json?.error === 'customer_mismatch');
    ok('sign: ... with no side effect', noSideEffects(h));
  }
  {
    const { h, r } = await sign(ANON_KEY, sigBody({ token: TOK_A }));
    ok('sign: a valid portal token for the order signs it', r.status === 200 && r.json?.success === true);
    ok('sign: the signature image goes to the private signatures bucket', h.db.storageUploads.length === 1 && /^signatures:order-A-\d+\.png$/.test(h.db.storageUploads[0]));
    const row = h.db.tables.order_signatures.find((s: any) => s.id !== 'sig-A' && s.id !== 'sig-L' && s.id !== 'sig-B' && s.order_id === 'order-A');
    ok('sign: the stored signature reference is an object path, not a public URL', !!row && /^order-A-\d+\.png$/.test(row.signature_image_url) && !/^https?:/.test(row.signature_image_url));
    ok('sign: the signature belongs to the order\'s canonical customer', row?.customer_id === 'cust-A');
    const consent = h.db.writes.find((w) => w.table === 'consent_records');
    ok('sign: the consent record uses the canonical customer', consent?.payload?.customer_id === 'cust-A' && consent?.payload?.order_id === 'order-A');
    ok('sign: the order is marked signed', h.db.writes.some((w) => w.table === 'orders' && w.op === 'update' && w.payload?.e_signature_consent === true));
    ok('sign: the PDF is requested from the backend with the service-role key', h.fetches.some((f) => /\/functions\/v1\/generate-signed-waiver$/.test(f.url) && f.init?.headers?.Authorization === `Bearer ${SERVICE_KEY}`));
  }
  {
    const { r } = await sign(ANON_KEY, sigBody({ token: TOK_A, customerId: undefined }));
    ok('sign: the customer id is optional (the server derives it)', r.status === 200 && r.json?.success === true);
  }
  {
    const { h, r } = await sign('jwt-A', sigBody());
    ok('sign: the signed-in owner can sign without a token', r.status === 200 && r.json?.success === true && h.db.storageUploads.length === 1);
  }
  {
    const { r } = await sign(ANON_KEY, sigBody({ token: TOK_A, orderId: 'order-B' }));
    ok('sign: a token for order A cannot sign order B', r.status === 403);
  }
  {
    const { r } = await sign(ANON_KEY, sigBody({ token: TOK_A, signatureDataUrl: undefined }));
    ok('sign: missing required fields are still rejected (400)', r.status === 400);
  }

  // ======================================================================================================================
  // generate-signed-waiver: the backend only
  // ======================================================================================================================
  {
    const gen = async (bearer: string | null, h = world()) => ({ h, r: await callFunction(loadFunction('generate-signed-waiver', h), bearer, { signatureId: 'sig-A' }) });
    const callers: Array<[string, string | null]> = [
      ['no credentials', null], ['the public anon key', ANON_KEY], ['an ordinary signed-in customer', 'jwt-A'], ['another customer', 'jwt-B'],
      ['an admin session', 'jwt-admin'], ['a portal token used as a bearer', TOK_A], ['a made-up bearer', 'z'.repeat(40)],
    ];
    for (const [label, bearer] of callers) {
      const { h, r } = await gen(bearer);
      ok(`generate: ${label} is denied (403)`, r.status === 403 && r.json?.error === 'access_required');
      ok(`generate: ${label} causes no download, upload, signature update or order update`, h.db.storageDownloads.length === 0 && h.db.storageUploads.length === 0 && h.db.writes.length === 0 && h.fetches.length === 0);
    }
    const missing = await callFunction(loadFunction('generate-signed-waiver', world()), SERVICE_KEY, { signatureId: 'no-such-signature' });
    ok('generate: the service-role key passes the caller check (the request then fails on the unknown signature)', missing.status === 404 && missing.json?.error === 'Signature not found');
    const noId = await callFunction(loadFunction('generate-signed-waiver', world()), null, {});
    ok('generate: a request with no signature id is a 400 and reveals nothing', noId.status === 400);
  }

  // ======================================================================================================================
  // upload-physical-waiver: portal token must be unexpired AND not revoked
  // ======================================================================================================================
  {
    const up = async (bearer: string | null, fields: Record<string, string>, h = world(), withFile = true) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      if (withFile) fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }), 'waiver.pdf');
      const headers: Record<string, string> = {};
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      const res = await loadFunction('upload-physical-waiver', h)(new Request('https://fake.functions/x', { method: 'POST', headers, body: fd }));
      let json: any = null;
      try { json = JSON.parse(await res.text()); } catch { json = null; }
      return { h, status: res.status, json };
    };
    const clean = (h: Harness) => h.db.storageUploads.length === 0 && !h.db.writes.some((w) => w.table === 'order_signatures' || w.table === 'orders');
    for (const [label, token] of [['a made-up token', 'z'.repeat(64)], ['an expired token', TOK_EXPIRED], ['a revoked token', TOK_REVOKED], ['a token for another order', TOK_B]] as Array<[string, string]>) {
      const { h, status: st } = await up(ANON_KEY, { orderId: 'order-U', token, uploadSource: 'portal' });
      ok(`upload: ${label} is denied (403) with no upload and no row`, st === 403 && clean(h));
    }
    const none = await up(ANON_KEY, { orderId: 'order-U', uploadSource: 'portal' });
    ok('upload: no token at all is denied (401) with no upload and no row', none.status === 401 && clean(none.h));
    const unrelated = await up('jwt-B', { orderId: 'order-U', uploadSource: 'portal' });
    ok('upload: an unrelated signed-in customer without a token is denied', unrelated.status === 403 && clean(unrelated.h));
    const good = await up(ANON_KEY, { orderId: 'order-U', token: tokenFor('p-order-U'), uploadSource: 'portal' });
    ok('upload: a valid portal token for the order can upload to the private physical-waivers bucket', good.status === 200 && good.h.db.storageUploads.some((u) => /^physical-waivers:order-U\//.test(u)));
  }

  // ======================================================================================================================
  // Config and source facts
  // ======================================================================================================================
  const cfg = read('supabase/config.toml');
  const verify = (fn: string) => (cfg.match(new RegExp('\\[functions\\.' + fn + '\\]\\s*verify_jwt = (true|false)')) ?? [])[1];
  eq('config: save-signature does not verify a JWT (the visitor is not signed in); the function authorizes the order itself', verify('save-signature'), 'false');
  eq('config: generate-signed-waiver does not verify a JWT; the function requires the service-role key itself', verify('generate-signed-waiver'), 'false');
  eq('config: get-waiver-status does not verify a JWT; the function authorizes the order itself', verify('get-waiver-status'), 'false');
  eq('config: upload-physical-waiver verifies a JWT (the public anon key qualifies) and then authorizes the order itself', verify('upload-physical-waiver'), 'true');
  const sigSrc = read('supabase/functions/save-signature/index.ts');
  ok('source: save-signature authorizes before it decodes or uploads anything', sigSrc.indexOf('authorizePortalOrder(') > 0 && sigSrc.indexOf('authorizePortalOrder(') < sigSrc.indexOf('atob(') && sigSrc.indexOf('authorizePortalOrder(') < sigSrc.indexOf('.storage'));
  ok('source: save-signature derives the customer from the order and never uses the claimed id', /customerId = orderRow\.customer_id/.test(sigSrc) && !/customer_id: claimedCustomerId/.test(sigSrc) && !/customer_id: customerId,[\s\S]{0,40}signer/.test('') );
  const genSrc = read('supabase/functions/generate-signed-waiver/index.ts');
  ok('source: generate-signed-waiver checks the caller before its first database read', genSrc.indexOf('resolveCaller(') > 0 && genSrc.indexOf('resolveCaller(') < genSrc.indexOf('.from("order_signatures")'));
  const callersOfGenerate = ['supabase/functions', 'src'].flatMap((d) => (fs.readdirSync(d, { recursive: true }) as string[]).map((f) => `${d}/${f.replace(/\\/g, '/')}`)).filter((f) => /\.(ts|tsx)$/.test(f) && !/node_modules|\.test\.|Scenarios/.test(f) && /functions\/v1\/generate-signed-waiver/.test(read(f)));
  eq('source: the only caller of generate-signed-waiver is save-signature', callersOfGenerate, ['supabase/functions/save-signature/index.ts']);
  const callersOfSave = fs.readdirSync('src', { recursive: true }).map((f: string) => `src/${f.replace(/\\/g, '/')}`).filter((f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && /functions\/v1\/save-signature/.test(read(f)));
  eq('source: the only caller of save-signature is the signing page', callersOfSave, ['src/pages/Sign.tsx']);
  const signPage = read('src/pages/Sign.tsx');
  ok('source: the signing page sends the portal token and the visitor\'s own session (not just the public key)', /token: readPortalToken\(\) \?\? undefined/.test(signPage) && /headers: await waiverFunctionHeaders\(\)/.test(signPage));
  const waiverTab = read('src/components/waiver/WaiverTab.tsx');
  ok('source: the portal waiver tab sends the visitor\'s own session when there is one', /headers: await waiverFunctionHeaders\(\)/.test(waiverTab));
  ok('source: the shared owner helper compares only ids (no email, phone or name)', !/email|phone|first_name|last_name/i.test((read('supabase/functions/_shared/auth.ts').match(/export async function userOwnsOrderViaProfile[\s\S]*?\n}\n/) ?? [''])[0]));

  // ======================================================================================================================
  // Storage reference compatibility: only the bucket path is taken; the object is always signed by THIS project's client
  // ======================================================================================================================
  {
    const signedBy: string[] = [];
    const current = { storage: { from: (b: string) => ({ createSignedUrl: async (p: string) => { signedBy.push(`current:${b}:${p}`); return { data: { signedUrl: `https://current.supabase.co/sign/${b}/${p}` }, error: null }; } }) } };
    const foreign = 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/signed-waivers/waiver-1.pdf';
    eq('compat: a historical URL from another project host yields only the bucket path', storagePathFromReference(foreign, 'signed-waivers'), 'waiver-1.pdf');
    const realFetch = globalThis.fetch;
    let contacted = 0;
    globalThis.fetch = (async () => { contacted++; throw new Error('network is not allowed'); }) as typeof fetch;
    try {
      await signStoredMedia(current, 'signed-waivers', foreign);
    } finally {
      globalThis.fetch = realFetch;
    }
    eq('compat: signing a historical Production URL contacts no host', contacted, 0);
    eq('compat: the signed URL comes from the current project\'s client', await signStoredMedia(current, 'signed-waivers', foreign), 'https://current.supabase.co/sign/signed-waivers/waiver-1.pdf');
    eq('compat: the current project signed exactly that bucket path', signedBy, ['current:signed-waivers:waiver-1.pdf', 'current:signed-waivers:waiver-1.pdf']);
    eq('compat: a URL that is not a Storage object URL is rejected', storagePathFromReference('https://qaagfafagdpgzcijnfbw.supabase.co/rest/v1/orders?id=eq.1', 'signed-waivers'), null);
    eq('compat: another bucket\'s object URL is rejected', storagePathFromReference('https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/lot-pictures/x.jpg', 'signed-waivers'), null);
    eq('compat: a non-Supabase host with a copied Storage path is rejected', storagePathFromReference('https://evil.example.com/storage/v1/object/public/signed-waivers/x.pdf', 'signed-waivers'), null);
    eq('compat: a non-Supabase host with query/fragment tricks is rejected', storagePathFromReference('https://evil.example.com/a?x=https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/signed-waivers/x.pdf#/storage/v1/object/public/signed-waivers/y.pdf', 'signed-waivers'), null);
    ok('compat: the parser and signer never fetch anything (no foreign host is contacted)', !/\bfetch\(/.test(read('supabase/functions/_shared/media-paths.ts')));
    ok('compat: generate-signed-waiver reads the signature with its own Storage client, not by fetching the stored URL', /supabaseClient\.storage\.from\("signatures"\)\.download\(sigPath\)/.test(genSrc) && !/fetch\(signature\.signature_image_url\)/.test(genSrc));
  }

  // ======================================================================================================================
  // Response contract of get-waiver-status
  // ======================================================================================================================
  {
    const keys = (o: any) => Object.keys(o ?? {}).sort();
    const auth = (await status('jwt-A', { orderId: 'order-A' })).r.json;
    eq('contract: authorized + digital waiver', keys(auth.data), ['has_pdf', 'has_signature_image', 'initials_data', 'pdf_url', 'physical_waiver', 'signature_image_url', 'signed_at', 'signer_name', 'waiver_type', 'waiver_version']);
    ok('contract: a digital waiver has no physical_waiver block', auth.data.physical_waiver === null && auth.signed === true);
    const paper = (await status('jwt-B', { orderId: 'order-B' })).r.json;
    eq('contract: authorized + paper waiver carries the physical_waiver block', keys(paper.data.physical_waiver), ['file_type', 'has_file', 'signed_url', 'upload_source', 'uploaded_at']);
    eq('contract: unauthorized, unsigned and unknown are all', (await status(null, { orderId: 'order-A' })).r.json, FAIL_CLOSED);
    const walkerTab = read('src/components/waiver/WaiverTab.tsx');
    ok('contract: the portal tab handles a null data answer (shows the unsigned view)', /setSignatureData\(data\)/.test(walkerTab) && /!signatureData/.test(walkerTab));
  }

  void FUTURE;
  console.log(`Waiver authorization tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} waiver authorization test(s) failed`);
})();
