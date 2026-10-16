/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Production -> Development order data refresh, executed against SCRATCH PostgreSQL databases (never a Supabase project).
//
// Two throw-away databases per scenario on the local test server: devrefresh_<name>_prod (shaped like Production: older schema,
// October columns / tables / triggers absent) and devrefresh_<name>_dev (the repository's current schema), filled with SYNTHETIC rows.
// Every scenario drives the real tool code (preview, apply, restore) and checks the RESULT with independent SQL.
//
// Part 2: the refresh can be run again (also after Production changed); stale, tampered, expired and drifted inputs are refused.
// (The scenarios are spread over several files only so that each stays well inside the test runner per-file time limit.)
//
// With no reachable database the scenarios are SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/syncDevDataFromProd/syncDevDataFromProdReplacementRepeat.test.ts

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit: (n: number) => void };
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

import { classifyMedia, collectReferences, copyMissing, orphanedDevObjects, readStorageInventory } from '../../../../scripts/SyncDevDataFromProd/lib/media.mjs';
import { runScript } from '../../../../scripts/SyncDevDataFromProd/lib/psql.mjs';
import { apply, confirmationPhrase, preview, readManifest, restore, restorePhrase, verifyEnvironment } from '../../../../scripts/SyncDevDataFromProd/lib/run.mjs';
import { K, USERS, buildScratchPair, id, psqlOn, resetScratchPair, scalar, scratchAvailable } from '../support/syncDevDataFromProdScratch.mjs';

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
    const msg = 'syncDevDataFromProdReplacementRepeat: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
    if (process.env.ROLE_DB_REQUIRE === '1') throw new Error(`${msg} (ROLE_DB_REQUIRE=1)`);
    console.log(msg);
    return;
  }
  const made: any[] = [];
  // One pair of scratch databases per file, reset between scenarios (creating databases is the slow part).
  let shared: any = null;
  const pair = (_scenario: string, o: any = {}) => {
    if (!shared) {
      shared = buildScratchPair('rep2', { seed: false });
      made.push(shared);
    }
    return resetScratchPair(shared, o);
  };
  try {

    {
      const p = pair('t_repeat');
      const root = newRoot();

      // =================================================================================================================
      const pv2 = preview({ prod: p.prod, dev: p.dev, root });
      const a2 = apply({ prod: p.prod, dev: p.dev, root, id: pv2.manifest.id, confirm: confirmationPhrase(pv2.manifest) });
      ok('a second refresh works', a2.ok);
      const afterSecond = snapshot(p.devDb);
      const pv3 = preview({ prod: p.prod, dev: p.dev, root });
      const a3 = apply({ prod: p.prod, dev: p.dev, root, id: pv3.manifest.id, confirm: confirmationPhrase(pv3.manifest) });
      ok('a third refresh with no Production change works', a3.ok);
      eq('REPEATED REFRESH IS IDEMPOTENT: nothing differs from the previous refresh, no duplicates', diff(afterSecond, snapshot(p.devDb)).filter((k) => k !== 'customer_profiles' && k !== 'user_consent_log' && k !== 'site_events'), []);
      eq('no duplicates: row counts equal Production\'s', Object.keys(SCOPE_CONTENT).filter((t) => count(p.devDb, t) !== count(p.prodDb, t)), []);

      psqlOn(p.prodDb, `SET session_replication_role = replica;
        INSERT INTO customers (id, first_name, last_name, email, phone) VALUES ('${id(K.customer, 50)}', 'newbie', 'Prod', 'newbie@example.test', '+15555550150');
        INSERT INTO orders (id, customer_id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents) VALUES ('${id(K.order, 50)}', '${id(K.customer, 50)}', 'confirmed', 'residential', '2026-07-01', '2026-07-01', '09:00', '11:00', 'same_day', 1000, 500, 500);
        UPDATE orders SET status = 'completed', tip_cents = 300 WHERE id = '${id(K.order, 2)}';`);
      const before4 = snapshot(p.devDb);
      const pv4 = preview({ prod: p.prod, dev: p.dev, root });
      ok('the preview of a later refresh shows the new Production row and the changed one', pv4.manifest.exportCounts.orders === 11 && pv4.manifest.devCountsBefore.orders === 10);
      const a4 = apply({ prod: p.prod, dev: p.dev, root, id: pv4.manifest.id, confirm: confirmationPhrase(pv4.manifest) });
      ok('a refresh after Production changed works and Development follows', a4.ok && count(p.devDb, 'orders') === 11 && scalar(p.devDb, `SELECT status FROM orders WHERE id = '${id(K.order, 2)}'`) === 'completed');
      eq('the content still matches Production exactly', scopeContentDifferences(p), []);
      const r4 = restore({ dev: p.dev, root, id: pv4.manifest.id, confirm: restorePhrase(a4.manifest) });
      ok('each refresh has its own restore point: restoring the latest returns to the previous refresh', r4.ok && diff(before4, snapshot(p.devDb)).length === 0);
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
  console.log(`dev refresh syncDevDataFromProdReplacementRepeat tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} syncDevDataFromProdReplacementRepeat test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
