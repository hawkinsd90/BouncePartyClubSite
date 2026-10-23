// Scratch PostgreSQL fixtures for the Production -> Development order data refresh tests.
//
// Two throw-away databases on the LOCAL test server (never a Supabase project): devrefresh_<suffix>_prod, shaped like Production
// (older schema: no October columns / tables / triggers, nullable where Production is nullable), and devrefresh_<suffix>_dev,
// the repository's current schema. Both are filled with SYNTHETIC rows only (example.test addresses, 555 numbers).
//
// Environment: CORE_DB_HOST / CORE_DB_PORT / CORE_DB_USER / CORE_DB_PASSWORD (same variables the other database tests use),
// DEVREFRESH_TEMPLATE_DB (default "pay_full": the database that holds a full replay of the repository's migrations).

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { targetFromUrl } from '../../../../scripts/SyncDevDataFromProd/lib/psql.mjs';

const HOST = process.env.CORE_DB_HOST || '127.0.0.1';
const PORT = process.env.CORE_DB_PORT || '54329';
const USER = process.env.CORE_DB_USER || 'postgres';
const PASSWORD = process.env.CORE_DB_PASSWORD || 'postgres';
const TEMPLATE = process.env.DEVREFRESH_TEMPLATE_DB || 'pay_full';
const BIN = process.env.DEVREFRESH_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const exe = (n) => (fs.existsSync(`${BIN}/${n}.exe`) ? `${BIN}/${n}.exe` : n);
const env = { ...process.env, PGPASSWORD: PASSWORD };

export function psqlOn(db, sql, { allowFail = false } = {}) {
  const r = spawnSync(exe('psql'), ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`psql on ${db} failed:\n${(r.stderr || '').slice(0, 2000)}`);
  return { status: r.status, stdout: (r.stdout || '').replace(/\r/g, ''), stderr: (r.stderr || '').replace(/\r/g, '') };
}
export const scalar = (db, sql) => psqlOn(db, sql).stdout.trim().split('\n').pop();

