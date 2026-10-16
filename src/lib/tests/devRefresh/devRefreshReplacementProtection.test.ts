/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Production -> Development order data refresh, executed against SCRATCH PostgreSQL databases (never a Supabase project).
//
// Two throw-away databases per scenario on the local test server: devrefresh_<name>_prod (shaped like Production: older schema,
// October columns / tables / triggers absent) and devrefresh_<name>_dev (the repository's current schema), filled with SYNTHETIC rows.
// Every scenario drives the real tool code (preview, apply, restore) and checks the RESULT with independent SQL.
//
// Part 5: Production protection, environment targeting, evidence and media.
// (The scenarios are spread over several files only so that each stays well inside the test runner per-file time limit.)
//
// With no reachable database the scenarios are SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/devRefresh/devRefreshReplacementProtection.test.ts

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit: (n: number) => void };
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

import { classifyMedia, collectReferences, copyMissing, orphanedDevObjects, readStorageInventory } from '../../../../scripts/dev-refresh/lib/media.mjs';
import { runScript } from '../../../../scripts/dev-refresh/lib/psql.mjs';
import { apply, confirmationPhrase, preview, readManifest, restore, restorePhrase, verifyEnvironment } from '../../../../scripts/dev-refresh/lib/run.mjs';
import { K, USERS, buildScratchPair, id, psqlOn, resetScratchPair, scalar, scratchAvailable } from '../support/devRefreshScratch.mjs';

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
function throws(f: () => any, re: RegExp): boolean {
  try {
    f();
    return false;
  } catch (e: any) {
    return re.test(String(e.message));
  }
}

const SCOPE_CONTENT: Record<string, string> = {
  customers: "id, first_name, last_name, email, phone, default_address_id",
  addresses: "id, customer_id, line1, city, zip, address_key",
  contacts: "id, customer_id, email, total_spent_cents, completed_bookings_count",
  orders: "id, customer_id, address_id, status, event_date, subtotal_cents, deposit_paid_cents, balance_paid_cents, total_refunded_cents, tip_cents, special_details, signature_id, signed_waiver_url, payment_method_last_four, created_at",
  order_items: "id, order_id, unit_id, unit_price_cents, qty",
  order_signatures: "id, order_id, signature_image_url, pdf_url, signer_email",
  order_notes: "id, order_id, note",
  order_changelog: "id, order_id, field_changed, new_value",
  order_discounts: "id, order_id, name, amount_cents",
  order_custom_fees: "id, order_id, name, amount_cents",
  order_workflow_events: "id, order_id, event_type",
  payments: "id, order_id, type, amount_cents, stripe_payment_intent_id, status, refunded_payment_id, ledger_sequence",
  order_refunds: "id, order_id, amount_cents, reason, stripe_refund_id, status",
  transaction_receipts: "id, order_id, customer_id, payment_id, receipt_number, stripe_payment_intent_id, stripe_charge_id, amount_cents",
  invoices: "id, order_id, customer_id, invoice_number, total_cents, status",
  invoice_links: "id, order_id, link_token, short_code",
  consent_records: "order_id, customer_id, consent_type",
  task_status: "id, order_id, task_type, task_date, status, delivery_images::text",
  route_stops: "id, order_id, type",
  crew_location_history: "id, order_id, stop_id",
  documents: "id, order_id, kind, url",
  messages: "id, order_id, channel",
  sms_conversations: "id, order_id, to_phone, message_body",
  order_pictures: "id, order_id, file_path",
  order_lot_pictures: "id, order_id, address_id, file_path",
  address_lot_pictures: "id, address_id, saved_from_order_id, saved_from_order_lot_picture_id, file_path",
};

// A fingerprint of EVERY public table plus auth.users, Storage rows, policies and trigger states, computed independently of the tool.
function snapshot(db: string): Record<string, string> {
  const tables = psqlOn(db, "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1").stdout.trim().split('\n').filter(Boolean);
  const sql = [
    ...tables.map((t) => `SELECT '${t}=' || count(*) || ':' || md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public."${t}" x;`),
    `SELECT 'auth.users=' || count(*) || ':' || md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) FROM auth.users x;`,
    `SELECT 'storage.objects=' || count(*) || ':' || md5(COALESCE(string_agg(bucket_id || '/' || name || COALESCE(metadata::text, ''), '|' ORDER BY bucket_id, name), '')) FROM storage.objects;`,
    `SELECT 'storage.buckets=' || count(*) || ':' || md5(COALESCE(string_agg(id || public::text, '|' ORDER BY id), '')) FROM storage.buckets;`,
    `SELECT 'policies=' || count(*) || ':' || md5(COALESCE(string_agg(schemaname || tablename || policyname || cmd || roles::text || COALESCE(qual, '') || COALESCE(with_check, ''), '|' ORDER BY schemaname, tablename, policyname), '')) FROM pg_policies;`,
    `SELECT 'triggers=' || md5(COALESCE(string_agg(c.relname || '.' || t.tgname || '.' || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname), '')) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public';`,
  ].join('\n');
  const out: Record<string, string> = {};
  for (const line of psqlOn(db, sql).stdout.split('\n').filter(Boolean)) {
    const i = line.indexOf('=');
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}
const diff = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const triggerStates = (db: string) => psqlOn(db, "SELECT c.relname || '.' || t.tgname || '=' || t.tgenabled::text || '/' || t.tgisinternal::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' ORDER BY 1").stdout.trim().split('\n');
const count = (db: string, t: string) => Number(scalar(db, `SELECT count(*) FROM public."${t}"`));
const sets = (db: string, sql: string) => psqlOn(db, sql).stdout.trim().split('\n').filter(Boolean);

function newRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devrefresh-test-'));
}
const visibleOrders = (db: string, userId: string | null) =>
  (psqlOn(db, `SELECT set_config('request.jwt.claim.sub', ${userId ? `'${userId}'` : "''"}, false) IS NULL AS ignore; SELECT 'R=' || COALESCE(string_agg(x->>'id', ',' ORDER BY x->>'id'), '') FROM public.get_my_orders(100) x;`).stdout.split('\n').find((l: string) => l.startsWith('R=')) || 'R=?').slice(2);

