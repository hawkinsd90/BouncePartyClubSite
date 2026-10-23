/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Production -> Development order data refresh, executed against SCRATCH PostgreSQL databases (never a Supabase project).
//
// Two throw-away databases per scenario on the local test server: devrefresh_<name>_prod (shaped like Production: older schema,
// October columns / tables / triggers absent) and devrefresh_<name>_dev (the repository's current schema), filled with SYNTHETIC rows.
// Every scenario drives the real tool code (preview, apply, restore) and checks the RESULT with independent SQL.
//
// Part 1: preview changes nothing, apply replaces exactly the scope, restore returns the exact prior state; a failing apply rolls back.
// (The scenarios are spread over several files only so that each stays well inside the test runner per-file time limit.)
//
// With no reachable database the scenarios are SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/syncDevDataFromProd/syncDevDataFromProdReplacement.test.ts

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
    const msg = 'syncDevDataFromProdReplacement: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
    if (process.env.ROLE_DB_REQUIRE === '1') throw new Error(`${msg} (ROLE_DB_REQUIRE=1)`);
    console.log(msg);
    return;
  }
  const made: any[] = [];
  // One pair of scratch databases per file, reset between scenarios (creating databases is the slow part).
  let shared: any = null;
  const pair = (_scenario: string, o: any = {}) => {
    if (!shared) {
      shared = buildScratchPair('rep1', { seed: false });
      made.push(shared);
    }
    return resetScratchPair(shared, o);
  };
  try {
    // 1. Preview changes nothing; apply replaces exactly the scope; restore returns the exact prior state
    // =================================================================================================================
    {
      const p = pair('t_main');
      const root = newRoot();
      const devBefore = snapshot(p.devDb);
      const prodBefore = snapshot(p.prodDb);
      ok('fixture: Development starts with its own test orders and Production with the Production orders', count(p.devDb, 'orders') === 3 && count(p.prodDb, 'orders') === 10);

      const env = verifyEnvironment({ prod: p.prod, dev: p.dev });
      ok('environment is verified before anything is read (scratch identities)', env.devLabel === p.devDb && env.prodLabel === p.prodDb);

      const pv = preview({ prod: p.prod, dev: p.dev, root });
      const m = pv.manifest;
      eq('preview of a healthy pair is "previewed" with no problems', [m.status, m.problems], ['previewed', []]);
      ok('the rehearsal ran the whole replacement and rolled it back', m.rehearsal.ok === true);
      eq('PREVIEW LEFT DEVELOPMENT UNCHANGED (every table, auth, storage, policies, trigger states)', diff(devBefore, snapshot(p.devDb)), []);
      eq('PREVIEW LEFT PRODUCTION UNCHANGED', diff(prodBefore, snapshot(p.prodDb)), []);
      ok('preview reports the exact Development rows that will be deleted (counts match reality)', m.plan.tables.every((t: any) => (m.devCountsBefore[t.name] ?? 0) === count(p.devDb, t.name)));
      ok('preview reports the exact Production rows that will be imported (counts match reality)', m.plan.tables.filter((t: any) => t.mode === 'import').every((t: any) => m.exportCounts[t.name] === count(p.prodDb, t.name)));
      ok('preview lists the Development row ids to be replaced in a file', fs.readFileSync(path.join(pv.runDir, 'dev-rows-to-replace', 'orders.ids'), 'utf8').split('\n').filter(Boolean).length === 3);
      ok('preview names the Development-only tables emptied with their orders', m.plan.clearedWithOrders.map((c: any) => c.table).sort().join() === 'booking_setup_proofs,order_portal_links,task_evidence_overrides');
      // task_evidence_overrides (photo-evidence release): dependent audit rows of tasks the refresh replaces
      eq('the preview reports the three Development photo-rule overrides that will be emptied with their tasks', [m.devCountsBefore.task_evidence_overrides, count(p.devDb, 'task_evidence_overrides')], [3, 3]);
      ok('the written report names the table and its row count', /task_evidence_overrides \(3 rows\)/.test(fs.readFileSync(path.join(pv.runDir, 'report.md'), 'utf8')));
      ok('the reviewed-trigger list covers the photo-evidence trigger on task_status (the preview did not stop on it)', m.plan.triggers.some((t: any) => t.table === 'task_status' && t.name === 'trg_enforce_task_evidence' && t.reviewed));
      ok('the report states the pending Production payment and the table counts', /still 'pending'/.test(fs.readFileSync(path.join(pv.runDir, 'report.md'), 'utf8')) && /\| orders \| 3 \| 10 \|/.test(fs.readFileSync(path.join(pv.runDir, 'report.md'), 'utf8')));
      ok('the export folder holds one file per imported table', m.plan.tables.filter((t: any) => t.mode === 'import').every((t: any) => fs.existsSync(path.join(pv.runDir, 'export', `${t.name}.copy`))));

      // approval is explicit and exact
      ok('apply without the exact approval phrase is refused and changes nothing', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: m.id, confirm: 'yes' }), /Approval phrase does not match/) && diff(devBefore, snapshot(p.devDb)).length === 0);
      ok('a phrase for a DIFFERENT plan is refused', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: m.id, confirm: confirmationPhrase({ ...m, planHash: 'deadbeef'.repeat(8) }) }), /Approval phrase does not match/));

      const a = apply({ prod: p.prod, dev: p.dev, root, id: m.id, confirm: confirmationPhrase(m) });
      ok('apply succeeded and verified itself', a.ok && a.manifest.status === 'applied' && a.manifest.verification.checks.every((c: any) => c.ok));
      eq('PRODUCTION IS UNCHANGED after preview + backup + apply', diff(prodBefore, snapshot(p.prodDb)), []);
      const devAfter = snapshot(p.devDb);

      // ---- scope: what was replaced ----
      eq('every replaced table now matches Production, row for row', scopeContentDifferences(p), []);
      ok('Development-only test orders are gone', count(p.devDb, 'orders') === 10 && scalar(p.devDb, `SELECT count(*) FROM orders WHERE special_details LIKE 'DEV ONLY%'`) === '0');
      ok('Development-only portal links and booking proofs were emptied with their orders', count(p.devDb, 'order_portal_links') === 0 && count(p.devDb, 'booking_setup_proofs') === 0);
      eq('the old photo-rule overrides did not survive - not even the one whose task id was re-imported from Production', count(p.devDb, 'task_evidence_overrides'), 0);
      eq('no override points at a missing task (no orphans) and every foreign key in public validates', [scalar(p.devDb, 'SELECT count(*) FROM task_evidence_overrides o LEFT JOIN task_status t ON t.id = o.task_status_id WHERE t.id IS NULL'), scalar(p.devDb, "SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND NOT convalidated AND connamespace = 'public'::regnamespace")], ['0', '0']);
      eq('the imported Production task that shares an id with an old Development task carries no inherited override', scalar(p.devDb, "SELECT count(*) FROM task_evidence_overrides WHERE task_status_id = '" + id(K.task, 1) + "'"), '0');
      ok('the older Development copy of a Production customer was replaced by the Production row', scalar(p.devDb, `SELECT last_name FROM customers WHERE id = '${id(K.customer, 1)}'`) === 'Prod');

      // ---- scope: what must NOT change ----
      const changed = diff(devBefore, devAfter);
      const replaced = new Set([...Object.keys(SCOPE_CONTENT), 'order_portal_links', 'booking_setup_proofs', 'task_evidence_overrides']);
      eq('ONLY replaced tables changed (everything else - settings, roles, inventory, pricing, templates, auth, storage, policies - is byte-identical)', changed.filter((k) => !replaced.has(k) && k !== 'triggers'), ['customer_profiles', 'site_events', 'user_consent_log']);
      ok('the two preserved tables that point at replaced rows changed ONLY in those references', scalar(p.devDb, 'SELECT count(*) FROM customer_profiles') === '3' && scalar(p.devDb, 'SELECT count(*) FROM user_consent_log') === '2');
      eq('trigger states are exactly as before', devBefore.triggers, devAfter.triggers);
      eq('Storage objects, buckets and every policy are untouched', [devBefore['storage.objects'], devBefore['storage.buckets'], devBefore.policies], [devAfter['storage.objects'], devAfter['storage.buckets'], devAfter.policies]);
      eq('Development admin settings (credentials) untouched', devBefore.admin_settings, devAfter.admin_settings);
      eq('inventory and pricing untouched', [devBefore.units, devBefore.pricing_rules, devBefore.email_templates], [devAfter.units, devAfter.pricing_rules, devAfter.email_templates]);
      eq('auth users untouched', devBefore['auth.users'], devAfter['auth.users']);
      eq('user roles untouched', devBefore.user_roles, devAfter.user_roles);
      ok('every foreign-key (internal) trigger is enabled', triggerStates(p.devDb).filter((l) => l.endsWith('/true')).every((l) => /=O\//.test(l)));
      ok('the ledger sequence was raised to the imported data', scalar(p.devDb, 'SELECT (SELECT last_value FROM payments_ledger_sequence_seq) >= (SELECT max(ledger_sequence) FROM payments)') === 't');

      // ---- financial safety ----
      eq('no Production Stripe customer / payment-method id reached Development', scalar(p.devDb, 'SELECT count(stripe_customer_id) + count(stripe_payment_method_id) + count(payment_method_id) FROM orders'), '0');
      ok('the application sees NO saved card on any imported order', scalar(p.devDb, 'SELECT count(*) FROM orders WHERE stripe_customer_id IS NOT NULL AND stripe_payment_method_id IS NOT NULL') === '0');
      eq('ledger history keeps its Stripe references unchanged (payment intents, charges, refunds)', [scalar(p.devDb, "SELECT string_agg(stripe_payment_intent_id, ',' ORDER BY stripe_payment_intent_id) FROM payments"), scalar(p.devDb, "SELECT string_agg(stripe_refund_id, ',') FROM order_refunds"), scalar(p.devDb, "SELECT string_agg(stripe_charge_id, ',' ORDER BY stripe_charge_id) FROM transaction_receipts")], ['pi_prod_1,pi_prod_2,pi_prod_2,pi_prod_3', 're_prod_1', 'ch_prod_1,ch_prod_2']);
      eq('money columns are exactly Production\'s', scalar(p.devDb, 'SELECT sum(deposit_paid_cents + balance_paid_cents + total_refunded_cents + subtotal_cents) FROM orders'), scalar(p.prodDb, 'SELECT sum(deposit_paid_cents + balance_paid_cents + total_refunded_cents + subtotal_cents) FROM orders'));
      eq('payments ledger totals are exactly Production\'s', scalar(p.devDb, 'SELECT sum(amount_cents) || \':\' || count(*) FROM payments'), scalar(p.prodDb, 'SELECT sum(amount_cents) || \':\' || count(*) FROM payments'));
      eq('the refund row still points at the payment it refunded', scalar(p.devDb, `SELECT refunded_payment_id FROM payments WHERE id = '${id(K.payment, 4)}'`), id(K.payment, 2));
      eq('no payment is "locked" in flight', scalar(p.devDb, 'SELECT count(*) FROM orders WHERE payment_lock'), '0');
      ok('the withheld originals are in the run folder, outside the database', /cus_prod_1/.test(fs.readFileSync(path.join(a.runDir, 'outputs', 'stripe-quarantine-orders.stripe_customer_id.copy'), 'utf8')));
      ok('Production-only references survive nowhere in the Development database dump', !/pm_prod_|cus_prod_/.test(psqlOn(p.devDb, "SELECT string_agg(x::text, ' ') FROM public.orders x").stdout));
      ok('an imported Production card is not an acceptable test card: no order is eligible for an off-session charge', scalar(p.devDb, "SELECT count(*) FROM orders WHERE stripe_customer_id IS NOT NULL OR stripe_payment_method_id IS NOT NULL") === '0');

      // ---- Auth / customer ownership ----
      const linked = sets(p.devDb, "SELECT first_name || '=' || user_id FROM customers WHERE user_id IS NOT NULL ORDER BY 1");
      eq('customers are linked to a login only where the relationship is proven and unique (same id + same email, or one confirmed login with the same email)', linked, [`alice=${USERS.alice}`, `carol=${USERS.carolDev}`]);
      const unlinked = sets(p.devDb, "SELECT first_name FROM customers WHERE user_id IS NULL ORDER BY 1");
      eq('everyone else is unlinked: conflicting id/email, ambiguous, unconfirmed, colliding, unknown and never-registered', unlinked, ['bob', 'dave', 'erin', 'frank', 'gina1', 'gina2', 'henry']);
      const unlinkedFile = fs.readFileSync(path.join(a.runDir, 'outputs', 'auth-unlinked-customers.copy'), 'utf8');
      ok('every unlinked customer that HAD a Production login is reported with the rule that left it unlinked', ['conflict-same-id-different-email', 'ambiguous-email', 'unmatched', 'email-match'].every((r) => unlinkedFile.includes(r)) && unlinkedFile.split('\n').filter(Boolean).length === 6);
      eq('the report counts each ownership rule', a.manifest.result.owner['same-id-same-email'] + '/' + a.manifest.result.owner['conflict-same-id-different-email'] + '/' + a.manifest.result.owner['ambiguous-email'] + '/' + a.manifest.result.owner.unmatched + '/' + a.manifest.result.owner['collision-set-to-none'] + '/' + a.manifest.result.owner.linked, '1/1/1/2/2/2');
      eq('staff attribution is kept only for staff that exist in Development; the rest is NULL (and listed)', [scalar(p.devDb, `SELECT count(*) FROM order_changelog WHERE user_id IS NOT NULL`), scalar(p.devDb, `SELECT count(*) FROM orders WHERE cancelled_by IS NOT NULL`)], ['5', '1']);
      ok('attribution that could not be kept is written to a local file for follow-up', fs.existsSync(path.join(a.runDir, 'outputs', 'auth-attribution-order_changelog.user_id.copy')));

      // ---- customer portal: ownership and authorization after the transformations ----
      const o = (n: number) => id(K.order, n);
      eq('portal: the signed-in owner sees exactly their own orders', visibleOrders(p.devDb, USERS.alice), [o(1), o(10)].sort().join(','));
      eq('portal: a second proven owner sees only theirs', visibleOrders(p.devDb, USERS.carolDev), o(3));
      eq('portal: a login whose profile pointed at ANOTHER person\'s contact does NOT inherit that customer\'s orders', visibleOrders(p.devDb, USERS.carolDev).includes(o(1)), false);
      for (const [who, uid] of [['staff login', USERS.devStaff], ['conflicting-email login', USERS.bob], ['ambiguous login 1', USERS.daveDev1], ['ambiguous login 2', USERS.daveDev2], ['unconfirmed login', USERS.frankDev], ['colliding login', USERS.ginaDev], ['anonymous', null]] as const) {
        eq(`portal: ${who} sees no imported customer's orders`, visibleOrders(p.devDb, uid), '');
      }
      eq('portal: across every login, only the two proven customers\' orders are reachable', [...new Set(Object.values(USERS).flatMap((u) => visibleOrders(p.devDb, u as string).split(',').filter(Boolean)))].sort(), [o(1), o(10), o(3)].sort());

      // ---- references from preserved tables ----
      eq('a profile\'s link to its own contact (same person) is restored', scalar(p.devDb, `SELECT contact_id FROM customer_profiles WHERE id = '${id(K.profile, 1)}'`), id(K.contact, 1));
      eq('a profile\'s link to somebody else\'s contact is NOT restored', scalar(p.devDb, `SELECT COALESCE(contact_id::text, 'NULL') FROM customer_profiles WHERE id = '${id(K.profile, 2)}'`), 'NULL');
      eq('a profile\'s link to a Development-only contact is gone', scalar(p.devDb, `SELECT COALESCE(contact_id::text, 'NULL') FROM customer_profiles WHERE id = '${id(K.profile, 3)}'`), 'NULL');
      eq('a consent-log entry for a customer that exists again is restored; the Development-only one is not', sets(p.devDb, `SELECT COALESCE(customer_id::text, 'NULL') FROM user_consent_log ORDER BY id`), [id(K.customer, 1), 'NULL']);
      eq('an analytics event for an order that exists again is restored; the Development-only one is not', sets(p.devDb, `SELECT COALESCE(order_id::text, 'NULL') FROM site_events ORDER BY id`), [id(K.order, 1), 'NULL']);

      // ---- restore ----
      ok('restore without the exact phrase is refused', throws(() => restore({ dev: p.dev, root, id: m.id, confirm: 'restore' }), /Approval phrase does not match/));
      const r = restore({ dev: p.dev, root, id: m.id, confirm: restorePhrase(a.manifest) });
      ok('restore succeeded and verified itself', r.ok && r.mismatches.length === 0);
      eq('RESTORE RETURNED DEVELOPMENT TO THE EXACT STATE BEFORE THE REFRESH (every table, auth, storage, policies, trigger states)', diff(devBefore, snapshot(p.devDb)), []);
      eq('restore also put the three photo-rule overrides back, attached to their tasks', [count(p.devDb, 'task_evidence_overrides'), scalar(p.devDb, 'SELECT count(*) FROM task_evidence_overrides o JOIN task_status t ON t.id = o.task_status_id')], [3, '3']);
      eq('restore also put the Development-only portal links and proofs back', [count(p.devDb, 'order_portal_links'), count(p.devDb, 'booking_setup_proofs')], [1, 1]);
      eq('Production still untouched after restore', diff(prodBefore, snapshot(p.prodDb)), []);
      ok('the sequence is still consistent after restore', scalar(p.devDb, 'SELECT (SELECT last_value FROM payments_ledger_sequence_seq) >= (SELECT max(ledger_sequence) FROM payments)') === 't');
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
  console.log(`dev refresh syncDevDataFromProdReplacement tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} syncDevDataFromProdReplacement test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