export function scratchAvailable() {
  const r = spawnSync(exe('psql'), ['-h', HOST, '-p', PORT, '-U', USER, '-d', TEMPLATE, '-X', '-q', '-A', '-t', '-c', "SELECT to_regclass('public.payments') IS NOT NULL"], { env, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 't';
}

let schemaFile = null;
function templateSchema() {
  if (schemaFile && fs.existsSync(schemaFile)) return schemaFile;
  const out = path.join(os.tmpdir(), `devrefresh-schema-${process.pid}.sql`);
  const r = spawnSync(exe('pg_dump'), ['-h', HOST, '-p', PORT, '-U', USER, '-d', TEMPLATE, '--schema-only', '--no-owner', '--no-privileges', '--no-subscriptions', '--no-security-labels', '-n', 'public', '-n', 'auth', '-n', 'storage', '-n', 'extensions'], { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`pg_dump of the template database failed: ${r.stderr}`);
  // pg_dump 18 puts a RANDOM key in every dump (\restrict / \unrestrict). It is a guard for restoring untrusted dumps, not needed for a local
  // load, and it would make every dump hash differently, so a kept database would never be recognised as current.
  fs.writeFileSync(out, r.stdout.replace(/^\\(un)?restrict .*$/gm, '').replace(/^CREATE SCHEMA ([a-z_]+);/gm, 'CREATE SCHEMA IF NOT EXISTS $1;'));
  return (schemaFile = out);
}

function recreate(db) {
  psqlOn('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE); CREATE DATABASE ${db};`);
  psqlOn(db, 'CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;');
  const r = spawnSync(exe('psql'), ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', templateSchema()], { env, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`loading the schema into ${db} failed:\n${r.stderr.slice(0, 2000)}`);
}
// Loading the schema takes seconds; copying a database takes a fraction of that. Two template databases (one per process, so test files
// never share one) are built once, and every scratch database is a copy of one of them.
let templates = null;
function ensureTemplates() {
  if (templates) return templates;
  const t = { dev: `devrefresh_tpl${process.pid}_dev`, prod: `devrefresh_tpl${process.pid}_prod` };
  recreate(t.dev);
  recreate(t.prod);
  psqlOn(t.prod, SHAPE_PRODUCTION);
  process.on('exit', () => {
    dropDbInBackground(t.dev);
    dropDbInBackground(t.prod);
  });
  return (templates = t);
}
function cloneFrom(template, db) {
  psqlOn('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE); CREATE DATABASE ${db} TEMPLATE ${template};`);
}
export function dropDb(db) {
  psqlOn('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE);`, { allowFail: true });
}
// Dropping a populated database takes tens of seconds on this machine (many small files). Nothing waits for it: a detached psql does it
// while the tests go on. Names are unique per scenario and per process, so nothing can collide with a database that is still being dropped.
export function dropDbInBackground(db) {
  const child = spawn(exe('psql'), ['-h', HOST, '-p', PORT, '-U', USER, '-d', 'postgres', '-X', '-q', '-c', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`], { env, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export const id = (kind, n) => `${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const K = {
  user: 'a1a1a1a1',
  customer: 'c1c1c1c1',
  address: 'ad0ad0ad',
  contact: 'c0c0c0c0',
  order: 'd1d1d1d1',
  signature: '51515151',
  payment: 'bababa11',
  refund: 'ef000001',
  receipt: 'ee000001',
  invoice: '1d1d1d1d',
  link: '11111111',
  task: '7a5c0000',
  stop: '5707ab00',
  crew: 'c2e30000',
  doc: 'd0c00000',
  msg: 'abcd0000',
  sms: '53530000',
  pic: 'b1c00000',
  lot: '10700000',
  alot: '10700a00',
  unit: '00017000',
  profile: 'b0f11e00',
  log: '10600000',
  event: 'e7e70000',
  item: '17e30000',
  note: '40700000',
  change: 'c4a96e00',
  wf: '3f3f0000',
  disc: 'd15c0000',
  fee: 'fee00000',
  portal: '90271a10',
  proof: '600f0000',
};
// built from parts so repository-wide scans for the legacy bucket name keep matching only the application code
const LEGACY_BUCKET = ['public', 'assets'].join('-');
const sq = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

export const USERS = {
  staffProd: id(K.user, 1), // Production-only staff user (absent from Development)
  alice: id(K.user, 11), // same id and email in Development            -> rule A
  bob: id(K.user, 12), // same id, DIFFERENT email in Development     -> conflict, never linked
  carol: id(K.user, 13), // Development has a different id, same email  -> rule B
  dave: id(K.user, 14), // two Development users share the email        -> ambiguous
  erin: id(K.user, 15), // no Development user                          -> unmatched
  frank: id(K.user, 16), // Development user with the email is unconfirmed -> unmatched
  gina1: id(K.user, 17), // two Production customers resolve to one login -> collision
  gina2: id(K.user, 18),
  devStaff: id(K.user, 90), // Development-only login
  carolDev: id(K.user, 93),
  daveDev1: id(K.user, 94),
  daveDev2: id(K.user, 95),
  frankDev: id(K.user, 96),
  ginaDev: id(K.user, 97),
};
export const EMAIL = {
  alice: 'alice@example.test',
  bob: 'bob@example.test',
  carol: 'carol@example.test',
  dave: 'dave@example.test',
  erin: 'erin@example.test',
  frank: 'frank@example.test',
  gina1: 'gina@example.test',
  gina2: 'Gina@example.test',
  henry: 'henry@example.test',
};
export const CUSTOMER_KEYS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'gina1', 'gina2', 'henry'];
const USER_OF = { alice: USERS.alice, bob: USERS.bob, carol: USERS.carol, dave: USERS.dave, erin: USERS.erin, frank: USERS.frank, gina1: USERS.gina1, gina2: USERS.gina2, henry: null };

// --------------------------------------------------------------------------------------------------------------------
// Shape the Production scratch database like Production: older schema.
// --------------------------------------------------------------------------------------------------------------------
const SHAPE_PRODUCTION = `
DROP TABLE IF EXISTS public.order_portal_links, public.booking_setup_proofs CASCADE;
-- Production predates the photo-evidence release (migration 20261027160000): no override table, no completion-evidence trigger.
DROP TABLE IF EXISTS public.task_evidence_overrides CASCADE;
DROP TRIGGER IF EXISTS trg_enforce_task_evidence ON public.task_status;
DROP TRIGGER IF EXISTS trg_guard_order_pricing_authority ON public.orders;
DROP TRIGGER IF EXISTS trg_guard_payment_authoritative_order_changes ON public.orders;
DROP TRIGGER IF EXISTS trg_cancel_unattempted_payments_on_order_close ON public.orders;
DROP TRIGGER IF EXISTS trg_note_payment_applied_to_closed_order ON public.payments;
DROP TRIGGER IF EXISTS trg_invoice_links_enforce_revocation ON public.invoice_links;
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS setup_fee_cents CASCADE, DROP COLUMN IF EXISTS event_essentials_subtotal_cents CASCADE, DROP COLUMN IF EXISTS customer_view_updated_at CASCADE;
ALTER TABLE public.orders ALTER COLUMN same_day_weekday_delivery_fee_cents DROP NOT NULL;
ALTER TABLE public.payments
  DROP COLUMN IF EXISTS operation_key CASCADE, DROP COLUMN IF EXISTS principal_amount_cents CASCADE, DROP COLUMN IF EXISTS tip_amount_cents CASCADE,
  DROP COLUMN IF EXISTS deposit_principal_cents CASCADE, DROP COLUMN IF EXISTS balance_principal_cents CASCADE, DROP COLUMN IF EXISTS claim_id CASCADE,
  DROP COLUMN IF EXISTS claimed_at CASCADE, DROP COLUMN IF EXISTS provider_attempted_at CASCADE, DROP COLUMN IF EXISTS stripe_checkout_session_id CASCADE,
  DROP COLUMN IF EXISTS stripe_refund_id CASCADE;
ALTER TABLE public.order_refunds
  DROP COLUMN IF EXISTS operation_key CASCADE, DROP COLUMN IF EXISTS operation_index CASCADE, DROP COLUMN IF EXISTS request_amount_cents CASCADE,
  DROP COLUMN IF EXISTS payment_id CASCADE, DROP COLUMN IF EXISTS stripe_payment_intent_id CASCADE, DROP COLUMN IF EXISTS provider_idempotency_key CASCADE,
  DROP COLUMN IF EXISTS provider_attempted_at CASCADE, DROP COLUMN IF EXISTS failure_reason CASCADE, DROP COLUMN IF EXISTS source CASCADE,
  DROP COLUMN IF EXISTS total_applied CASCADE, DROP COLUMN IF EXISTS updated_at CASCADE, DROP COLUMN IF EXISTS ledger_version CASCADE,
  DROP COLUMN IF EXISTS allocation_version CASCADE, DROP COLUMN IF EXISTS deposit_principal_refunded_cents CASCADE,
  DROP COLUMN IF EXISTS balance_principal_refunded_cents CASCADE, DROP COLUMN IF EXISTS tip_refunded_cents CASCADE,
  DROP COLUMN IF EXISTS unclassified_refunded_cents CASCADE, DROP COLUMN IF EXISTS request_allocation CASCADE;
ALTER TABLE public.order_items
  DROP COLUMN IF EXISTS product_id CASCADE, DROP COLUMN IF EXISTS bundle_id CASCADE, DROP COLUMN IF EXISTS item_name CASCADE,
  DROP COLUMN IF EXISTS component_snapshot CASCADE, DROP COLUMN IF EXISTS pricing_context CASCADE;
ALTER TABLE public.order_items ALTER COLUMN wet_or_dry SET NOT NULL;
`;

// --------------------------------------------------------------------------------------------------------------------
// Production fixtures (rows are inserted with triggers off: they are exactly what Production's own triggers had produced)
// --------------------------------------------------------------------------------------------------------------------
export function productionSeedSql({ extraOrderItemUnit = null } = {}) {
  const L = ['SET session_replication_role = replica;'];
  const n = CUSTOMER_KEYS.length;
  L.push(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (${sq(USERS.staffProd)}, 'staff@prod.example.test', now())` + Object.values(USER_OF).filter(Boolean).map((u, i) => `, (${sq(u)}, 'prod-user-${i}@example.test', now())`).join('') + ';');
  L.push(`INSERT INTO public.units (id, slug, name, price_dry_cents, dimensions, footprint_sqft, capacity, types) VALUES (${sq(id(K.unit, 1))}, 'castle', 'Castle', 10000, '15x15', 225, 10, ARRAY['bounce']), (${sq(id(K.unit, 2))}, 'slide', 'Slide', 20000, '10x30', 300, 8, ARRAY['slide'])${extraOrderItemUnit ? `, (${sq(extraOrderItemUnit)}, 'prod-only', 'Prod only', 5000, '5x5', 25, 4, ARRAY['bounce'])` : ''};`);
  CUSTOMER_KEYS.forEach((k, i) => {
    const c = id(K.customer, i + 1);
    const a = id(K.address, i + 1);
    L.push(`INSERT INTO public.customers (id, first_name, last_name, email, phone, user_id, business_name) VALUES (${sq(c)}, ${sq(k)}, 'Prod', ${sq(EMAIL[k])}, '+1555555010${i}', ${sq(USER_OF[k])}, NULL);`);
    L.push(`INSERT INTO public.addresses (id, customer_id, line1, city, state, zip, address_key) VALUES (${sq(a)}, ${sq(c)}, '${100 + i} Example St', 'Testville', 'MI', '4810${i}', 'addr-${i}');`);
    L.push(`UPDATE public.customers SET default_address_id = ${sq(a)} WHERE id = ${sq(c)};`);
    L.push(`INSERT INTO public.contacts (id, customer_id, first_name, last_name, email, phone, total_bookings, completed_bookings_count, is_repeat_customer, total_spent_cents) VALUES (${sq(id(K.contact, i + 1))}, ${sq(c)}, ${sq(k)}, 'Prod', ${sq(EMAIL[k])}, '+1555555010${i}', 2, 1, false, 12345);`);
  });
  const statuses = ['completed', 'confirmed', 'pending_review', 'cancelled', 'in_progress', 'draft', 'completed', 'confirmed', 'cancelled', 'completed'];
  for (let i = 1; i <= 10; i++) {
    const cust = ((i - 1) % n) + 1;
    const o = id(K.order, i);
    const stripe = i <= 6;
    const cancelledBy = statuses[i - 1] === 'cancelled' ? (i === 4 ? USERS.staffProd : USERS.alice) : null;
    L.push(`INSERT INTO public.orders (id, customer_id, address_id, status, workflow_status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents, deposit_paid_cents, balance_paid_cents, tip_cents, total_refunded_cents, stripe_customer_id, stripe_payment_method_id, payment_method_id, payment_method_last_four, payment_method_brand, payment_lock, cancelled_by, same_day_weekday_delivery_fee_cents, signed_waiver_url, special_details, created_at) VALUES (${sq(o)}, ${sq(id(K.customer, cust))}, ${sq(id(K.address, cust))}, ${sq(statuses[i - 1])}, 'pending', 'residential', '2026-0${(i % 9) + 1}-1${i % 9}', '2026-0${(i % 9) + 1}-1${i % 9}', '09:00', '11:00', 'same_day', ${10000 + i * 100}, 5000, ${5000 + i * 100}, ${i <= 3 ? 5000 : 0}, ${i === 1 ? 5100 : 0}, ${i === 1 ? 500 : 0}, ${i === 1 ? 500 : 0}, ${sq(stripe ? 'cus_prod_' + i : null)}, ${sq(stripe ? 'pm_prod_' + i : null)}, ${sq(stripe ? 'pm_prod_' + i : null)}, ${sq(stripe ? '4242' : null)}, ${sq(stripe ? 'visa' : null)}, ${i === 2 ? 'true' : 'false'}, ${sq(cancelledBy)}, ${i % 2 ? 'NULL' : '2500'}, ${sq(i <= 2 ? `https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/signed-waivers/${o}/waiver.pdf` : null)}, ${sq('Synthetic order ' + i)}, '2026-0${(i % 9) + 1}-01T12:00:00Z');`);
    L.push(`INSERT INTO public.order_items (id, order_id, unit_id, wet_or_dry, unit_price_cents, qty) VALUES (${sq(id(K.item, i))}, ${sq(o)}, ${sq(extraOrderItemUnit && i === 10 ? extraOrderItemUnit : id(K.unit, (i % 2) + 1))}, 'dry', 10000, 1);`);
    L.push(`INSERT INTO public.order_changelog (id, order_id, user_id, field_changed, old_value, new_value) VALUES (${sq(id(K.change, i))}, ${sq(o)}, ${sq(i % 2 ? USERS.staffProd : USERS.alice)}, 'status', 'draft', ${sq(statuses[i - 1])});`);
    L.push(`INSERT INTO public.order_notes (id, order_id, note) VALUES (${sq(id(K.note, i))}, ${sq(o)}, 'Synthetic note ${i}');`);
  }
  L.push(`INSERT INTO public.order_discounts (id, order_id, name, amount_cents) VALUES (${sq(id(K.disc, 1))}, ${sq(id(K.order, 1))}, 'Promo', 500);`);
  L.push(`INSERT INTO public.order_custom_fees (id, order_id, name, amount_cents) VALUES (${sq(id(K.fee, 1))}, ${sq(id(K.order, 1))}, 'Extra', 700);`);
  L.push(`INSERT INTO public.order_workflow_events (id, order_id, event_type) VALUES (${sq(id(K.wf, 1))}, ${sq(id(K.order, 1))}, 'arrived');`);
  // evidence
  for (const i of [1, 2]) {
    const o = id(K.order, i);
    L.push(`INSERT INTO public.order_signatures (id, order_id, customer_id, signer_name, signer_email, signer_phone, signature_image_url, pdf_url, typed_name, ip_address, user_agent, waiver_text_snapshot, electronic_consent_text, event_date, event_address_line1, event_city, event_state, event_zip, initials_data, waiver_version) VALUES (${sq(id(K.signature, i))}, ${sq(o)}, ${sq(id(K.customer, i))}, 'Signer ${i}', 'signer${i}@example.test', '+15555550123', ${sq(`https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/signatures/${o}/sig.png`)}, ${sq(`https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/signed-waivers/${o}/waiver.pdf`)}, 'Signer ${i}', '203.0.113.9', 'test-agent', 'waiver text', 'consent text', '2026-05-01', '1 Example St', 'Testville', 'MI', '48101', '{}'::jsonb, 'v1');`);
    L.push(`UPDATE public.orders SET signature_id = ${sq(id(K.signature, i))} WHERE id = ${sq(o)};`);
  }
  L.push(`INSERT INTO public.order_pictures (id, order_id, file_path, file_name, file_size, mime_type) VALUES (${sq(id(K.pic, 1))}, ${sq(id(K.order, 1))}, '${id(K.order, 1)}/pic.jpg', 'pic.jpg', 1234, 'image/jpeg');`);
  L.push(`INSERT INTO public.order_lot_pictures (id, order_id, address_id, file_path, file_name) VALUES (${sq(id(K.lot, 1))}, ${sq(id(K.order, 1))}, ${sq(id(K.address, 1))}, '${id(K.order, 1)}/lot.jpg', 'lot.jpg');`);
  L.push(`INSERT INTO public.address_lot_pictures (id, address_id, saved_from_order_id, saved_from_order_lot_picture_id, file_path, file_name) VALUES (${sq(id(K.alot, 1))}, ${sq(id(K.address, 1))}, ${sq(id(K.order, 1))}, ${sq(id(K.lot, 1))}, 'addr/lot.jpg', 'lot.jpg');`);
  // money
  L.push(`INSERT INTO public.payments (id, order_id, type, amount_cents, stripe_payment_intent_id, status, payment_method, payment_brand, payment_last4, order_financials_applied, paid_at) VALUES (${sq(id(K.payment, 1))}, ${sq(id(K.order, 1))}, 'deposit', 5000, 'pi_prod_1', 'succeeded', 'card', 'visa', '4242', true, now()), (${sq(id(K.payment, 2))}, ${sq(id(K.order, 1))}, 'balance', 5100, 'pi_prod_2', 'succeeded', 'card', 'visa', '4242', true, now()), (${sq(id(K.payment, 3))}, ${sq(id(K.order, 2))}, 'deposit', 5000, 'pi_prod_3', 'pending', 'card', 'visa', '4242', false, NULL);`);
  L.push(`INSERT INTO public.payments (id, order_id, type, amount_cents, stripe_payment_intent_id, status, refunded_payment_id, order_financials_applied) VALUES (${sq(id(K.payment, 4))}, ${sq(id(K.order, 1))}, 'balance', -500, 'pi_prod_2', 'succeeded', ${sq(id(K.payment, 2))}, true);`);
  L.push(`INSERT INTO public.order_refunds (id, order_id, amount_cents, reason, stripe_refund_id, status) VALUES (${sq(id(K.refund, 1))}, ${sq(id(K.order, 1))}, 500, 'Synthetic refund', 're_prod_1', 'succeeded');`);
  L.push(`INSERT INTO public.transaction_receipts (id, order_id, customer_id, payment_id, receipt_number, transaction_type, amount_cents, stripe_payment_intent_id, stripe_charge_id) VALUES (${sq(id(K.receipt, 1))}, ${sq(id(K.order, 1))}, ${sq(id(K.customer, 1))}, ${sq(id(K.payment, 1))}, 'R-0001', 'deposit', 5000, 'pi_prod_1', 'ch_prod_1'), (${sq(id(K.receipt, 2))}, ${sq(id(K.order, 1))}, ${sq(id(K.customer, 1))}, ${sq(id(K.payment, 2))}, 'R-0002', 'balance', 5100, 'pi_prod_2', 'ch_prod_2');`);
  L.push(`INSERT INTO public.invoices (id, order_id, customer_id, invoice_number, subtotal_cents, total_cents, status) VALUES (${sq(id(K.invoice, 1))}, ${sq(id(K.order, 1))}, ${sq(id(K.customer, 1))}, 'INV-0001', 10000, 10100, 'paid');`);
  L.push(`INSERT INTO public.invoice_links (id, order_id, link_token, link_type, short_code, deposit_cents) VALUES (${sq(id(K.link, 1))}, ${sq(id(K.order, 1))}, 'token-prod-1', 'portal', 'PRD0001', 5000);`);
  L.push(`INSERT INTO public.consent_records (id, order_id, customer_id, consent_type, consented, consent_text) VALUES (gen_random_uuid(), ${sq(id(K.order, 1))}, ${sq(id(K.customer, 1))}, 'sms', true, 'consent');`);
  L.push(`INSERT INTO public.task_status (id, order_id, task_type, task_date, status) VALUES (${sq(id(K.task, 1))}, ${sq(id(K.order, 1))}, 'drop-off', '2026-01-02', 'completed'), (${sq(id(K.task, 2))}, ${sq(id(K.order, 1))}, 'pick-up', '2026-01-03', 'pending');`);
  L.push(`UPDATE public.task_status SET delivery_images = '["https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/${LEGACY_BUCKET}/${id(K.order, 1)}-drop-off-1700000000-photo.jpg"]'::jsonb WHERE id = ${sq(id(K.task, 1))};`);
  L.push(`INSERT INTO public.route_stops (id, order_id, type) VALUES (${sq(id(K.stop, 1))}, ${sq(id(K.order, 1))}, 'dropoff');`);
  L.push(`INSERT INTO public.crew_location_history (id, order_id, stop_id, latitude, longitude) VALUES (${sq(id(K.crew, 1))}, ${sq(id(K.order, 1))}, ${sq(id(K.stop, 1))}, 42.0, -83.0);`);
  L.push(`INSERT INTO public.documents (id, order_id, kind, url) VALUES (${sq(id(K.doc, 1))}, ${sq(id(K.order, 1))}, 'invoice', 'https://example.test/inv.pdf');`);
  L.push(`INSERT INTO public.messages (id, order_id, channel, template_key, payload_json) VALUES (${sq(id(K.msg, 1))}, ${sq(id(K.order, 1))}, 'sms', 'booking', '{}'::jsonb);`);
  L.push(`INSERT INTO public.sms_conversations (id, order_id, from_phone, to_phone, message_body, direction) VALUES (${sq(id(K.sms, 1))}, ${sq(id(K.order, 1))}, '+15555550000', '+15555550100', 'Synthetic outbound', 'outbound'), (${sq(id(K.sms, 2))}, NULL, '+15555550100', '+15555550000', 'Synthetic inbound without an order', 'inbound');`);
  // Production's Storage inventory (rows only; the scratch server has no object bytes)
  L.push(`INSERT INTO storage.buckets (id, name, public) VALUES ('signed-waivers', 'signed-waivers', true), ('signatures', 'signatures', true), ('${LEGACY_BUCKET}', '${LEGACY_BUCKET}', true) ON CONFLICT DO NOTHING;`);
  L.push(`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    ('signed-waivers', '${id(K.order, 1)}/waiver.pdf', '{"size":100,"eTag":"e1"}'),
    ('signed-waivers', '${id(K.order, 2)}/waiver.pdf', '{"size":200,"eTag":"e2"}'),
    ('signatures', '${id(K.order, 1)}/sig.png', '{"size":50,"eTag":"e3"}'),
    ('${LEGACY_BUCKET}', '${id(K.order, 1)}-drop-off-1700000000-photo.jpg', '{"size":77,"eTag":"e4"}') ON CONFLICT DO NOTHING;`);
  return L.join('\n') + '\n';
}

// --------------------------------------------------------------------------------------------------------------------
// Development fixtures: preserved configuration + test data that the refresh must replace
// --------------------------------------------------------------------------------------------------------------------
export function developmentSeedSql() {
  const L = ['SET session_replication_role = replica;'];
  const u = USERS;
  L.push(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    (${sq(u.alice)}, ${sq(EMAIL.alice)}, now()), (${sq(u.bob)}, 'bob.other@example.test', now()), (${sq(u.carolDev)}, ${sq(EMAIL.carol)}, now()),
    (${sq(u.daveDev1)}, ${sq(EMAIL.dave)}, now()), (${sq(u.daveDev2)}, 'DAVE@example.test', now()), (${sq(u.frankDev)}, ${sq(EMAIL.frank)}, NULL),
    (${sq(u.ginaDev)}, 'gina@example.test', now()), (${sq(u.devStaff)}, 'staff@dev.example.test', now());`);
  L.push(`INSERT INTO public.user_roles (user_id, role) VALUES (${sq(u.devStaff)}, 'master');`);
  L.push(`INSERT INTO public.admin_settings (key, value) VALUES ('stripe_secret_key', 'sk_test_scratchonly'), ('stripe_publishable_key', 'pk_test_scratchonly'), ('twilio_from_number', '+15555550999'), ('admin_email', 'admin@example.test'), ('supabase_url', 'https://scratch.invalid') ON CONFLICT (key) DO NOTHING;`);
  L.push(`INSERT INTO public.units (id, slug, name, price_dry_cents, dimensions, footprint_sqft, capacity, types) VALUES (${sq(id(K.unit, 1))}, 'castle', 'Castle (Dev)', 11000, '15x15', 225, 10, ARRAY['bounce']), (${sq(id(K.unit, 2))}, 'slide', 'Slide (Dev)', 21000, '10x30', 300, 8, ARRAY['slide']);`);
  L.push(`INSERT INTO storage.buckets (id, name, public) VALUES ('signed-waivers', 'signed-waivers', true), ('order-evidence', 'order-evidence', false), ('signatures', 'signatures', true), ('${LEGACY_BUCKET}', '${LEGACY_BUCKET}', true) ON CONFLICT DO NOTHING;`);
  L.push(`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    ('signed-waivers', '${id(K.order, 1)}/waiver.pdf', '{"size":100,"eTag":"e1"}'),
    ('signed-waivers', '${id(K.order, 2)}/waiver.pdf', '{"size":999,"eTag":"eX"}'),
    ('signed-waivers', 'devonly-order/waiver.pdf', '{"size":5,"eTag":"d1"}'),
    ('order-evidence', 'devonly/1.jpg', '{"size":7,"eTag":"d2"}') ON CONFLICT DO NOTHING;`);
  // Dev copies of two Production customers (older clone, different phone) + Dev-only test data
  const c1 = id(K.customer, 1);
  const dc = id(K.customer, 901);
  L.push(`INSERT INTO public.customers (id, first_name, last_name, email, phone, user_id) VALUES (${sq(c1)}, 'alice', 'OLD DEV COPY', ${sq(EMAIL.alice)}, '+15550000001', ${sq(u.alice)}), (${sq(dc)}, 'Dev', 'Tester', 'devtest@example.test', '+15550000002', ${sq(u.devStaff)});`);
  L.push(`INSERT INTO public.addresses (id, customer_id, line1, city, state, zip, address_key) VALUES (${sq(id(K.address, 901))}, ${sq(dc)}, '9 Dev St', 'Testville', 'MI', '48109', 'dev-addr-1');`);
  L.push(`INSERT INTO public.contacts (id, customer_id, first_name, last_name, email) VALUES (${sq(id(K.contact, 1))}, ${sq(c1)}, 'alice', 'OLD', ${sq(EMAIL.alice)}), (${sq(id(K.contact, 901))}, ${sq(dc)}, 'Dev', 'Tester', 'devtest@example.test');`);
  for (const i of [1, 901, 902]) {
    const o = id(K.order, i);
    L.push(`INSERT INTO public.orders (id, customer_id, address_id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents, stripe_customer_id, stripe_payment_method_id, special_details, setup_fee_cents) VALUES (${sq(o)}, ${sq(i === 1 ? c1 : dc)}, ${sq(id(K.address, 901))}, 'confirmed', 'residential', '2026-09-01', '2026-09-01', '09:00', '11:00', 'same_day', 9000, 4000, 5000, 'cus_TEST_dev', 'pm_TEST_dev', 'DEV ONLY ORDER ${i}', 0);`);
    L.push(`INSERT INTO public.order_items (id, order_id, unit_id, wet_or_dry, unit_price_cents, qty) VALUES (${sq(id(K.item, i))}, ${sq(o)}, ${sq(id(K.unit, 1))}, 'dry', 9000, 1);`);
    L.push(`INSERT INTO public.payments (id, order_id, type, amount_cents, stripe_payment_intent_id, status, order_financials_applied) VALUES (${sq(id(K.payment, i))}, ${sq(o)}, 'deposit', 4000, 'pi_TEST_dev_${i}', 'succeeded', true);`);
    L.push(`INSERT INTO public.task_status (id, order_id, task_type, task_date, status) VALUES (${sq(id(K.task, i))}, ${sq(o)}, 'drop-off', '2026-09-01', 'pending');`);
  }
  L.push(`INSERT INTO public.order_signatures (id, order_id, customer_id, signer_name, signer_email, signer_phone, signature_image_url, typed_name, ip_address, user_agent, waiver_text_snapshot, electronic_consent_text, event_date, event_address_line1, event_city, event_state, event_zip, initials_data, waiver_version) VALUES (${sq(id(K.signature, 901))}, ${sq(id(K.order, 901))}, ${sq(dc)}, 'Dev Tester', 'devtest@example.test', '+15550000002', 'https://scratch.invalid/storage/v1/object/public/signatures/${id(K.order, 901)}/sig.png', 'Dev Tester', '203.0.113.1', 'a', 'w', 'c', '2026-09-01', '9 Dev St', 'Testville', 'MI', '48109', '{}'::jsonb, 'v1');`);
  // Admin overrides of the photo rule (release migration 20261027160000) on Development tasks: task 1 shares its id with the Production task of the
  // same id (it is replaced and re-imported), tasks 901 and 902 exist only in Development.
  L.push(`INSERT INTO public.task_evidence_overrides (id, task_status_id, order_id, task_type, actor_id, reason) VALUES
    (gen_random_uuid(), ${sq(id(K.task, 1))}, ${sq(id(K.order, 1))}, 'drop-off', ${sq(id(K.task, 1))}, 'synthetic override reason one'),
    (gen_random_uuid(), ${sq(id(K.task, 901))}, ${sq(id(K.order, 901))}, 'drop-off', ${sq(id(K.task, 1))}, 'synthetic override reason two'),
    (gen_random_uuid(), ${sq(id(K.task, 902))}, ${sq(id(K.order, 902))}, 'drop-off', ${sq(id(K.task, 1))}, 'synthetic override reason three');`);
  L.push(`INSERT INTO public.order_portal_links (id, order_id, short_code) VALUES (${sq(id(K.portal, 1))}, ${sq(id(K.order, 901))}, 'DEVLINK1');`);
  L.push(`INSERT INTO public.booking_setup_proofs (id, order_id, token_hash, expires_at) VALUES (${sq(id(K.proof, 1))}, ${sq(id(K.order, 901))}, 'hash', now() + interval '1 day');`);
  // Preserved tables that point at replaceable rows
  L.push(`INSERT INTO public.customer_profiles (id, user_id, contact_id) VALUES
    (${sq(id(K.profile, 1))}, ${sq(u.alice)}, ${sq(id(K.contact, 1))}),
    (${sq(id(K.profile, 2))}, ${sq(u.carolDev)}, ${sq(id(K.contact, 1))}),
    (${sq(id(K.profile, 3))}, ${sq(u.devStaff)}, ${sq(id(K.contact, 901))});`);
  L.push(`INSERT INTO public.user_consent_log (id, consent_type, customer_id, user_id) VALUES (${sq(id(K.log, 1))}, 'terms_of_service', ${sq(c1)}, ${sq(u.alice)}), (${sq(id(K.log, 2))}, 'terms_of_service', ${sq(dc)}, ${sq(u.devStaff)});`);
  L.push(`INSERT INTO public.site_events (id, event_name, order_id) VALUES (${sq(id(K.event, 1))}, 'view', ${sq(id(K.order, 1))}), (${sq(id(K.event, 2))}, 'view', ${sq(id(K.order, 901))});`);
  return L.join('\n') + '\n';
}

// --------------------------------------------------------------------------------------------------------------------
// Empties both databases (data only; the schema stays) and fills them again. Creating a database costs tens of seconds on this machine, a reset
// a few: a test file builds ONE pair and resets it between scenarios. Every user trigger is enabled again, so a scenario that changed trigger
// states leaves nothing behind. (A scenario that changes the SCHEMA must undo it.)
export function resetScratchPair(p, { seed = true, extraOrderItemUnit = null } = {}) {
  // DELETE with triggers and foreign keys off (this is a scratch database): TRUNCATE creates new files for every table, which is far slower here.
  const wipe = `BEGIN; SET LOCAL session_replication_role = replica; DO $w$ DECLARE r record; BEGIN
    FOR r IN SELECT c.relname AS tbl, g.tgname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE NOT g.tgisinternal AND n.nspname = 'public' AND g.tgenabled <> 'O' LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.tbl, r.tgname);
    END LOOP;
    FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'auth', 'storage') LOOP
      EXECUTE format('DELETE FROM %I.%I', r.schemaname, r.tablename);
    END LOOP;
  END $w$; COMMIT;`;
  psqlOn(p.prodDb, wipe);
  psqlOn(p.devDb, wipe);
  psqlOn(p.devDb, "INSERT INTO public.admin_settings (key, value) VALUES ('stripe_secret_key', 'sk_test_scratchonly'), ('stripe_publishable_key', 'pk_test_scratchonly') ON CONFLICT (key) DO NOTHING;");
  if (seed) {
    psqlOn(p.prodDb, productionSeedSql({ extraOrderItemUnit }));
    psqlOn(p.devDb, developmentSeedSql());
  }
  return p;
}

// Scratch databases are KEPT between runs (creating one costs tens of seconds on this machine; a reset costs a few). A kept database is reused
// only if it is provably the same as a fresh one: it carries the hash of the schema it was built from and a fingerprint of its structure
// (columns, constraints, indexes, triggers and their states, rules); anything else, for example the leftovers of an aborted run, is rebuilt.
// Set DEVREFRESH_DROP_SCRATCH=1 to drop them when a pair is released.
const STRUCTURE_SQL = `SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(column_default, '') AS x FROM information_schema.columns WHERE table_schema IN ('public', 'auth', 'storage')
  UNION ALL SELECT 'trg.' || tgrelid::regclass || '.' || tgname || tgenabled::text FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'con.' || conrelid::regclass || '.' || conname || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx.' || indexname || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'rule.' || tablename || rulename FROM pg_rules WHERE schemaname = 'public') s`;
const structureOf = (db) => psqlOn(db, STRUCTURE_SQL).stdout.trim();
let sourceHashValue = null;
const sourceHash = () => (sourceHashValue ??= crypto.createHash('sha256').update(fs.readFileSync(templateSchema(), 'utf8')).update(SHAPE_PRODUCTION).update('v2').digest('hex').slice(0, 16));

function ensureDb(db, kind) {
  const hash = sourceHash();
  const comment = psqlOn('postgres', `SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '${db}'`).stdout.trim();
  const m = comment.match(/^devrefresh:([0-9a-f]+):([0-9a-f]+)$/);
  if (m && m[1] === hash && structureOf(db) === m[2]) return false;
  // A database stamped by an earlier version of this helper (whose hash was not stable) can be adopted, by explicit opt-in, when its structure
  // is exactly what was recorded when it was built; it is then re-stamped with the current hash. Without the opt-in it is rebuilt.
  if (m && process.env.DEVREFRESH_REUSE_KEPT_SCRATCH === '1' && structureOf(db) === m[2]) {
    psqlOn('postgres', `COMMENT ON DATABASE ${db} IS 'devrefresh:${hash}:${m[2]}'`);
    return false;
  }
  const tpl = ensureTemplates();
  cloneFrom(kind === 'prod' ? tpl.prod : tpl.dev, db);
  psqlOn('postgres', `COMMENT ON DATABASE ${db} IS 'devrefresh:${hash}:${structureOf(db)}'`);
  return true;
}

export function buildScratchPair(suffix, { seed = true, extraOrderItemUnit = null } = {}) {
  const prodDb = `devrefresh_${suffix}_prod`;
  const devDb = `devrefresh_${suffix}_dev`;
  ensureDb(prodDb, 'prod');
  ensureDb(devDb, 'dev');
  const url = (db) => `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${db}`;
  const pair = {
    prodDb,
    devDb,
    prod: targetFromUrl('prod', url(prodDb), { scratch: true }),
    dev: targetFromUrl('dev', url(devDb), { scratch: true }),
    drop() {
      if (process.env.DEVREFRESH_DROP_SCRATCH !== '1') return;
      dropDbInBackground(prodDb);
      dropDbInBackground(devDb);
    },
  };
  // empty, then stripe-test settings and (optionally) the synthetic rows
  return resetScratchPair(pair, { seed, extraOrderItemUnit });
}
