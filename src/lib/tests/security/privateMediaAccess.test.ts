// Private order and waiver media.
//
// Layers (each labelled so nobody mistakes one for another):
//   STATIC      reads the migration text (always runs).
//   UNIT        the pure storage-reference parser and signer (always runs).
//   HANDLER     runs the CURRENT get-waiver-status source against the in-memory portal harness with real shared auth helpers:
//               who receives a signed URL, who does not (always runs).
//   SOURCE      scans the application and Edge Function source for how each bucket is read, written and deleted (always runs).
//   EXECUTED    applies the migration inside a rolled-back transaction in a SCRATCH PostgreSQL database and evaluates the
//               bucket flags and storage.objects policies for the real anon / authenticated / service_role roles. It never
//               touches a Supabase project. Same variables as the other database tests: CORE_DB_NAME (default "scratch"),
//               CORE_DB_PORT, CORE_DB_HOST, CORE_DB_PSQL; CORE_DB_REQUIRE=1 makes a missing database a failure.
//   NOT EXECUTABLE LOCALLY: the HTTP behaviour of a public or private bucket (anonymous GET of an object URL) and real signed
//   URL minting are Supabase Storage features, not Postgres; they are covered by the statements above plus the fake Storage in
//   the harness, and need a read-only look at Dev after the migration is applied.
// Run: node node_modules/jiti/bin/jiti.js src/lib/privateMediaAccess.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };
const fs = require('fs');
const { spawnSync } = require('child_process');

import { storagePathFromReference, signStoredMedia } from '../../../../supabase/functions/_shared/media-paths';
import {
  ALL_BUCKETS, EXPECTED_POLICIES, MARKETING_BUCKETS, PRIVATE_BUCKETS, buildMediaScenarios, buildMediaScript,
} from '../support/privateMediaAccessScenarios';
import { addOrder, callFunction, loadFunction, makeHarness, tokenFor, SERVICE_KEY, ANON_KEY } from '../support/portalTestHarness';

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
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

const MIGRATION = 'supabase/migrations/20261014120000_protect_waiver_media_and_restrict_storage_access.sql';
const raw = read(MIGRATION);
const sql = stripSql(raw);

