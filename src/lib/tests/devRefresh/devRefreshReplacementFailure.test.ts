/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Production -> Development order data refresh, executed against SCRATCH PostgreSQL databases (never a Supabase project).
//
// Two throw-away databases per scenario on the local test server: devrefresh_<name>_prod (shaped like Production: older schema,
// October columns / tables / triggers absent) and devrefresh_<name>_dev (the repository's current schema), filled with SYNTHETIC rows.
// Every scenario drives the real tool code (preview, apply, restore) and checks the RESULT with independent SQL.
//
// Part 3: a failing apply rolls back and leaves Development in a known state; stale, tampered, expired and drifted inputs are refused.
// (The scenarios are spread over several files only so that each stays well inside the test runner per-file time limit.)
//
// With no reachable database the scenarios are SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/devRefresh/devRefreshReplacementFailure.test.ts

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
    const msg = 'devRefreshReplacementFailure: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
    if (process.env.ROLE_DB_REQUIRE === '1') throw new Error(`${msg} (ROLE_DB_REQUIRE=1)`);
    console.log(msg);
    return;
  }
  const made: any[] = [];
  let statusCheckDefinition = '';
  // One pair of scratch databases per file, reset between scenarios (creating databases is the slow part).
  let shared: any = null;
  const pair = (_scenario: string, o: any = {}) => {
    if (!shared) {
      shared = buildScratchPair('rep7', { seed: false });
      made.push(shared);
    }
    return resetScratchPair(shared, o);
  };
  try {

    // =================================================================================================================
    // 3. Failure handling: the transaction rolls back and Development stays in a known state
    // =================================================================================================================
    {
      const p = pair('t_fail');
      const root = newRoot();
      statusCheckDefinition = scalar(p.prodDb, "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'orders_status_check'");
      psqlOn(p.prodDb, `SET session_replication_role = replica; ALTER TABLE orders DROP CONSTRAINT orders_status_check; UPDATE orders SET status = 'bogus' WHERE id = '${id(K.order, 5)}';`);
      const before = snapshot(p.devDb);
      const statesBefore = triggerStates(p.devDb);
      const blocked = preview({ prod: p.prod, dev: p.dev, root });
      ok('the rehearsal finds Production data Development would reject and BLOCKS the preview', blocked.manifest.status === 'blocked' && /Rehearsal failed/.test(blocked.manifest.problems.join()) && /orders_status_check/.test(blocked.manifest.rehearsal.failure.detail));
      ok('a blocked preview cannot be applied', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: blocked.manifest.id, confirm: 'x' }), /not "previewed"/));
      eq('and Development is exactly as before', diff(before, snapshot(p.devDb)), []);

      const noRehearsal = preview({ prod: p.prod, dev: p.dev, root, rehearse: false });
      ok('without the rehearsal the same preview passes (that is what the rehearsal is for)', noRehearsal.manifest.status === 'previewed' && noRehearsal.manifest.rehearsal.skipped);
      const a = apply({ prod: p.prod, dev: p.dev, root, id: noRehearsal.manifest.id, confirm: confirmationPhrase(noRehearsal.manifest) });
      ok('apply FAILS part-way (after the deletes) and says why', a.ok === false && a.manifest.status === 'failed' && /orders_status_check/.test(a.manifest.failure.detail));
      eq('THE FAILED APPLY LEFT DEVELOPMENT EXACTLY AS IT WAS (whole transaction rolled back, all tables, auth, storage)', diff(before, snapshot(p.devDb)), []);
      eq('trigger states are untouched after the failure', triggerStates(p.devDb), statesBefore);
      ok('the tool itself proved the state afterwards', /unchanged/.test(a.manifest.stateAfterFailure));
      ok('a verified backup exists even for the failed attempt', fs.existsSync(path.join(a.runDir, 'backup', 'orders.copy')));
      ok('a failed run cannot be applied again', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: a.manifest.id, confirm: confirmationPhrase(a.manifest) }), /not "previewed"/));
      // undo the scenario's change to Production's schema (after emptying the tables that held the invalid row)
      resetScratchPair(p, { seed: false });
      psqlOn(p.prodDb, 'ALTER TABLE public.orders ADD CONSTRAINT orders_status_check ' + statusCheckDefinition);
    }


    // =================================================================================================================
    // 4. Stale, tampered, expired and drifted inputs are refused
    // =================================================================================================================
    {
      const p = pair('t_stale');
      const root = newRoot();
      const pv = preview({ prod: p.prod, dev: p.dev, root });
      const m = pv.manifest;
      const phrase = confirmationPhrase(m);
      // Development changes after the preview
      psqlOn(p.devDb, `UPDATE customers SET phone = '+15559990000' WHERE id = '${id(K.customer, 901)}'`);
      const before = snapshot(p.devDb);
      ok('Development changed after the preview: apply refuses and modifies nothing', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: m.id, confirm: phrase }), /changed between the preview and the backup/) && diff(before, snapshot(p.devDb)).length === 0);
      ok('the run is back to "previewed" (nothing was applied)', readManifest(root, m.id).status === 'previewed');

      const pv2 = preview({ prod: p.prod, dev: p.dev, root });
      const exportFile = path.join(pv2.runDir, 'export', 'orders.copy');
      fs.appendFileSync(exportFile, '\n');
      fs.writeFileSync(exportFile, fs.readFileSync(exportFile, 'utf8').replace('Synthetic order 1', 'Tampered order 1'));
      ok('an altered export file is detected before anything is touched', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: pv2.manifest.id, confirm: confirmationPhrase(pv2.manifest) }), /altered or is missing/));

      const pv3 = preview({ prod: p.prod, dev: p.dev, root });
      ok('a preview older than the limit is refused', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: pv3.manifest.id, confirm: confirmationPhrase(pv3.manifest), now: () => Date.now() + 25 * 3600 * 1000 }), /hours old/));
      psqlOn(p.devDb, 'ALTER TABLE public.orders ADD COLUMN drifted text');
      ok('a Development schema change after the preview is refused', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: pv3.manifest.id, confirm: confirmationPhrase(pv3.manifest) }), /schema changed since the preview/));
      psqlOn(p.devDb, 'ALTER TABLE public.orders DROP COLUMN drifted');

      const pv4 = preview({ prod: p.prod, dev: p.dev, root });
      const a = apply({ prod: p.prod, dev: p.dev, root, id: pv4.manifest.id, confirm: confirmationPhrase(pv4.manifest) });
      ok('a clean preview applies', a.ok);
      fs.writeFileSync(path.join(a.runDir, 'backup', 'orders.copy'), fs.readFileSync(path.join(a.runDir, 'backup', 'orders.copy'), 'utf8').replace('DEV ONLY', 'ALTERED'));
      ok('an altered backup is refused by restore', throws(() => restore({ dev: p.dev, root, id: pv4.manifest.id, confirm: restorePhrase(a.manifest) }), /missing or altered/));
      ok('a backup cannot be restored onto another database', throws(() => restore({ dev: { ...p.dev, database: 'devrefresh_nonexistent_dev' }, root, id: pv4.manifest.id, confirm: restorePhrase(a.manifest) }), /different Development database|Refusing/));
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
  console.log(`dev refresh devRefreshReplacementFailure tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} devRefreshReplacementFailure test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
