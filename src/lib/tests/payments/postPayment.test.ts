// WP-30 (B4): server-owned post-payment completion. After a deposit charge the order confirmation, the transaction receipts, the invoice
// row, the customer email and the customer text are done by the server, once per payment, even if the Admin's browser is closed or the
// charging request is cut off. Runs the CURRENT Edge Function source against a fake Stripe and a REAL scratch PostgreSQL database
// (payments, orders, receipts and invoices are real tables), so the real lease functions, unique indexes and row locks decide each outcome.
// Nothing here reaches the network, a Supabase project or real Stripe.
//
// With no reachable scratch database the whole file is SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes that a failure.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit(code: number): never };
const fs = require('fs');

import * as authHelpers from '../../../../supabase/functions/_shared/auth';
import * as payOps from '../../../../supabase/functions/_shared/payments/payment-operations';
import * as outcomeHelpers from '../../../../supabase/functions/_shared/orders/lifecycle-outcome';
import * as bookingProofHelpers from '../../../../supabase/functions/_shared/booking/bookingProof';
import * as returnOriginHelpers from '../../../../supabase/functions/_shared/booking/returnOrigin';
import { PgPool, PG_TABLES, baseScope, ensurePayDatabase, makeWorld, makeClient, loadHandler, loadModule, callHandler, lit, type World } from '../support/paymentHarness';

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

const TAG = String((Date.now() % 1e6) * 1000 + (process as any).pid % 1000).padStart(9, '0');
let counter = 0;
const nextId = () => `ddddddd1-0000-4000-8000-${TAG}${String(++counter).padStart(3, '0')}`;
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

