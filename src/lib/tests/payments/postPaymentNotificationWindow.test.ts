// WP-30 follow-up: the customer-notification failure window of the server-owned post-payment completion (stage B).
// Executed against the REAL scratch PostgreSQL (payments, lease functions) with mocked relays. It states exactly what is and is not guaranteed:
//   one charge ........................ Stripe idempotency key per payment operation (paymentOperations tests)
//   one stored payment/receipt/invoice  unique indexes + the lease + existence checks (postPayment.test.ts)
//   one ATTEMPTED notification ........ one stage B run per lease; a failed send is recorded by the relay, not retried
//   one DELIVERED notification ........ NOT guaranteed for email (at-least-once); best-effort for the text (sms_conversations row)
// PASS - LOCAL INTEGRATION / MOCKED relays. Real providers are REQUIRES HOSTED DEV VERIFICATION.
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
  const completion = (w: World) => ({ completePostPayment: baseScope(w).completePostPayment as (db: any, paymentId: string, options?: Record<string, unknown>) => Promise<any> });

  
  // The mocked relays behave like the real ones in the one way that matters here: send-sms-notification writes an outbound row to
  // sms_conversations after the provider accepted the text (an in-memory table in this world), and send-email writes nothing durable.
  const smsRow = (w: World, orderId: string, body: any) => {
    (w.tables.sms_conversations ??= []).push({ order_id: orderId, direction: 'outbound', to_phone: body.to, message_body: body.message, created_at: new Date(Date.now() + 1000).toISOString() });
  };
  const wireRelays = (w: World, orderId: string) => {
    w.invokeHandlers['send-sms-notification'] = (body: any) => { smsRow(w, orderId, body); return { data: { success: true }, error: null }; };
  };
  const confirmEmails = (w: World) => calls(w, 'send-email').filter((c) => /Booking Confirmed/.test(c.body?.subject ?? '')).length;
  const FAST = { finishRetryDelayMs: 0 };

  // =================================================================================================================
  // (a)+(b) The text and the email went out but the completion marker could not be written
  // =================================================================================================================
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    wireRelays(w, orderId);
    // Stripe applied the payment; the completion marker fails on every attempt of the first run (3 attempts)
    w.failRpc.finish_post_payment_completion = { error: { message: 'db blip' }, times: 3 };
    await accept(w, orderId);
    const [p1] = await payRows(orderId);
    ok('marker fails: the payment is NOT marked complete and its lease was handed back', p1.post_completed_at === null && p1.post_claim_until === null);
    eq('marker fails: the first run sent one email and one text', [confirmEmails(w), calls(w, 'send-sms-notification').length], [1, 1]);
    eq('marker fails: the records that matter exist exactly once', [(await receipts(orderId)).length, (await invoices(orderId)).length], [1, 1]);
    // The next trigger (a webhook delivery that finds the payment applied) completes it
    const wh = await webhook(w);
    try {
      await wh.succeeded(w.stripe.paymentIntents_[p1.stripe_payment_intent_id]);
    } catch (e) {
      ok('marker fails: the next trigger runs without error (' + String((e as Error).message) + ')', false);
    }
    const [p2] = await payRows(orderId);
    ok('marker fails: the next trigger completes it', !!p2.post_completed_at);
    eq('marker fails: the TEXT is not repeated (the earlier outbound row is found)', calls(w, 'send-sms-notification').length, 1);
    eq('marker fails: the EMAIL is sent again (no durable record of an email exists to check) - at-least-once, by design', confirmEmails(w), 2);
    eq('marker fails: still one receipt and one invoice', [(await receipts(orderId)).length, (await invoices(orderId)).length], [1, 1]);
    // Stripe redelivers once more: the payment is complete, nothing repeats
    await wh.succeeded(w.stripe.paymentIntents_[p1.stripe_payment_intent_id]);
    eq('redelivery after completion repeats nothing', [confirmEmails(w), calls(w, 'send-sms-notification').length], [2, 1]);
  }
  {
    // A transient marker failure is absorbed by the in-process retry: no repeat at all
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    wireRelays(w, orderId);
    w.failRpc.finish_post_payment_completion = { error: { message: 'db blip' }, times: 2 };
    await accept(w, orderId);
    const [p] = await payRows(orderId);
    ok('a marker that fails twice and then works completes in the same run', !!p.post_completed_at);
    eq('...with exactly one email and one text', [confirmEmails(w), calls(w, 'send-sms-notification').length], [1, 1]);
    eq('...the marker was attempted three times', w.rpcCalls.filter((c) => c.name === 'finish_post_payment_completion').length, 3);
  }
  {
    // Limitation: when the provider accepted the text but the sms_conversations row was not written, the text cannot be recognised
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    w.invokeHandlers['send-sms-notification'] = () => ({ data: { success: true }, error: null }); // accepted, nothing recorded
    w.failRpc.finish_post_payment_completion = { error: { message: 'db blip' }, times: 3 };
    await accept(w, orderId);
    const [p1] = await payRows(orderId);
    await completion(w).completePostPayment(makeClient(w), p1.id, FAST);
    eq('LIMITATION: with no sms_conversations row the text repeats on recovery', calls(w, 'send-sms-notification').length, 2);
  }
  {
    // A lookup failure must not suppress a confirmation text
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    wireRelays(w, orderId);
    w.failTable.push({ table: 'sms_conversations', op: 'select', error: { message: 'unavailable' }, times: 5 });
    await accept(w, orderId);
    eq('the dedupe lookup failing sends the text anyway (fail open)', calls(w, 'send-sms-notification').length, 1);
  }
  {
    // A text for a DIFFERENT order, or an older text for this order (before this payment), does not suppress this confirmation
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    wireRelays(w, orderId);
    (w.tables.sms_conversations ??= []).push({ order_id: nextId(), direction: 'outbound', message_body: `Hi Pat, your booking for June 1, 2030 is confirmed! Order #${orderId.slice(0, 8)}. x`, created_at: new Date(Date.now() + 1000).toISOString() });
    w.tables.sms_conversations.push({ order_id: orderId, direction: 'outbound', message_body: 'Your crew is on the way', created_at: new Date(Date.now() + 1000).toISOString() });
    w.tables.sms_conversations.push({ order_id: orderId, direction: 'outbound', message_body: `Hi Pat, your booking for June 1, 2030 is confirmed! Order #${orderId.slice(0, 8)}. old`, created_at: '2020-01-01T00:00:00.000Z' });
    w.tables.sms_conversations.push({ order_id: orderId, direction: 'inbound', message_body: `is confirmed! Order #${orderId.slice(0, 8)}`, created_at: new Date(Date.now() + 1000).toISOString() });
    await accept(w, orderId);
    eq('other orders, other messages, older messages and inbound messages do not suppress the confirmation text', calls(w, 'send-sms-notification').length, 1);
  }

  // =================================================================================================================
  // (d) Overlapping workers: a lease that expires while the first worker is still in stage B
  // =================================================================================================================
  {
    const w = newWorld();
    const { orderId } = await seedOrder(w);
    wireRelays(w, orderId);
    await accept(w, orderId);
    const [payment] = await payRows(orderId);
    // put the payment back to "applied but not completed" and start over
    await pg.exec(`UPDATE public.payments SET post_completed_at = NULL, post_claim_until = NULL WHERE id = '${payment.id}'; DELETE FROM public.transaction_receipts WHERE order_id = '${orderId}'; DELETE FROM public.invoices WHERE order_id = '${orderId}';`);
    w.invokes.length = 0;
    w.tables.sms_conversations = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    w.invokeHandlers['send-email'] = async () => { if (first) { first = false; await gate; } return { data: { success: true }, error: null }; };
    const slow = completion(w).completePostPayment(makeClient(w), payment.id, FAST); // stuck in its email
    await new Promise((r) => setTimeout(r, 300));
    ok('overlap: the slow worker is inside stage B holding the lease', calls(w, 'send-email').length === 1);
    eq('overlap: while the lease is live a second worker is told busy and sends nothing', (await completion(w).completePostPayment(makeClient(w), payment.id, FAST)).status, 'busy');
    await pg.exec(`UPDATE public.payments SET post_claim_until = now() - interval '1 second' WHERE id = '${payment.id}';`); // the lease runs out
    const second = await completion(w).completePostPayment(makeClient(w), payment.id, FAST);
    eq('overlap: after expiry the second worker takes over and completes', second.status, 'completed');
    release();
    const firstResult = await slow;
    eq('overlap: the slow worker, finishing late, completes without sending a second text', [calls(w, 'send-sms-notification').length, ['completed', 'already_completed'].includes(firstResult.status)], [1, true]);
    eq('overlap: the EMAIL went out twice (both workers were past the claim) - bounded to workers that overlapped a whole lease', confirmEmails(w), 2);
    eq('overlap: one receipt and one invoice regardless', [(await receipts(orderId)).length, (await invoices(orderId)).length], [1, 1]);
  }

  // =================================================================================================================
  // (e) What the sources record (the identifiers that exist to deduplicate with)
  // =================================================================================================================
  {
    const read = (p: string) => fs.readFileSync(p, 'utf8');
    const sms = read('supabase/functions/send-sms-notification/index.ts');
    ok('the text relay records an outbound sms_conversations row (order id, body, provider sid) after the provider accepted it', /from\("sms_conversations"\)\.insert\(\{[\s\S]{0,200}order_id: orderId \|\| null[\s\S]{0,300}direction: "outbound"[\s\S]{0,200}twilio_message_sid/.test(sms));
    const email = read('supabase/functions/send-email/index.ts');
    ok('the email relay writes no durable per-message record (only notification counters/failures)', !/\.insert\(/.test(email) && /record_notification_success/.test(email));
    const pp = read('supabase/functions/_shared/payments/post-payment.ts');
    ok('stage B asks for an existing confirmation text before sending one, and records completion with a retried idempotent update', pp.includes('confirmationSmsAlreadySent(db, orderId') && pp.includes('recordCompletion(db, paymentId'));
    ok('the completion marker update is idempotent (only an uncompleted payment is touched)', /WHERE id = p_payment_id AND post_completed_at IS NULL/.test(read('supabase/migrations/20261027130000_payment_post_completion.sql')));
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
  console.log(`Post-payment notification window tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
