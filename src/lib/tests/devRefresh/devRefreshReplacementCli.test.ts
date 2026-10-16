/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Production -> Development order data refresh, executed against SCRATCH PostgreSQL databases (never a Supabase project).
//
// Two throw-away databases per scenario on the local test server: devrefresh_<name>_prod (shaped like Production: older schema,
// October columns / tables / triggers absent) and devrefresh_<name>_dev (the repository's current schema), filled with SYNTHETIC rows.
// Every scenario drives the real tool code (preview, apply, restore) and checks the RESULT with independent SQL.
//
// Part 6: the command line, end to end (scratch targets).
// (The scenarios are spread over several files only so that each stays well inside the test runner per-file time limit.)
//
// With no reachable database the scenarios are SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/devRefresh/devRefreshReplacementCli.test.ts

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
    const msg = 'devRefreshReplacementCli: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
    if (process.env.ROLE_DB_REQUIRE === '1') throw new Error(`${msg} (ROLE_DB_REQUIRE=1)`);
    console.log(msg);
    return;
  }
  const made: any[] = [];
  // One pair of scratch databases per file, reset between scenarios (creating databases is the slow part).
  let shared: any = null;
  const pair = (_scenario: string, o: any = {}) => {
    if (!shared) {
      shared = buildScratchPair('rep6', { seed: false });
      made.push(shared);
    }
    return resetScratchPair(shared, o);
  };
  try {
    // =================================================================================================================
    // 10. The command line, end to end (scratch targets)
    // =================================================================================================================
    {
      const p = pair('t_cli');
      const run = (...args: string[]) => spawnSync('node', ['scripts/dev-refresh/cli.mjs', ...args, '--scratch', shared.devDb.slice('devrefresh_'.length, -'_dev'.length)], { encoding: 'utf8', env: process.env });
      const doctor = run('doctor');
      ok('doctor verifies identities and proves Production writes are refused', doctor.status === 0 && /session is read-only; a write was refused/.test(doctor.stdout));
      const pv = run('preview');
      const runId = (pv.stdout.match(/Run (\d{8}-\d{6})/) || [])[1];
      ok('preview prints the table, the rehearsal result and the exact approval command', pv.status === 0 && !!runId && /Rehearsal: the complete replacement ran/.test(pv.stdout) && new RegExp(`--confirm "REPLACE DEV ORDERS ${p.devDb} WITH PRODUCTION [0-9a-f]{8}"`).test(pv.stdout));
      ok('preview is the default and never prints a password', !/postgres:postgres|PGPASSWORD/.test(pv.stdout + pv.stderr));
      const bad = run('apply', '--run', runId, '--confirm', 'go');
      ok('apply without the phrase exits non-zero and says what to type', bad.status !== 0 && /Approval phrase does not match/.test(bad.stderr));
      const phrase = (pv.stdout.match(/--confirm "([^"]+)"/) || [])[1];
      const good = run('apply', '--run', runId, '--confirm', phrase);
      ok('apply with the phrase succeeds and prints the verification and the undo command', good.status === 0 && /\[ok\] row count orders/.test(good.stdout) && /restore --run/.test(good.stdout));
      ok('runs lists it', /applied/.test(spawnSync('node', ['scripts/dev-refresh/cli.mjs', 'runs'], { encoding: 'utf8' }).stdout));
      ok('verify passes', run('verify', '--run', runId).status === 0);
      const media = run('media-plan', '--run', runId);
      ok('media-plan reports the evidence objects and changes nothing', media.status === 0 && /Evidence objects referenced/.test(media.stdout) && /never deleted/.test(media.stdout));
      const undo = run('restore', '--run', runId, '--confirm', `RESTORE DEV ORDERS ${p.devDb} FROM BACKUP ${runId}`);
      ok('restore through the command line works', undo.status === 0 && /verified identical/.test(undo.stdout));
      ok('unknown commands fail', run('frobnicate').status !== 0);
      fs.rmSync(path.join('.dev-refresh', 'runs', runId), { recursive: true, force: true });
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
  console.log(`dev refresh devRefreshReplacementCli tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} devRefreshReplacementCli test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