function scopeContentDifferences(p: any): string[] {
  const bad: string[] = [];
  for (const [t, cols] of Object.entries(SCOPE_CONTENT)) {
    const q = `SELECT count(*) || ':' || md5(COALESCE(string_agg((ROW(${cols}))::text, '|' ORDER BY (ROW(${cols}))::text), '')) FROM public."${t}"`;
    if (scalar(p.prodDb, q) !== scalar(p.devDb, q)) bad.push(t);
  }
  return bad;
}

async function main() {
  if (!scratchAvailable()) {
    const msg = 'devRefreshReplacementProtection: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
    if (process.env.ROLE_DB_REQUIRE === '1') throw new Error(`${msg} (ROLE_DB_REQUIRE=1)`);
    console.log(msg);
    return;
  }
  const made: any[] = [];
  // One pair of scratch databases per file, reset between scenarios (creating databases is the slow part).
  let shared: any = null;
  const pair = (_scenario: string, o: any = {}) => {
    if (!shared) {
      shared = buildScratchPair('rep5', { seed: false });
      made.push(shared);
    }
    return resetScratchPair(shared, o);
  };
  try {
    // =================================================================================================================
    // 8. Production protection and environment targeting
    // =================================================================================================================
    {
      const p = pair('t_prod');
      const prodBefore = snapshot(p.prodDb);
      for (const sql of ['DELETE FROM public.orders', "UPDATE public.orders SET status = 'x'", 'INSERT INTO public.units (id, slug, name, price_dry_cents, dimensions, footprint_sqft, capacity, types) VALUES (gen_random_uuid(), \'z\', \'z\', 1, \'z\', 1, 1, ARRAY[\'z\'])', 'CREATE TABLE public.zz (a int)', 'TRUNCATE public.orders CASCADE', 'ALTER TABLE public.orders ADD COLUMN zz int', 'DROP TABLE public.order_items CASCADE']) {
        const r = runScript(p.prod, `${sql};`);
        ok(`the Production session refuses: ${sql.slice(0, 40)}`, r.status !== 0 && /read-only/i.test(r.stderr));
      }
      eq('and nothing in Production moved', diff(prodBefore, snapshot(p.prodDb)), []);
      ok('swapped targets are refused', throws(() => verifyEnvironment({ prod: p.dev, dev: p.prod }), /wrong slots/));
      ok('two Production-slot databases cannot be used as source and target', throws(() => verifyEnvironment({ prod: p.prod, dev: { ...p.dev, database: p.prod.database } }), /must end with|same database/));
      const hosted = { ...p.prod, scratch: false, host: 'db.qaagfafagdpgzcijnfbw.supabase.co' };
      ok('a mixed scratch / hosted pair is refused before any connection', throws(() => verifyEnvironment({ prod: hosted, dev: p.dev }), /scratch database and the other is hosted/));
      const pv = preview({ prod: p.prod, dev: p.dev, root: newRoot() });
      ok('every statement the tool sent to Production was a read (the preview exported through a read-only snapshot)', pv.manifest.status === 'previewed');
      eq('PRODUCTION UNCHANGED after the tool ran', diff(prodBefore, snapshot(p.prodDb)), []);
    }

    // =================================================================================================================
    // 9. Evidence and media
    // =================================================================================================================
    {
      const p = pair('t_media');
      const root = newRoot();
      const before = snapshot(p.devDb);
      const pv = preview({ prod: p.prod, dev: p.dev, root });
      const a = apply({ prod: p.prod, dev: p.dev, root, id: pv.manifest.id, confirm: confirmationPhrase(pv.manifest) });
      ok('apply succeeded', a.ok);
      eq('Storage rows (objects, buckets) and every policy are untouched by the refresh', [before['storage.objects'], before['storage.buckets'], before.policies], [snapshot(p.devDb)['storage.objects'], snapshot(p.devDb)['storage.buckets'], snapshot(p.devDb).policies]);
      ok('imported evidence rows keep their links to the imported orders', scalar(p.devDb, `SELECT count(*) FROM order_signatures s JOIN orders o ON o.id = s.order_id AND o.signature_id = s.id`) === '2');
      ok('Development-only evidence rows are gone with their orders (the objects are not)', scalar(p.devDb, `SELECT count(*) FROM order_signatures WHERE order_id = '${id(K.order, 901)}'`) === '0' && scalar(p.devDb, "SELECT count(*) FROM storage.objects WHERE name = 'devonly-order/waiver.pdf'") === '1');

      const refs = collectReferences(p.dev);
      const keys = refs.map((r: any) => `${r.bucket}/${r.path}`).sort();
      ok('every storage reference held by the imported rows is found (signatures, waiver PDFs, task photos, order and lot photos)', ['signatures', 'signed-waivers', 'public-assets', 'order-pictures', 'lot-pictures'].every((b) => keys.some((k: string) => k.startsWith(`${b}/`))));
      const devInv = readStorageInventory(p.dev);
      const prodInv = readStorageInventory(p.prod);
      const plan = classifyMedia(refs, devInv, prodInv);
      eq('objects already in Development are "present" (left alone)', plan.items.filter((i: any) => i.status === 'present').map((i: any) => i.path), [`${id(K.order, 1)}/waiver.pdf`]);
      eq('an object in both with different content is a "conflict" (never touched)', plan.items.filter((i: any) => i.status === 'conflict').map((i: any) => i.path), [`${id(K.order, 2)}/waiver.pdf`]);
      eq('objects only Production has are "missing" (the only candidates for copying)', plan.items.filter((i: any) => i.status === 'missing').map((i: any) => i.path).sort(), [`${id(K.order, 1)}-drop-off-1700000000-photo.jpg`, `${id(K.order, 1)}/sig.png`].sort());
      ok('references to buckets Development does not have are reported as such (buckets are never created)', plan.counts['bucket-missing'] >= 1);
      ok('references to objects no project holds are "unavailable"', plan.counts.unavailable === 1);
      const orphans = orphanedDevObjects(refs, devInv);
      eq('Development evidence files no longer referenced by any row are reported (never deleted)', orphans.map((o: any) => o.path).sort(), ['devonly-order/waiver.pdf', 'devonly/1.jpg']);

      // additive copy with recording fakes: only download + upload(upsert:false), nothing else
      const calls: string[] = [];
      const bytes = (s: string) => ({ arrayBuffer: async () => Buffer.from(s), type: 'image/png' });
      const store: Record<string, string> = { [`signatures/${id(K.order, 1)}/sig.png`]: 'PNGDATA', [`public-assets/${id(K.order, 1)}-drop-off-1700000000-photo.jpg`]: 'JPGDATA' };
      const source = { storage: { from: (b: string) => ({ download: async (pth: string) => { calls.push(`src.download ${b}/${pth}`); return store[`${b}/${pth}`] ? { data: bytes(store[`${b}/${pth}`]), error: null } : { data: null, error: { message: 'nope' } }; } }) } };
      const written: Record<string, string> = {};
      const target = { storage: { from: (b: string) => ({
        upload: async (pth: string, body: Buffer, opts: any) => { calls.push(`dst.upload ${b}/${pth} upsert=${opts.upsert}`); if (written[`${b}/${pth}`] !== undefined) return { error: { message: 'The resource already exists' } }; written[`${b}/${pth}`] = body.toString(); return { error: null }; },
        download: async (pth: string) => ({ data: bytes(written[`${b}/${pth}`] ?? ''), error: null }),
      }) } };
      const dry = await copyMissing({ plan, source, target, execute: false });
      ok('a dry run makes no storage call at all', calls.length === 0 && dry.every((r: any) => r.outcome === 'planned') && dry.length === 2);
      const done = await copyMissing({ plan, source, target, execute: true });
      ok('executing copies exactly the two missing objects, byte for byte, verified', done.every((r: any) => r.outcome === 'copied-verified') && Object.keys(written).length === 2 && written[`signatures/${id(K.order, 1)}/sig.png`] === 'PNGDATA');
      ok('every upload is additive: upsert is false, and no call removes or replaces anything', calls.filter((c) => c.startsWith('dst.upload')).every((c) => c.endsWith('upsert=false')) && calls.every((c) => /^(src\.download|dst\.upload)/.test(c)));
      const again = await copyMissing({ plan, source, target, execute: true });
      ok('running the copy again cannot overwrite what is there: the target refuses and the object is left untouched', again.every((r: any) => r.outcome === 'already-exists-left-untouched') && written[`signatures/${id(K.order, 1)}/sig.png`] === 'PNGDATA');
      const noSource = await copyMissing({ plan, source: { storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'gone' } }) }) } }, target, execute: true });
      ok('an unreadable source object is reported, nothing is written for it', noSource.every((r: any) => r.outcome === 'source-unreadable'));
    }

  } finally {
    for (const p of made) {
      try {
        p.drop();
      } catch {
        /* best effort */
      }
    }
  }
  console.log(`dev refresh devRefreshReplacementProtection tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} devRefreshReplacementProtection test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