// ---------------------------------------------------------------------------------------------------------------
// STATIC
// ---------------------------------------------------------------------------------------------------------------
{
  const files: string[] = fs.readdirSync('supabase/migrations').sort();
  ok('static: the migration sorts after the remaining public database access migration', files.indexOf('20261014120000_protect_waiver_media_and_restrict_storage_access.sql') > files.indexOf('20261013120000_restrict_remaining_public_database_access.sql') && files.indexOf('20261013120000_restrict_remaining_public_database_access.sql') >= 0);
  ok('static: no internal coordination label in the migration name or text', !new RegExp(['payment', 'safety'].join('_') + '|payment safety|\\bA[0-9](\\.[0-9])?\\b|\\bPhase\\b|\\bStage\\b', 'i').test('20261014120000_protect_waiver_media_and_restrict_storage_access.sql' + raw));
  ok('static: the only bucket change is making signed-waivers, signatures and physical-waivers private', (sql.match(/UPDATE storage\.buckets[^;]*;/g) ?? []).join() === "UPDATE storage.buckets SET public = false WHERE id IN ('signed-waivers', 'signatures', 'physical-waivers');" && !/INSERT INTO storage\.buckets|DELETE FROM storage\.(buckets|objects)|UPDATE storage\.objects/i.test(sql));
  ok('static: no object is moved, copied, deleted or rewritten and no table is touched', !/\b(INSERT INTO|DELETE FROM|TRUNCATE|ALTER TABLE|CREATE TABLE|CREATE FUNCTION|DROP TABLE)\b/i.test(sql.replace(/UPDATE storage\.buckets[^;]*;/g, '')));
  const reset = (sql.match(/buckets text\[\] := ARRAY\[([\s\S]*?)\];/) ?? ['', ''])[1];
  const resetBuckets = [...reset.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  ok('static: the policy reset covers exactly the nine buckets in scope', JSON.stringify([...resetBuckets].sort()) === JSON.stringify([...ALL_BUCKETS].sort()) && resetBuckets.length === 9);
  ok('static: the reset drops policies by what they mention, whatever their names', /FROM pg_policies p[\s\S]*?schemaname = 'storage' AND p\.tablename = 'objects'[\s\S]*?LIKE[\s\S]*?DROP POLICY %I ON storage\.objects/.test(sql));
  const created = [...sql.matchAll(/CREATE POLICY "([^"]+)" ON storage\.objects/g)].map((m) => m[1]);
  ok('static: the migration creates exactly the documented policy set', JSON.stringify([...created].sort()) === JSON.stringify([...EXPECTED_POLICIES].sort()));
  const policyText = (name: string) => (sql.match(new RegExp('CREATE POLICY "' + name + '" ON storage\\.objects[\\s\\S]*?;'))?.[0] ?? '');
  for (const name of EXPECTED_POLICIES) {
    const t = policyText(name);
    ok(`static: policy "${name}" is bound to explicit buckets and never to a private bucket`, /bucket_id (=|IN)/.test(t) && !PRIVATE_BUCKETS.some((b) => t.includes(`'${b}'`)));
  }
  const toPublicOrAnon = created.filter((n) => /TO (public|anon)/.test(policyText(n)));
  ok('static: the only policies open to anonymous callers are marketing read and the two folder-shaped uploads', JSON.stringify([...toPublicOrAnon].sort()) === JSON.stringify(['Public read marketing media', 'Upload lot pictures into an order folder', 'Upload order pictures into an order folder'].sort()));
  ok('static: the anonymous policies are SELECT on marketing buckets only, and INSERT constrained to "<uuid>/<file>"', /Public read marketing media" ON storage\.objects\s+FOR SELECT TO public\s+USING \(bucket_id IN \('unit-images', 'carousel-media', 'event-essentials-media'\)\)/.test(sql) && ['lot-pictures', 'order-pictures'].every((b) => new RegExp("FOR INSERT TO anon, authenticated\\s+WITH CHECK \\(bucket_id = '" + b + "' AND name ~\\* '\\^\\[0-9a-f\\]\\{8\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{4\\}-\\[0-9a-f\\]\\{12\\}/\\[\\^/\\]\\+\\$'\\)").test(sql)));
  ok('static: only Admin / Master can delete or replace anything (writes by anon or signed-in customers do not exist beyond the two folder-shaped uploads)', created.filter((n) => /FOR (DELETE|UPDATE|ALL)/.test(policyText(n))).every((n) => /\(SELECT public\.is_admin\(\)\)/.test(policyText(n))));
  ok('static: staff (crew) get only public-assets upload and order-picture read', created.filter((n) => /is_crew_or_admin/.test(policyText(n))).sort().join() === ['Staff read order pictures', 'Staff upload public assets'].sort().join());
  ok('static: the migration documents the residual (public buckets that still hold customer photos)', /Not changed here/.test(raw) && /lot-pictures, order-pictures and public-assets stay PUBLIC/.test(raw));
}

(async () => {
// ---------------------------------------------------------------------------------------------------------------
// UNIT: the storage-reference parser and signer
// ---------------------------------------------------------------------------------------------------------------
{
  const host = 'https://srxunxiytojjsuhcmzjg.supabase.co/storage/v1/object';
  eq('unit: a historical public URL resolves to its object path', storagePathFromReference(`${host}/public/signed-waivers/waiver-123-1700000000000.pdf`, 'signed-waivers'), 'waiver-123-1700000000000.pdf');
  eq('unit: a sign / authenticated URL resolves too', storagePathFromReference(`${host}/sign/signatures/o/1.png?token=x`, 'signatures'), 'o/1.png');
  eq('unit: a URL from another project host resolves (only the bucket path is used)', storagePathFromReference('https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/signatures/a.png', 'signatures'), 'a.png');
  eq('unit: a current (Dev) project public URL is accepted', storagePathFromReference('https://srxunxiytojjsuhcmzjg.supabase.co/storage/v1/object/public/signed-waivers/w.pdf', 'signed-waivers'), 'w.pdf');
  eq('unit: a historical Production project public URL is accepted as a reference (host validated, never contacted)', storagePathFromReference('https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/signed-waivers/w.pdf', 'signed-waivers'), 'w.pdf');
  eq('unit: another genuine-format Supabase project URL is accepted (the rule is the host form, not one pinned project)', storagePathFromReference('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/signed-waivers/w.pdf', 'signed-waivers'), 'w.pdf');
  eq('unit: an authenticated-form URL is accepted', storagePathFromReference('https://srxunxiytojjsuhcmzjg.supabase.co/storage/v1/object/authenticated/signed-waivers/w.pdf', 'signed-waivers'), 'w.pdf');
  eq('unit: a bare object path resolves', storagePathFromReference('waiver-9.pdf', 'signed-waivers'), 'waiver-9.pdf');
  eq('unit: a nested bare path resolves', storagePathFromReference('order/x.pdf', 'physical-waivers'), 'order/x.pdf');
  eq('unit: percent-encoded names are decoded', storagePathFromReference(`${host}/public/signed-waivers/a%20b.pdf`, 'signed-waivers'), 'a b.pdf');
  eq('unit: a query string is not part of the path', storagePathFromReference(`${host}/public/signed-waivers/a.pdf?download=1`, 'signed-waivers'), 'a.pdf');
  for (const [what, ref] of [
    ['another bucket', `${host}/public/lot-pictures/a.jpg`], ['a URL that is not a storage object', 'https://evil.example/a.pdf'], ['an http page', 'http://evil.example/storage/v1/object/public/x/a'],
    ['a non-Supabase host with a Storage-looking path', 'https://evil.example.com/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a non-Supabase host with a Supabase-looking path in the query', 'https://evil.example.com/a.pdf?x=/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a non-Supabase host with a Supabase-looking fragment', 'https://evil.example.com/a.pdf#/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a Supabase name used as a subdomain of another site', 'https://srxunxiytojjsuhcmzjg.supabase.co.evil.example/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a Supabase host used as userinfo of another site', 'https://srxunxiytojjsuhcmzjg.supabase.co@evil.example/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a look-alike Supabase domain', 'https://srxunxiytojjsuhcmzjg.supabase.com/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a Supabase host with a short ref', 'https://abc.supabase.co/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a plain http Supabase URL', 'http://srxunxiytojjsuhcmzjg.supabase.co/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a Supabase host on another port', 'https://srxunxiytojjsuhcmzjg.supabase.co:8443/storage/v1/object/public/signed-waivers/x.pdf'],
    ['a Supabase REST API URL', 'https://srxunxiytojjsuhcmzjg.supabase.co/rest/v1/orders?select=signed-waivers/x.pdf'],
    ['a malformed URL', 'https://srxunxiytojjsuhcmzjg.supabase.co:bad/storage/v1/object/public/signed-waivers/x.pdf'],
    ['an encoded dot-segment traversal on a Supabase host', 'https://srxunxiytojjsuhcmzjg.supabase.co/storage/v1/object/public/signed-waivers/%2e%2e/lot-pictures/x.jpg'],
    ['an encoded traversal inside the object path', 'https://srxunxiytojjsuhcmzjg.supabase.co/storage/v1/object/public/signed-waivers/a/%2E%2E/b.pdf'],
    ['a javascript URL', 'javascript:alert(1)'], ['a file URL', 'file:///storage/v1/object/public/signed-waivers/x.pdf'],
    ['path traversal', 'a/../../b.pdf'], ['a leading parent path', '../b.pdf'], ['a dot segment', 'a/./b.pdf'], ['an absolute path', '/a.pdf'], ['an empty segment', 'a//b.pdf'],
    ['a trailing slash', 'a/'], ['a backslash', 'a\\b.pdf'], ['a control character', 'a\u0000b.pdf'], ['an encoded traversal', `${host}/public/signed-waivers/..%2Fa.pdf`],
    ['an empty string', ''], ['whitespace', '   '], ['null', null], ['a number', 42], ['an object', {}], ['an over-long reference', 'a'.repeat(3000)], ['a bad percent escape', `${host}/public/signed-waivers/%E0%A4%A.pdf`],
  ] as Array<[string, unknown]>) {
    eq(`unit: ${what} is rejected`, storagePathFromReference(ref, 'signed-waivers'), null);
  }
  const calls: string[] = [];
  const fake = { storage: { from: (b: string) => ({ createSignedUrl: async (p: string, ttl: number) => { calls.push(`${b}:${p}:${ttl}`); return { data: { signedUrl: `https://s/${b}/${p}` }, error: null }; } }) } };
  eq('unit: signing returns a signed URL for a stored public URL', await signStoredMedia(fake, 'signed-waivers', `${host}/public/signed-waivers/w.pdf`), 'https://s/signed-waivers/w.pdf');
  eq('unit: the signed URL lifetime is one hour', calls[0], 'signed-waivers:w.pdf:3600');
  eq('unit: signing refuses another bucket\'s reference (no signature is requested)', await signStoredMedia(fake, 'signed-waivers', `${host}/public/lot-pictures/w.jpg`), null);
  eq('unit: no signing request was made for the refused reference', calls.length, 1);
  eq('unit: a storage error yields null, never a public URL', await signStoredMedia({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) } }, 'signatures', 'a.png'), null);
  eq('unit: a thrown storage error yields null', await signStoredMedia({ storage: { from: () => ({ createSignedUrl: async () => { throw new Error('boom'); } }) } }, 'signatures', 'a.png'), null);
}

// ---------------------------------------------------------------------------------------------------------------
// HANDLER: get-waiver-status
// ---------------------------------------------------------------------------------------------------------------
{
  const PUB = 'https://srxunxiytojjsuhcmzjg.supabase.co/storage/v1/object/public';
  const SIG_PUBLIC = `${PUB}/signatures/order-A-1.png`;
  const PDF_PUBLIC = `${PUB}/signed-waivers/waiver-order-A-1.pdf`;
  const mk = () => {
    const h = makeHarness();
    addOrder(h.db, { id: 'order-A', customer: 'cust-A', status: 'confirmed' });
    addOrder(h.db, { id: 'order-B', customer: 'cust-B', status: 'confirmed' });
    h.db.tables.order_signatures.push(
      { order_id: 'order-A', signed_at: '2026-10-01T00:00:00Z', signer_name: 'Ann Adams', waiver_version: 'v1', initials_data: { a: 'AA' }, signature_image_url: SIG_PUBLIC, pdf_url: PDF_PUBLIC, electronic_consent_given: true },
      { order_id: 'order-B', signed_at: '2026-10-01T00:00:00Z', signer_name: 'Bo Burns', waiver_version: 'v1', initials_data: {}, signature_image_url: 'order-B-1.png', pdf_url: 'waiver-order-B-1.pdf', electronic_consent_given: true },
    );
    return h;
  };
  const call = async (bearer: string | null, body: unknown, h = mk()) => ({ h, r: await callFunction(loadFunction('get-waiver-status', h), bearer, body) });
  const signedOf = (h: any) => [...h.db.storageSigned].sort();
  const PORTAL_A = tokenFor('p-order-A');

  {
    const { h, r } = await call(PORTAL_A, { orderId: 'order-A', token: PORTAL_A });
    eq('handler: a valid portal token for the order receives signed URLs (status)', r.status, 200);
    ok('handler: the signature image is a signed URL for the signatures bucket', /\/object\/sign\/signatures\/order-A-1\.png\?/.test(r.json?.data?.signature_image_url ?? ''));
    ok('handler: the PDF is a signed URL for the signed-waivers bucket, extracted from the historical public URL', /\/object\/sign\/signed-waivers\/waiver-order-A-1\.pdf\?/.test(r.json?.data?.pdf_url ?? ''));
    ok('handler: the signed URLs are short-lived (3600 s)', /ttl=3600/.test(r.json?.data?.pdf_url ?? '') && /ttl=3600/.test(r.json?.data?.signature_image_url ?? ''));
    ok('handler: the response never contains a stored public URL', !/object\/public/.test(r.text));
    eq('handler: exactly those two objects were signed', signedOf(h), ['signatures:order-A-1.png', 'signed-waivers:waiver-order-A-1.pdf']);
    ok('handler: the response says a PDF and signature exist', r.json?.data?.has_pdf === true && r.json?.data?.has_signature_image === true);
  }
  {
    const { h, r } = await call(ANON_KEY, { orderId: 'order-A' });
    eq('handler: the public anon key and an order id alone receive the fail-closed answer', r.json, { signed: false, data: null });
    ok('handler: ... no signature request was made and no public URL leaked', h.db.storageSigned.length === 0 && !/object\/public/.test(r.text));
    ok('handler: the unauthorized response does not even report that a PDF exists', !/has_pdf|has_signature|signer_name/.test(r.text));
  }
  {
    const { r } = await call(null, { orderId: 'order-A' });
    eq('handler: no credentials at all receive the fail-closed answer', r.json, { signed: false, data: null });
  }
  for (const [label, token] of [['an expired portal token', tokenFor('e-order-A')], ['a revoked portal token', tokenFor('r-order-A')], ['a token for another order', tokenFor('p-order-B')], ['a made-up token', 'z'.repeat(64)]] as Array<[string, string]>) {
    const { h, r } = await call(ANON_KEY, { orderId: 'order-A', token });
    ok(`handler: ${label} receives no data and no URL`, r.json?.data === null && r.json?.signed === false && h.db.storageSigned.length === 0);
  }
  {
    const { r } = await call('jwt-A', { orderId: 'order-A' });
    ok('handler: the signed-in customer who owns the order receives signed URLs', /\/object\/sign\/signed-waivers\//.test(r.json?.data?.pdf_url ?? '') && /\/object\/sign\/signatures\//.test(r.json?.data?.signature_image_url ?? ''));
  }
  {
    const { h, r } = await call('jwt-B', { orderId: 'order-A' });
    ok('handler: another signed-in customer receives no data and no URL for this order', r.json?.data === null && h.db.storageSigned.length === 0);
  }
  {
    const { h, r } = await call('jwt-none', { orderId: 'order-A' });
    ok('handler: a signed-in user with no customer record receives no data and no URL', r.json?.data === null && h.db.storageSigned.length === 0);
  }
  {
    const { r } = await call('jwt-A', { orderId: 'order-B' });
    ok('handler: a customer cannot obtain another order\'s URL by naming its order id', r.json?.data === null);
  }
  for (const jwt of ['jwt-admin', 'jwt-master', 'jwt-crew']) {
    const { r } = await call(jwt, { orderId: 'order-A' });
    ok(`handler: ${jwt.slice(4)} receives signed URLs`, /\/object\/sign\/signed-waivers\//.test(r.json?.data?.pdf_url ?? ''));
  }
  {
    const { r } = await call(SERVICE_KEY, { orderId: 'order-A' });
    ok('handler: the service role receives signed URLs', /\/object\/sign\/signed-waivers\//.test(r.json?.data?.pdf_url ?? ''));
  }
  {
    const { r } = await call('jwt-B', { orderId: 'order-B' });
    ok('handler: a bare stored object path (new rows) is signed as well', /\/object\/sign\/signed-waivers\/waiver-order-B-1\.pdf\?/.test(r.json?.data?.pdf_url ?? '') && /\/object\/sign\/signatures\/order-B-1\.png\?/.test(r.json?.data?.signature_image_url ?? ''));
  }
  {
    const h = mk();
    h.db.tables.order_signatures[0].pdf_url = `${PUB}/lot-pictures/someone-elses.jpg`;
    h.db.tables.order_signatures[0].signature_image_url = 'https://evil.example/x.png';
    const { r } = await call('jwt-A', { orderId: 'order-A' }, h);
    ok('handler: a stored reference that is not an object of the expected bucket is never signed', r.json?.data?.pdf_url === null && r.json?.data?.signature_image_url === null && h.db.storageSigned.length === 0);
  }
  {
    const h = mk();
    h.db.tables.order_signatures[0] = { order_id: 'order-A', signed_at: '2026-10-01T00:00:00Z', signer_name: 'Ann Adams', waiver_version: 'paper', initials_data: {}, signature_image_url: '', pdf_url: null, electronic_consent_given: false, physical_waiver_storage_path: 'order-A/paper.pdf', physical_waiver_file_type: 'application/pdf' };
    const own = await call('jwt-A', { orderId: 'order-A' }, h);
    ok('handler: the owner receives the paper waiver link from the private physical-waivers bucket', /\/object\/sign\/physical-waivers\/order-A\/paper\.pdf\?/.test(own.r.json?.data?.physical_waiver?.signed_url ?? ''));
    const anon = await call(ANON_KEY, { orderId: 'order-A' }, mk());
    ok('handler: the anonymous caller never receives a paper waiver link', anon.r.json?.data === null && !/physical-waivers/.test(anon.r.text));
  }
  {
    const { r } = await call(PORTAL_A, { orderId: 'does-not-exist', token: PORTAL_A });
    eq('handler: an unknown order reports not signed', r.json, { signed: false, data: null });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// SOURCE
// ---------------------------------------------------------------------------------------------------------------
{
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = dir + '/' + e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f, out); }
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(f);
    }
    return out;
  };
  const code = [...walk('src'), ...walk('supabase/functions')].filter((f) => !/\.test\.|Scenarios\.ts|database\.types\.ts|portalTestHarness/.test(f));
  const storageCalls: Array<{ file: string; bucket: string; op: string }> = [];
  for (const f of code) {
    const t = read(f);
    for (const m of t.matchAll(/\.storage\s*\.from\(\s*([^)]+?)\s*\)\s*\.(\w+)\(/g)) storageCalls.push({ file: f, bucket: m[1].replace(/['"`\s]/g, ''), op: m[2] });
  }
  const forBucket = (b: string) => storageCalls.filter((c) => c.bucket === b);
  for (const b of PRIVATE_BUCKETS) {
    ok(`source: nothing builds a permanent public URL for the private bucket ${b}`, forBucket(b).every((c) => c.op !== 'getPublicUrl'));
  }
  ok('source: signed-waivers is written only by generate-signed-waiver and read only by save-signature (service role)', JSON.stringify(forBucket('signed-waivers').map((c) => `${c.file}:${c.op}`).sort()) === JSON.stringify(['supabase/functions/generate-signed-waiver/index.ts:upload', 'supabase/functions/save-signature/index.ts:download']));
  ok('source: signatures is written by save-signature and read by generate-signed-waiver (both service role)', JSON.stringify(forBucket('signatures').map((c) => `${c.file}:${c.op}`).sort()) === JSON.stringify(['supabase/functions/generate-signed-waiver/index.ts:download', 'supabase/functions/save-signature/index.ts:upload']));
  ok('source: physical-waivers is touched only by upload-physical-waiver (write) and get-waiver-status (signed URL)', JSON.stringify(forBucket('physical-waivers').map((c) => `${c.file}:${c.op}`).sort()) === JSON.stringify(['supabase/functions/get-waiver-status/index.ts:createSignedUrl', 'supabase/functions/upload-physical-waiver/index.ts:upload']));
  ok('source: no browser code touches a private bucket', storageCalls.filter((c) => c.file.startsWith('src/') && PRIVATE_BUCKETS.includes(c.bucket)).length === 0);
  const privateCallers = ['generate-signed-waiver', 'save-signature', 'upload-physical-waiver', 'get-waiver-status'];
  ok('source: every Edge Function that touches a private bucket does so with a service-role client', privateCallers.every((fn) => { const t = read(`supabase/functions/${fn}/index.ts`); return /SUPABASE_SERVICE_ROLE_KEY/.test(t) && !/SUPABASE_ANON_KEY[\s\S]{0,80}\.storage/.test(t); }));
  ok('source: the signed waiver and signature are read through the storage API, not a fetch of a stored URL', !/fetch\(signature\.signature_image_url\)/.test(read('supabase/functions/generate-signed-waiver/index.ts')) && /storagePathFromReference\(signature\.signature_image_url, "signatures"\)/.test(read('supabase/functions/generate-signed-waiver/index.ts')));
  const gen = read('supabase/functions/generate-signed-waiver/index.ts');
  ok('source: new rows store the object path, not a public URL', /const pdfPath = pdfUpload\.path;/.test(gen) && /pdf_url: pdfPath/.test(gen) && /signed_waiver_url: pdfPath/.test(gen) && !/getPublicUrl/.test(gen));
  const sig = read('supabase/functions/save-signature/index.ts');
  ok('source: save-signature stores the signature object path and does not emit a permanent PDF link', /const signatureImageUrl = uploadData\.path;/.test(sig) && !/getPublicUrl\(uploadData/.test(sig) && !/href="\$\{pdfUrl\}"/.test(sig) && /buildPortalUrl\(supabaseClient, orderId/.test(sig));
  ok('source: the confirmation email attaches the PDF read from the private bucket', /storage\.from\("signed-waivers"\)\.download\(pdfPath\)/.test(sig));
  const gws = read('supabase/functions/get-waiver-status/index.ts');
  ok('source: get-waiver-status authorizes with the shared portal / owner / staff proof and the service role only', /authorizePortalOrder\(supabaseClient, \{ orderId, token, caller, allowStaffRead: true \}\)/.test(gws) && /resolveCaller\(supabaseClient/.test(gws) && !/link_token", token/.test(gws));
  ok('source: get-waiver-status never returns a stored URL', /signature_image_url: signatureImageUrl,/.test(gws) && /pdf_url: pdfUrl,/.test(gws) && /signStoredMedia\(supabaseClient, "signatures"/.test(gws) && /signStoredMedia\(supabaseClient, "signed-waivers"/.test(gws));
  const card = read('src/components/dashboard/OrderCard.tsx');
  ok('source: the customer dashboard opens the waiver through a server-signed link, not the stored URL', /fetchSignedWaiverPdfUrl\(order\.id\)/.test(card) && !/window\.open\(order\.signed_waiver_url/.test(card));
  const access = read('src/lib/documents/waiverAccess.ts');
  ok('source: the browser helper sends the customer\'s own session token and only the order id', /session\.access_token/.test(access) && /JSON\.stringify\(\{ orderId \}\)/.test(access) && !/ANON_KEY/.test(access.slice(access.indexOf('export async function fetchSignedWaiverPdfUrl'))));
  ok('source: the portal waiver tab still receives its signed URLs from get-waiver-status (token holder)', /get-waiver-status/.test(read('src/components/waiver/WaiverTab.tsx')) && /signatureData\.pdf_url/.test(read('src/components/waiver/WaiverTab.tsx')));

  // Remaining permanent public URL usage, classified.
  const publicUrlUsers = storageCalls.filter((c) => c.op === 'getPublicUrl').map((c) => c.bucket);
  const allowedPublic = new Set(['carousel-media', 'event-essentials-media', 'unit-images', 'public-assets', 'lot-pictures', 'order-pictures', 'BUCKET', 'bucket', 'sourceBucket']);
  ok('source: every remaining getPublicUrl is for a reviewed public bucket (marketing media, or the documented residual buckets)', publicUrlUsers.every((b) => allowedPublic.has(b)));
  const delivery = read('src/components/admin/tasks/detail/taskPhotoUpload.ts');
  ok('source: delivery / damage photos are no longer uploaded to public-assets (private evidence bucket, see the order evidence suite)', !/public-assets/.test(delivery) && /uploadToSignedUrl/.test(delivery));
  const removers = storageCalls.filter((c) => c.op === 'remove').map((c) => `${c.file}:${c.bucket}`);
  ok('source: every browser storage delete targets a reviewed bucket (marketing media, or the portal\'s own failed-upload cleanup)', removers.filter((r) => r.startsWith('src/')).every((r) => /carousel-media|event-essentials-media|BUCKET|lot-pictures/.test(r)));
  ok('source: the portal deletes registered lot pictures through the service-role action, with an order-ownership check', /db\.storage\.from\("lot-pictures"\)\.remove\(\[picture\.file_path\]\)/.test(read('supabase/functions/customer-portal-action/index.ts')));
}

// ---------------------------------------------------------------------------------------------------------------
// EXECUTED
// ---------------------------------------------------------------------------------------------------------------
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
    const scenarios = buildMediaScenarios();
    const r = spawnSync(psql, [...args, '-v', 'ON_ERROR_STOP=1'], { input: buildMediaScript(scenarios, raw), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
    const results: Record<number, string> = {};
    for (const m of ((r.stderr ?? '') + (r.stdout ?? '')).matchAll(/R\|(\d+)\|(.*)/g)) results[Number(m[1])] = m[2].trim();
    ok(`executed: the scenario script ran to completion in database "${db}" (${Object.keys(results).length}/${scenarios.length} results)`, Object.keys(results).length === scenarios.length);
    if (Object.keys(results).length !== scenarios.length) console.error((r.stderr ?? '').split('\n').filter((l: string) => /ERROR|LINE|DETAIL/.test(l)).slice(0, 6).join('\n'));
    scenarios.forEach((sc, i) => {
      const got = results[i];
      const good = typeof sc.expect === 'string' ? got === sc.expect : sc.expect(got);
      ok(`executed: ${sc.name} (got ${got})`, good);
    });
  }
}
  void MARKETING_BUCKETS;

  console.log(`Private media access tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} private media access test(s) failed`);
})();
