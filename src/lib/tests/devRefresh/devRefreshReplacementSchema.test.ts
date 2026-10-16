/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Production -> Development order data refresh, executed against SCRATCH PostgreSQL databases (never a Supabase project).
//
// Two throw-away databases per scenario on the local test server: devrefresh_<name>_prod (shaped like Production: older schema,
// October columns / tables / triggers absent) and devrefresh_<name>_dev (the repository's current schema), filled with SYNTHETIC rows.
// Every scenario drives the real tool code (preview, apply, restore) and checks the RESULT with independent SQL.
//
// Part 3: schema incompatibilities and unreviewed dependencies stop the run before anything is read or changed.
// (The scenarios are spread over several files only so that each stays well inside the test runner per-file time limit.)
//
// With no reachable database the scenarios are SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/devRefresh/devRefreshReplacementSchema.test.ts

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
    const msg = 'devRefreshReplacementSchema: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
    if (process.env.ROLE_DB_REQUIRE === '1') throw new Error(`${msg} (ROLE_DB_REQUIRE=1)`);
    console.log(msg);
    return;
  }
  const made: any[] = [];
  // One pair of scratch databases per file, reset between scenarios (creating databases is the slow part).
  let shared: any = null;
  const pair = (_scenario: string, o: any = {}) => {
    if (!shared) {
      shared = buildScratchPair('rep3', { seed: false });
      made.push(shared);
    }
    return resetScratchPair(shared, o);
  };
  try {
    // =================================================================================================================
    // 5. Incompatible schemas and unreviewed dependencies stop the run before anything is read or changed
    // =================================================================================================================
    {
      const p = pair('t_schema', { seed: false });
      const root = newRoot();
      const mutate = (name: string, up: string, down: string, re: RegExp, extra: any = {}) => {
        psqlOn(p.devDb, up);
        const before = snapshot(p.devDb);
        const pv = preview({ prod: p.prod, dev: p.dev, root, ...extra });
        ok(`${name}: preview is blocked (${pv.manifest.problems[0]?.slice(0, 90)})`, pv.manifest.status === 'blocked' && re.test(pv.manifest.problems.join('\n')));
        ok(`${name}: nothing was exported or changed`, !fs.existsSync(path.join(pv.runDir, 'export')) || fs.readdirSync(path.join(pv.runDir, 'export')).length === 0);
        eq(`${name}: Development untouched`, diff(before, snapshot(p.devDb)), []);
        psqlOn(p.devDb, down);
      };
      mutate('type difference', 'ALTER TABLE public.customers ALTER COLUMN phone TYPE varchar(40)', 'ALTER TABLE public.customers ALTER COLUMN phone TYPE text', /customers\.phone: type differs/);
      mutate('required Development column Production lacks', "ALTER TABLE public.customers ADD COLUMN must_have text NOT NULL DEFAULT 'x'; ALTER TABLE public.customers ALTER COLUMN must_have DROP DEFAULT", 'ALTER TABLE public.customers DROP COLUMN must_have', /customers\.must_have: required/);
      mutate('unreviewed trigger on a replaced table', 'CREATE FUNCTION public.zz_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER zz_new_behaviour BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.zz_noop()', 'DROP TRIGGER zz_new_behaviour ON public.payments; DROP FUNCTION public.zz_noop()', /payments\.zz_new_behaviour.*has not been reviewed/);
      mutate('unscoped table that would lose rows through ON DELETE CASCADE', 'CREATE TABLE public.zz_audit (id uuid PRIMARY KEY, order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE)', 'DROP TABLE public.zz_audit', /zz_audit.*would delete rows of an unscoped table/);
      mutate('unscoped table whose reference would make the delete fail', 'CREATE TABLE public.zz_audit (id uuid PRIMARY KEY, order_id uuid REFERENCES public.orders(id))', 'DROP TABLE public.zz_audit', /zz_audit.*without ON DELETE SET NULL/);
      mutate('unscoped SET NULL reference without a primary key', 'CREATE TABLE public.zz_audit (order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL)', 'DROP TABLE public.zz_audit', /zz_audit.*no primary key/);
      mutate('live Stripe key in Development', "INSERT INTO public.admin_settings (key, value) VALUES ('stripe_secret_key', 'sk_live_notreal') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", "INSERT INTO public.admin_settings (key, value) VALUES ('stripe_secret_key', 'sk_test_scratchonly') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", /LIVE Stripe key/);
      mutate('unrecognizable Stripe key in Development', "INSERT INTO public.admin_settings (key, value) VALUES ('stripe_publishable_key', 'whsec_x') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", "INSERT INTO public.admin_settings (key, value) VALUES ('stripe_publishable_key', 'pk_test_scratchonly') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", /not a recognizable Stripe test key/);
      // an unreviewed trigger can be acknowledged explicitly, by name
      psqlOn(p.devDb, 'CREATE FUNCTION public.zz_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER zz_new_behaviour BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.zz_noop()');
      const ack = preview({ prod: p.prod, dev: p.dev, root, acknowledgeTriggers: ['payments.zz_new_behaviour'] });
      ok('naming the trigger on the command line lets the same preview through', ack.manifest.status === 'previewed');
      psqlOn(p.devDb, 'DROP TRIGGER zz_new_behaviour ON public.payments; DROP FUNCTION public.zz_noop()');
      // a live key appearing AFTER the preview is also caught at apply time
      const pv = preview({ prod: p.prod, dev: p.dev, root });
      psqlOn(p.devDb, "INSERT INTO public.admin_settings (key, value) VALUES ('stripe_secret_key', 'sk_live_notreal') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
      ok('a live Stripe key that appears after the preview stops the apply', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: pv.manifest.id, confirm: confirmationPhrase(pv.manifest) }), /LIVE Stripe key/));
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
  console.log(`dev refresh devRefreshReplacementSchema tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} devRefreshReplacementSchema test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