(async () => {
  const db = ensurePayDatabase();
  if (!db) {
    if (process.env.ROLE_DB_REQUIRE) ok('executed: the scratch payment database is available (ROLE_DB_REQUIRE is set)', false);
    else console.log('Post-payment tests SKIPPED: the scratch database was not reachable.');
    finish();
    return;
  }
  const pg = new PgPool(db.psql, db.db, 8);
  const shared = { ...authHelpers, ...outcomeHelpers, ...bookingProofHelpers, ...returnOriginHelpers, ...payOps };

  // ---- fixtures --------------------------------------------------------------------------------------------------------------
  const newWorld = (): World => {
    const w = makeWorld(pg);
    w.pgTables = new Set([...PG_TABLES, 'transaction_receipts', 'invoices']);
    return w;
  };
  async function seedOrder(w: World, seed: { tip?: number; phone?: string | null; setupFee?: number } = {}): Promise<{ orderId: string; customerId: string }> {
    const orderId = nextId();
    const customerId = nextId();
    await pg.exec(`INSERT INTO public.customers (id, first_name, last_name, email, phone) VALUES (${lit(customerId)}, 'Pat', 'Lee', ${lit(`${customerId}@payment-tests.example`)}, '5555550100');`);
    const cols: Record<string, unknown> = {
      id: orderId, status: 'pending_review', location_type: 'residential', event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '12:00',
      subtotal_cents: 15000, setup_fee_cents: seed.setupFee ?? 0, deposit_due_cents: 5000, deposit_paid_cents: 0, balance_due_cents: 10000, balance_paid_cents: 0, tip_cents: seed.tip ?? 0,
      pickup_preference: 'same_day', stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_card', customer_id: customerId,
    };
    const keys = Object.keys(cols);
    await pg.exec(`INSERT INTO public.orders (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((k) => lit(cols[k])).join(', ')});`);
    await pg.exec(`INSERT INTO public.invoice_links (order_id, link_type, link_token, expires_at) VALUES (${lit(orderId)}, 'portal', ${lit(`tok-${orderId}`)}, ${lit(FUTURE)});`);
    w.embeds.orders = {
      customers: { email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee', phone: seed.phone === undefined ? '5555550100' : seed.phone },
      addresses: { line1: '1 Main', city: 'Town', state: 'MI', zip: '48000' },
      order_items: [],
      order_custom_fees: [],
    };
    return { orderId, customerId };
  }
  const payRows = async (orderId: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.payments t WHERE order_id = '${orderId}' ORDER BY created_at`)).map((r: any) => r.j);
  const receipts = async (orderId: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.transaction_receipts t WHERE order_id = '${orderId}' ORDER BY transaction_type`)).map((r: any) => r.j);
  const invoices = async (orderId: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.invoices t WHERE order_id = '${orderId}'`)).map((r: any) => r.j);
  const calls = (w: World, name: string) => w.invokes.filter((i) => i.name === name);
  const accept = (w: World, orderId: string) => callHandler(loadHandler('charge-deposit', w, shared), { orderId }, 'jwt-admin');
  const webhook = async (w: World) => {
    const handlers = loadModule('supabase/functions/stripe-webhook/handlers.ts', w, shared);
    const client = makeClient(w);
    return { succeeded: (pi: any) => handlers.handlePaymentIntentSucceeded(pi, client, w.stripe), client };
  };
  // The same real module (real receipt logger, real arithmetic) the handlers get.
  const completion = (w: World) => ({ completePostPayment: baseScope(w).completePostPayment as (db: any, paymentId: string) => Promise<any> });

  // =================================================================================================================
  // 1. An admin approval is completed by the server, in the same request
  // =================================================================================================================
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w, { tip: 2000 });
    const r = await accept(w, orderId);
    eq('approval: the request succeeds', [r.status, r.json?.success], [200, true]);
    const [payment] = await payRows(orderId);
    ok('approval: the payment is marked complete and holds no lease', !!payment.post_completed_at && payment.post_claim_until === null);
    eq('approval: the deposit and tip receipts exist, one each, in one group', (await receipts(orderId)).map((x: any) => [x.transaction_type, x.amount_cents]), [['deposit', 5000], ['tip', 2000]]);
    const rs = await receipts(orderId);
    ok('approval: the two receipts share a group and name the payment', rs[0].receipt_group_id === rs[1].receipt_group_id && rs.every((x: any) => x.payment_id === payment.id));
    const inv = await invoices(orderId);
    eq('approval: exactly one invoice row, partial, with the deposit principal as paid', [inv.length, inv[0]?.status, inv[0]?.paid_amount_cents, inv[0]?.total_cents], [1, 'partial', 5000, 15000]);
    eq('approval: the order was confirmed once, as charged_now', calls(w, 'order-lifecycle').map((c) => [c.body.action, c.body.paymentOutcome]), [['enter_confirmed', 'charged_now']]);
    eq('approval: one confirmation email to the customer (not two)', calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, 1);
    const sms = calls(w, 'send-sms-notification');
    ok('approval: one confirmation text, to the customer, with the order number and a link', sms.length === 1 && sms[0].body.to === '5555550100' && /confirmed/.test(sms[0].body.message) && /portal\.fake/.test(sms[0].body.message) && sms[0].body.orderId === orderId);
    // Repeating the completion changes nothing
    const again = await completion(w).completePostPayment(makeClient(w), payment.id);
    eq('repeat: already completed', again.status, 'already_completed');
    eq('repeat: still one invoice, two receipts, one email, one text', [(await invoices(orderId)).length, (await receipts(orderId)).length, calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, calls(w, 'send-sms-notification').length], [1, 2, 1, 1]);
  }

  // =================================================================================================================
  // 2. The browser is closed / the request dies after the charge: the webhook finishes everything, and only once
  // =================================================================================================================
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w, { tip: 1000 });
    w.failRpc.finalize_payment_operation = { error: { message: 'db down' }, times: 1 };
    await accept(w, orderId); // the charge went through at Stripe; the request could not apply it
    const piId = (await payRows(orderId))[0].stripe_payment_intent_id;
    eq('no browser: nothing is recorded yet', [(await receipts(orderId)).length, (await invoices(orderId)).length, calls(w, 'send-email').length], [0, 0, 0]);
    const wh = await webhook(w);
    await wh.succeeded(w.stripe.paymentIntents_[piId]);
    eq('no browser: the webhook recorded the receipts', (await receipts(orderId)).map((x: any) => x.transaction_type), ['deposit', 'tip']);
    eq('no browser: the webhook created the invoice', (await invoices(orderId)).length, 1);
    eq('no browser: one confirmation email and one text', [calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, calls(w, 'send-sms-notification').length], [1, 1]);
    // Stripe redelivers the same event: nothing is repeated
    await wh.succeeded(w.stripe.paymentIntents_[piId]);
    eq('redelivery: still two receipts, one invoice, one email, one text', [(await receipts(orderId)).length, (await invoices(orderId)).length, calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, calls(w, 'send-sms-notification').length], [2, 1, 1, 1]);
  }

  // The request that charged the card applied the payment but was cut off before completing: the webhook (which finds it applied) completes it.
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    // The request applies the payment but its completion is lost: simulate by running the charge with the completion invoke failing at the lifecycle.
    w.invokeHandlers['order-lifecycle'] = () => { throw new Error('function runtime killed'); };
    const r = await accept(w, orderId);
    ok('cut off: the charge still reports success to the browser', r.status === 200 && r.json?.success === true);
    const [payment] = await payRows(orderId);
    ok('cut off: the completion was left pending (lease released, not complete)', payment.post_completed_at === null && payment.post_claim_until === null);
    eq('cut off: no email or text went out before the records existed', [calls(w, 'send-email').length, calls(w, 'send-sms-notification').length], [0, 0]);
    // the lifecycle recovers; the webhook arrives for the already-applied payment
    delete w.invokeHandlers['order-lifecycle'];
    const wh = await webhook(w);
    await wh.succeeded(w.stripe.paymentIntents_[payment.stripe_payment_intent_id]);
    const [done] = await payRows(orderId);
    ok('cut off: the webhook delivery completed it', !!done.post_completed_at);
    eq('cut off: one invoice, one deposit receipt, one email, one text', [(await invoices(orderId)).length, (await receipts(orderId)).length, calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, calls(w, 'send-sms-notification').length], [1, 1, 1, 1]);
  }

  // The webhook must not acknowledge a delivery whose completion failed, so Stripe redelivers it.
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    w.invokeHandlers['order-lifecycle'] = () => { throw new Error('function runtime killed'); };
    await accept(w, orderId);
    const [payment] = await payRows(orderId);
    const wh = await webhook(w);
    let thrown: any = null;
    try { await wh.succeeded(w.stripe.paymentIntents_[payment.stripe_payment_intent_id]); } catch (e) { thrown = e; }
    ok('redelivery: a delivery whose completion failed is not acknowledged (it throws)', !!thrown && /post-payment completion/.test(String(thrown?.message)));
    delete w.invokeHandlers['order-lifecycle'];
    await wh.succeeded(w.stripe.paymentIntents_[payment.stripe_payment_intent_id]);
    const [done] = await payRows(orderId);
    ok('redelivery: the next delivery completes it', !!done.post_completed_at);
  }

  // =================================================================================================================
  // 3. A failing record step leaves the work retryable and repeats nothing that already happened
  // =================================================================================================================
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w, { tip: 500 });
    w.failTable.push({ table: 'invoices', op: 'insert', error: { message: 'invoices unavailable' }, times: 1 });
    await accept(w, orderId);
    const [first] = await payRows(orderId);
    ok('failing invoice: not complete, lease released', first.post_completed_at === null && first.post_claim_until === null);
    eq('failing invoice: receipts were written once and no customer message went out yet', [(await receipts(orderId)).length, calls(w, 'send-email').length, calls(w, 'send-sms-notification').length], [2, 0, 0]);
    const retry = await completion(w).completePostPayment(makeClient(w), first.id);
    eq('retry: completed', retry.status, 'completed');
    eq('retry: receipts not duplicated, invoice created, one email, one text', [(await receipts(orderId)).length, (await invoices(orderId)).length, calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, calls(w, 'send-sms-notification').length], [2, 1, 1, 1]);
    eq('retry: the order was confirmed through the lifecycle on both attempts (it is idempotent there)', calls(w, 'order-lifecycle').length, 2);
  }

  // =================================================================================================================
  // 4. Concurrency: two workers, one set of side effects
  // =================================================================================================================
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    // Apply the payment without completing it: a webhook-less setup through the claim functions directly
    await accept(w, orderId);
    const [payment] = await payRows(orderId);
    await pg.exec(`UPDATE public.payments SET post_completed_at = NULL, post_claim_until = NULL WHERE id = '${payment.id}'; DELETE FROM public.transaction_receipts WHERE order_id = '${orderId}'; DELETE FROM public.invoices WHERE order_id = '${orderId}';`);
    const before = { confirmEmails: calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, sms: calls(w, 'send-sms-notification').length };
    const [a, b] = await Promise.all([completion(w).completePostPayment(makeClient(w), payment.id), completion(w).completePostPayment(makeClient(w), payment.id)]);
    const statuses = [a.status, b.status].sort();
    ok('concurrent: exactly one worker completed it; the other was told busy (or already done)', statuses.filter((x) => x === 'completed').length === 1 && statuses.every((x) => x === 'completed' || x === 'busy' || x === 'already_completed'));
    eq('concurrent: one invoice, one deposit receipt', [(await invoices(orderId)).length, (await receipts(orderId)).length], [1, 1]);
    eq('concurrent: exactly one more email and one more text', [calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length - before.confirmEmails, calls(w, 'send-sms-notification').length - before.sms], [1, 1]);
  }
  // =================================================================================================================
  // 5. What the completion refuses to do
  // =================================================================================================================
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    await accept(w, orderId);
    const [payment] = await payRows(orderId);
    const notFound = await completion(w).completePostPayment(makeClient(w), nextId());
    eq('unknown payment: not found', notFound.status, 'not_found');
    await pg.exec(`UPDATE public.payments SET post_completed_at = NULL, post_claim_until = now() + interval '5 minutes' WHERE id = '${payment.id}';`);
    eq('live lease held by another worker: busy, nothing done', (await completion(w).completePostPayment(makeClient(w), payment.id)).status, 'busy');
    await pg.exec(`UPDATE public.payments SET post_claim_until = now() - interval '1 minute' WHERE id = '${payment.id}';`);
    const expired = await completion(w).completePostPayment(makeClient(w), payment.id);
    ok('expired lease (a crashed worker): taken over and completed', expired.status === 'completed');
    await pg.exec(`UPDATE public.payments SET type = 'balance', post_completed_at = NULL WHERE id = '${payment.id}';`);
    eq('a balance payment is not applicable', (await completion(w).completePostPayment(makeClient(w), payment.id)).status, 'not_applicable');
    await pg.exec(`UPDATE public.payments SET type = 'deposit', status = 'pending' WHERE id = '${payment.id}';`);
    eq('a payment that did not succeed is not applicable', (await completion(w).completePostPayment(makeClient(w), payment.id)).status, 'not_applicable');
  }
  {
    // No customer phone: no text. A customer without a record: receipts skipped, the rest completes.
    const w = newWorld();
    const { orderId } = await seedOrder(w, { phone: '' });
    await accept(w, orderId);
    eq('no phone: no text, email still sent, complete', [calls(w, 'send-sms-notification').length, calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, !!(await payRows(orderId))[0].post_completed_at], [0, 1, true]);
  }
  {
    // order-lifecycle refuses logically (the order was cancelled after the payment): no endless retry, the rest completes
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    w.invokeHandlers['order-lifecycle'] = () => ({ data: { success: false, error: 'Cannot enter confirmed from status: cancelled' }, error: null });
    await accept(w, orderId);
    const [p] = await payRows(orderId);
    ok('lifecycle refusal is logged but does not block completion', !!p.post_completed_at);
  }
  {
    // A failing email is attempted once and recorded, never retried; the payment is still complete
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    w.invokeHandlers['send-email'] = () => ({ data: null, error: { message: 'provider down' } });
    await accept(w, orderId);
    const [p] = await payRows(orderId);
    ok('email failure: complete anyway (the relay records the failure)', !!p.post_completed_at);
    eq('email failure: attempted once', calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length, 1);
  }

  // =================================================================================================================
  // 6. The receipt uniqueness repair (M-4)
  // =================================================================================================================
  {
    const w = newWorld();
    const a = await seedOrder(w);
    const b = await seedOrder(w);
    const insert = async (orderId: string, customerId: string, type: string, piId: string | null) => {
      const cols = piId ? ', stripe_payment_intent_id' : '';
      const vals = piId ? `, ${lit(piId)}` : '';
      const r = await pg.query(`INSERT INTO public.transaction_receipts (transaction_type, order_id, customer_id, amount_cents${cols}) VALUES (${lit(type)}, ${lit(orderId)}, ${lit(customerId)}, 1000${vals}) RETURNING to_jsonb(1) AS j`);
      return r && r.__error ? String(r.__error) : null;
    };
    eq('receipts: a cash-style receipt (no Stripe ids) is recorded', await insert(a.orderId, a.customerId, 'balance', null), null);
    eq('receipts: a second one of the same type for ANOTHER order is no longer rejected', await insert(b.orderId, b.customerId, 'balance', null), null);
    eq('receipts: a Stripe receipt is recorded', await insert(a.orderId, a.customerId, 'deposit', `pi_dup_${TAG}`), null);
    ok('receipts: the same PaymentIntent and type cannot be recorded twice', /duplicate key|unique/i.test((await insert(b.orderId, b.customerId, 'deposit', `pi_dup_${TAG}`)) ?? ''));
    eq('receipts: the same PaymentIntent with another type (deposit + tip share a charge) is allowed', await insert(a.orderId, a.customerId, 'tip', `pi_dup_${TAG}`), null);
    const rows = await pg.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'transaction_receipts' AND indexname IN ('uq_transaction_receipts_pi_type','uq_transaction_receipts_charge_type','uq_transaction_receipts_payment_type')`);
    eq('receipts: the three partial unique indexes exist', rows[0].n, 3);
    const oldConstraints = await pg.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.transaction_receipts'::regclass AND conname IN ('unique_receipt_pi_type','unique_receipt_charge_type')`);
    eq('receipts: the NULLS NOT DISTINCT constraints are gone', oldConstraints[0].n, 0);
    await pg.exec(`DELETE FROM public.transaction_receipts WHERE order_id IN (${lit(a.orderId)}, ${lit(b.orderId)});`);
  }
  // =================================================================================================================
  // 7. Source wiring
  // =================================================================================================================
  {
    const read = (p: string) => fs.readFileSync(p, 'utf8');
    const charge = read('supabase/functions/charge-deposit/index.ts');
    ok('charge-deposit completes through the shared module and no longer sends the email itself', charge.includes('completePostPayment(supabaseClient, op.paymentId') && !charge.includes('async function sendDepositConfirmationEmail'));
    const handlers = read('supabase/functions/stripe-webhook/handlers.ts');
    ok('the webhook completes deposits on every delivery that finds them applied, and does not swallow a failure', handlers.includes('async function completeDepositOrFail') && /if \(!fin\.applied\) \{\s*await completeDepositOrFail/.test(handlers) && /if \(fin\.paymentType === "deposit"\) \{\s*await completeDepositOrFail\(supabaseClient, paymentId\);\s*return "applied";/.test(handlers));
    const sql = read('supabase/migrations/20261027130000_payment_post_completion.sql');
    ok('the migration is additive: new nullable columns, three service-role functions', /ADD COLUMN IF NOT EXISTS post_completed_at timestamptz/.test(sql) && /ADD COLUMN IF NOT EXISTS post_claim_until timestamptz/.test(sql) && (sql.match(/TO service_role/g) || []).length === 3 && !/DROP (TABLE|COLUMN)|TRUNCATE|DELETE FROM/i.test(sql));
    ok('the migration leaves payments created before it ran alone (cutoff baked in at apply time)', /v_row\.created_at < %L::timestamptz/.test(sql));
  }

  await pg.exec(`DELETE FROM public.payments WHERE order_id::text LIKE 'ddddddd1-0000-4000-8000-${TAG}%'; DELETE FROM public.invoices WHERE order_id::text LIKE 'ddddddd1-0000-4000-8000-${TAG}%'; DELETE FROM public.transaction_receipts WHERE order_id::text LIKE 'ddddddd1-0000-4000-8000-${TAG}%'; DELETE FROM public.invoice_links WHERE order_id::text LIKE 'ddddddd1-0000-4000-8000-${TAG}%'; DELETE FROM public.order_changelog WHERE order_id::text LIKE 'ddddddd1-0000-4000-8000-${TAG}%'; DELETE FROM public.orders WHERE id::text LIKE 'ddddddd1-0000-4000-8000-${TAG}%'; DELETE FROM public.customers WHERE id::text LIKE 'ddddddd1-0000-4000-8000-${TAG}%';`);
  pg.close();
  finish();
})().catch((e) => {
  console.error(e);
  failed++;
  finish();
});

function finish() {
  console.log(`Post-payment completion tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
