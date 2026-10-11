// Handler-level tests for payment charging: charge-deposit (Admin approval, Admin balance charge, customer approval, Admin
// Invoice), customer-balance-payment, the Stripe webhook handlers, reconcile-balance-payment, stripe-checkout and stripe-charge.
//
// Every test runs the CURRENT Edge Function source (see paymentHarness.ts) against a fake Stripe and a REAL scratch PostgreSQL
// database for the money tables, so the real claim / finalize / release functions, unique indexes and row locks decide
// each outcome. Nothing here reaches the network, a Supabase project or real Stripe.
//
// With no reachable scratch database the whole file is SKIPPED (an environment limit, not a pass); ROLE_DB_REQUIRE=1 makes
// that a failure.
// Run: node node_modules/jiti/bin/jiti.js src/lib/paymentCharging.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined> };

import * as authHelpers from '../../supabase/functions/_shared/auth';
import * as payOps from '../../supabase/functions/_shared/payment-operations';
import * as outcomeHelpers from '../../supabase/functions/_shared/lifecycle-outcome';
import * as bookingProofHelpers from '../../supabase/functions/_shared/booking/bookingProof';
import * as returnOriginHelpers from '../../supabase/functions/_shared/booking/returnOrigin';
import { PgPool, ensurePayDatabase, makeWorld, loadHandler, loadModule, callHandler, lit, SERVICE_KEY, ANON_KEY, type World } from './paymentHarness';

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

// Unique per process (time and pid), so tests running side by side never touch each other's rows.
const TAG = String((Date.now() % 1e6) * 1000 + (process as any).pid % 1000).padStart(9, '0');
let counter = 0;
const nextId = () => `eeeeeeee-0000-4000-8000-${TAG}${String(++counter).padStart(3, '0')}`;
const tok = (orderId: string) => `tok-${orderId}-link`;
const OTHER_TOKEN = 'o'.repeat(40);
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

interface Seed {
  status?: string; dd?: number; dp?: number; bd?: number; bp?: number; tip?: number;
  selType?: string | null; selCents?: number | null;
  invoice?: boolean; card?: boolean; noPm?: boolean; withCustomer?: boolean;
}

(async () => {
  const db = ensurePayDatabase();
  if (!db) {
    if (process.env.ROLE_DB_REQUIRE) ok('executed: the scratch payment database is available (ROLE_DB_REQUIRE is set)', false);
    else console.log('Payment charging tests SKIPPED: the scratch database was not reachable (see the header of this file).');
    finish();
    return;
  }
  const pg = new PgPool(db.psql, db.db, 8);

  // ---------------------------------------------------------------------------------------------------------------
  // fixtures
  // ---------------------------------------------------------------------------------------------------------------
  async function seedOrder(w: World, seed: Seed = {}): Promise<string> {
    const id = nextId();
    const cols: Record<string, unknown> = {
      id, status: seed.status ?? 'pending_review', location_type: 'residential', event_date: '2030-06-01', event_end_date: '2030-06-01',
      start_window: '10:00', end_window: '12:00', subtotal_cents: 15000, deposit_due_cents: seed.dd ?? 5000, deposit_paid_cents: seed.dp ?? 0,
      balance_due_cents: seed.bd ?? 10000, balance_paid_cents: seed.bp ?? 0, tip_cents: seed.tip ?? 0, pickup_preference: 'same_day',
      customer_selected_payment_type: seed.selType ?? null, customer_selected_payment_cents: seed.selCents ?? null,
      stripe_customer_id: seed.card === false ? null : 'cus_1', stripe_payment_method_id: seed.card === false || seed.noPm ? null : 'pm_card',
    };
    if (seed.withCustomer) {
      const cid = nextId();
      await pg.exec(`INSERT INTO public.customers (id, first_name, last_name, email, phone) VALUES (${lit(cid)}, 'Pat', 'Lee', ${lit(`${cid}@payment-tests.example`)}, '5555550100');`);
      cols.customer_id = cid;
    }
    const keys = Object.keys(cols);
    await pg.exec(`INSERT INTO public.orders (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((k) => lit(cols[k])).join(', ')});`);
    const links: string[] = [];
    if (seed.invoice) links.push(`(${lit(id)}, 'invoice', ${lit(tok(id))}, ${lit(FUTURE)})`);
    else links.push(`(${lit(id)}, 'portal', ${lit(tok(id))}, ${lit(FUTURE)})`);
    await pg.exec(`INSERT INTO public.invoice_links (order_id, link_type, link_token, expires_at) VALUES ${links.join(', ')};`);
    w.embeds.orders = {
      customers: { email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      addresses: { line1: '1 Main', city: 'Town', state: 'MI', zip: '48000' },
      order_items: [],
      order_custom_fees: [],
    };
    return id;
  }
  const orderRow = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.orders t WHERE id = '${id}'`))[0].j;
  const payRows = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.payments t WHERE order_id = '${id}' ORDER BY created_at, ledger_sequence`)).map((r: any) => r.j);
  const changelog = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.order_changelog t WHERE order_id = '${id}'`)).map((r: any) => r.j);
  const snapshot = async (id: string) => { const o = await orderRow(id); return { status: o.status, dp: o.deposit_paid_cents, bd: o.balance_due_cents, bp: o.balance_paid_cents, tip: o.tip_cents, sps: o.stripe_payment_status }; };

  // The portal-link helpers stay fake: the real ones rotate links whose expiry does not match the portal policy, which these fixtures do not model.
const shared = { ...authHelpers, ...outcomeHelpers, ...bookingProofHelpers, ...returnOriginHelpers, ...payOps };
  const newWorld = () => makeWorld(pg);
  const deposit = (w: World, extra: Record<string, unknown> = {}) => loadHandler('charge-deposit', w, { ...shared, ...extra });
  const balance = (w: World, extra: Record<string, unknown> = {}) => loadHandler('customer-balance-payment', w, { ...shared, ...extra });
  const lifecycleCalls = (w: World) => w.invokes.filter((i) => i.name === 'order-lifecycle');
  const emails = (w: World) => w.invokes.filter((i) => i.name === 'send-email').length + w.fetches.filter((f) => /send-email/.test(f.url)).length;
  const creates = (w: World) => w.stripe.calls.filter((c) => c.api === 'paymentIntents.create');
  const allCreateAttempts = (w: World) => w.stripe.calls.filter((c) => c.api.startsWith('paymentIntents.create'));
  const accept = (w: World, orderId: string, extra: Record<string, unknown> = {}, bearer: string | null = 'jwt-admin') => callHandler(deposit(w), { orderId, ...extra }, bearer);

  // =================================================================================================================
  // 1. Admin approval of a booking request (charge-deposit, staff)
  // =================================================================================================================
  {
    const w = newWorld();
    const id = await seedOrder(w, { tip: 2000 });
    const r = await accept(w, id);
    eq('admin approval: succeeds', [r.status, r.json?.success], [200, true]);
    eq('admin approval: exactly one Stripe charge, for the server-derived deposit plus the stored tip', creates(w).map((c) => c.params.amount), [7000]);
    ok('admin approval: the charge carries a stable idempotency key built from the persisted operation key', /^bpc-pay-.+-deposit-.+:pi$/.test(creates(w)[0].key ?? ''));
    ok('admin approval: the Stripe metadata names the operation', creates(w)[0].params.metadata.payment_operation_key === (creates(w)[0].key ?? '').replace(/:pi$/, '') && !!creates(w)[0].params.metadata.payment_id);
    ok('admin approval: the charge is off-session and confirmed immediately', creates(w)[0].params.off_session === true && creates(w)[0].params.confirm === true);
    const rows = await payRows(id);
    eq('admin approval: one ledger row, with principal and tip kept apart', rows.map((p: any) => [p.type, p.status, p.amount_cents, p.principal_amount_cents, p.tip_amount_cents, p.order_financials_applied]), [['deposit', 'succeeded', 7000, 5000, 2000, true]]);
    ok('admin approval: the row remembers its PaymentIntent and card details', rows[0].stripe_payment_intent_id?.startsWith('pi_fake_') && rows[0].payment_brand === 'visa' && rows[0].payment_last4 === '4242');
    eq('admin approval: the order is confirmed with only the deposit principal paid and the tip stored', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 2000, sps: 'paid' });
    eq('admin approval: the lifecycle confirmed it once, as charged_now', lifecycleCalls(w).map((c) => [c.body.action, c.body.paymentOutcome]), [['enter_confirmed', 'charged_now']]);
    eq('admin approval: the response reports principal and tip', [r.json.paymentDetails.principalCents, r.json.paymentDetails.tipCents, r.json.paymentDetails.amountCents], [5000, 2000, 7000]);
    ok('admin approval: no payment lock is taken or left behind', (await orderRow(id)).payment_lock !== true);
    const claimArgs = w.rpcCalls.find((c) => c.name === 'claim_payment_operation')?.args;
    ok('admin approval: the claim carries no browser amount for a deposit (the database derives it)', claimArgs?.p_requested_principal_cents === null && claimArgs?.p_purpose === 'deposit' && claimArgs?.p_actor === 'staff');
  }

  // The browser cannot choose the amount.
  for (const [label, extra] of [
    ['a smaller deposit amount', { paymentAmountCents: 1 }],
    ['a larger deposit amount', { paymentAmountCents: 999999 }],
    ['a Full selection with an amount', { paymentAmountCents: 15000, selectedPaymentType: 'full' }],
    ['a Custom selection', { paymentAmountCents: 100, selectedPaymentType: 'custom' }],
  ] as Array<[string, Record<string, unknown>]>) {
    const w = newWorld();
    const id = await seedOrder(w, { selType: 'full', selCents: 15000 });
    const r = await accept(w, id, extra);
    eq(`admin approval ignores ${label}: the required deposit is charged`, [r.status, creates(w).map((c) => c.params.amount)], [200, [5000]]);
  }

  // malformed values never reach Stripe
  for (const [label, extra, code] of [
    ['a negative tip', { tipCents: -1 }, 'INVALID_TIP'],
    ['a fractional tip', { tipCents: 10.5 }, 'INVALID_TIP'],
    ['a text tip', { tipCents: '100' }, 'INVALID_TIP'],
    ['a tip beyond the provider maximum', { tipCents: 1e12 }, 'INVALID_TIP'],
    ['a fractional amount', { paymentAmountCents: 100.5 }, 'INVALID_AMOUNT'],
    ['a negative amount', { paymentAmountCents: -5 }, 'INVALID_AMOUNT'],
  ] as Array<[string, Record<string, unknown>, string]>) {
    const w = newWorld();
    const id = await seedOrder(w);
    const r = await accept(w, id, extra);
    ok(`${label} is refused before anything else (code ${code})`, r.status === 400 && r.json?.code === code);
    ok(`${label}: zero Stripe calls and no ledger row`, w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
  }

  // who may charge
  {
    const w = newWorld();
    const id = await seedOrder(w);
    const other = await seedOrder(w);
    const anon = await callHandler(deposit(w), { orderId: id }, ANON_KEY);
    const crew = await callHandler(deposit(w), { orderId: id }, 'jwt-crew');
    const cust = await callHandler(deposit(w), { orderId: id, invoiceToken: OTHER_TOKEN }, ANON_KEY);
    const wrongOrder = await callHandler(deposit(w), { orderId: other, invoiceToken: tok(id), selectedPaymentType: 'balance' }, ANON_KEY);
    eq('authorization: anonymous, crew and a wrong token are refused', [anon.status, crew.status, cust.status], [401, 403, 401]);
    ok('authorization: a customer cannot run a balance charge here', wrongOrder.status === 401 || wrongOrder.status === 403);
    ok('authorization: zero Stripe calls and zero ledger rows', w.stripe.calls.length === 0 && (await payRows(id)).length === 0 && (await payRows(other)).length === 0);
    const tokenOfAnotherOrder = await callHandler(deposit(w), { orderId: other, invoiceToken: OTHER_TOKEN }, ANON_KEY);
    ok('authorization: a token that belongs to no order proves nothing', tokenOfAnotherOrder.status === 401 || tokenOfAnotherOrder.status === 403);
  }

  // a customer cannot charge a booking request that is awaiting review
  {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'pending_review' });
    const r = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id), tipCents: 0 }, ANON_KEY);
    ok('a customer cannot self-approve a booking request: ORDER_STATUS_NOT_PAYABLE ' + JSON.stringify(r), r.status === 409 && r.json?.code === 'ORDER_STATUS_NOT_PAYABLE');
    ok('... zero Stripe calls, nothing recorded, order untouched', w.stripe.calls.length === 0 && (await payRows(id)).length === 0 && (await snapshot(id)).status === 'pending_review');
  }

  // stale order status
  for (const st of ['confirmed', 'cancelled', 'void', 'in_progress', 'completed', 'draft', 'awaiting_customer_approval']) {
    const w = newWorld();
    const id = await seedOrder(w, { status: st });
    const r = await accept(w, id);
    ok(`admin approval of a ${st} order is refused (409 ORDER_STATUS_NOT_PAYABLE), zero Stripe calls`, r.status === 409 && r.json?.code === 'ORDER_STATUS_NOT_PAYABLE' && w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
  }

  // catch-up and already paid
  // An earlier deposit payment, in the ledger with its components (what every payment recorded since payment operations does).
  const paidDeposit = (orderId: string, dep: number, tip = 0) => pg.exec(
    `INSERT INTO public.payments (id, order_id, type, amount_cents, status, paid_at, order_financials_applied, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, stripe_payment_intent_id)
     VALUES (gen_random_uuid(), '${orderId}', 'deposit', ${dep + tip}, 'succeeded', now(), true, ${dep}, ${tip}, ${dep}, 0, 'pi_prior_${orderId}');`);
  {
    // Admin approval of an order whose deposit rose from 5000 to 8000 after 5000 was paid: ONLY the 3000 is charged
    const w = newWorld();
    const id = await seedOrder(w, { dd: 8000, dp: 5000, bd: 7000 });
    await paidDeposit(id, 5000);
    const r = await accept(w, id);
    ok('catch-up (Admin approval): charges successfully', r.status === 200 && r.json?.success === true);
    eq('catch-up (Admin approval): Stripe is asked for ONLY the remaining 3000 (not 8000, not 5000)', [creates(w).length, creates(w)[0]?.params.amount, w.stripe.charged], [1, 3000, 3000]);
    eq('catch-up (Admin approval): the deposit is paid up, the balance is untouched, the order is confirmed', await snapshot(id), { status: 'confirmed', dp: 8000, bd: 7000, bp: 0, tip: 0, sps: 'paid' });
    const comps = (await payRows(id)).filter((p: any) => p.operation_key).map((p: any) => [p.deposit_principal_cents, p.balance_principal_cents, p.tip_amount_cents, p.principal_amount_cents, p.amount_cents]);
    eq('catch-up (Admin approval): the new payment records deposit 3000 / balance 0 / tip 0', comps, [[3000, 0, 0, 3000, 3000]]);
    const again = await accept(w, id);
    ok('catch-up: asking again charges nothing more (the order is confirmed now)', again.status === 409 && creates(w).length === 1 && (await snapshot(id)).dp === 8000);
  }
  {
    // a tip that was already paid with the first deposit is not charged again, whatever the stored tip says
    const w = newWorld();
    const id = await seedOrder(w, { dd: 8000, dp: 5000, bd: 7000, tip: 1000 });
    await paidDeposit(id, 5000, 1000);
    const r = await accept(w, id);
    eq('catch-up: the previously paid tip is not recharged (3000, tip 0)', [r.status, creates(w)[0]?.params.amount, (await snapshot(id)).tip], [200, 3000, 1000]);
  }
  {
    // a deposit that was LOWERED: nothing to charge, no refund, the order simply moves on
    const w = newWorld();
    const id = await seedOrder(w, { dd: 3000, dp: 5000, bd: 7000 });
    await paidDeposit(id, 5000);
    const r = await accept(w, id);
    ok('lowered deposit: no charge and no negative amount', r.status === 200 && w.stripe.calls.filter((c) => c.api.startsWith('paymentIntents') || c.api.includes('refund')).length === 0);
    eq('lowered deposit: the order is confirmed and the money received is preserved', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 7000, bp: 0, tip: 0, sps: 'unpaid' });
  }
  {
    // an order that has refund activity needs the later refund-aware reconciliation: nothing is charged
    const w = newWorld();
    const id = await seedOrder(w, { dd: 8000, dp: 5000, bd: 7000 });
    await paidDeposit(id, 5000);
    await pg.exec(`UPDATE public.orders SET total_refunded_cents = 500 WHERE id = '${id}';`);
    const r = await accept(w, id);
    ok('refunded order: DEPOSIT_CATCH_UP_REVIEW_REQUIRED (refund-aware reconciliation required), zero Stripe calls', r.status === 409 && r.json?.code === 'DEPOSIT_CATCH_UP_REVIEW_REQUIRED' && r.json?.reason === 'refund_reconciliation_required' && w.stripe.calls.length === 0);
  }
  {
    // a lost response during a catch-up: the retry is the same operation and the deposit is applied once
    const w = newWorld();
    const id = await seedOrder(w, { dd: 8000, dp: 5000, bd: 7000 });
    await paidDeposit(id, 5000);
    w.stripe.behaviors.push('succeed_then_connection_error');
    const first = await accept(w, id);
    ok('catch-up: the response was lost after Stripe took the 3000', first.status === 202);
    const retry = await accept(w, id);
    eq('catch-up: the retry reuses the operation: one PaymentIntent, one 3000 charge, the deposit paid once', [retry.status, w.stripe.createdCount, w.stripe.charged, (await snapshot(id)).dp], [200, 1, 3000, 8000]);
  }
  {
    const w = newWorld();
    const id = await seedOrder(w, { dd: 5000, dp: 2000, bd: 8000 });
    const r = await accept(w, id);
    ok('deposit partly paid with no payment to explain it: DEPOSIT_CATCH_UP_REVIEW_REQUIRED, never the whole deposit again', r.status === 409 && r.json?.code === 'DEPOSIT_CATCH_UP_REVIEW_REQUIRED' && r.json?.requiresReview === true);
    ok('... zero Stripe calls, nothing recorded, the order is unchanged', w.stripe.calls.length === 0 && (await payRows(id)).length === 0 && (await snapshot(id)).dp === 2000 && (await snapshot(id)).status === 'pending_review');
  }
  {
    const w = newWorld();
    const id = await seedOrder(w, { dd: 5000, dp: 5000 });
    const r = await accept(w, id);
    ok('deposit already paid: success with no charge, and the order moves forward', r.status === 200 && r.json?.alreadyCharged === true && w.stripe.calls.length === 0);
    eq('... confirmed, nothing else changed', (await snapshot(id)).status, 'confirmed');
    eq('... the lifecycle was told it was already paid', lifecycleCalls(w).map((c) => c.body.paymentOutcome), ['already_paid']);
  }
  {
    const w = newWorld();
    const id = await seedOrder(w, { dd: 0, bd: 15000 });
    const r = await accept(w, id);
    ok('no deposit due: nothing is charged (NO_DEPOSIT_DUE), a $0 deposit is not "fully paid"', r.status === 400 && r.json?.code === 'NO_DEPOSIT_DUE' && w.stripe.calls.length === 0);
  }

  // =================================================================================================================
  // 2. Retries, double clicks and crashes (the same logical payment is never charged twice)
  // =================================================================================================================
  {
    // double click: the second request arrives while the first is between the charge and the finalize
    const w = newWorld();
    const id = await seedOrder(w, { tip: 1000 });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    w.beforeRpc.finalize_payment_operation = async () => { if (first) { first = false; await gate; } };
    const p1 = accept(w, id);
    await new Promise((r) => setTimeout(r, 600));
    const second = await accept(w, id);
    ok('double click: the second request is told a payment is in progress (409 PAYMENT_IN_PROGRESS)', second.status === 409 && second.json?.code === 'PAYMENT_IN_PROGRESS');
    release();
    const firstRes = await p1;
    ok('double click: the first request completes normally', firstRes.status === 200 && firstRes.json?.success === true);
    eq('double click: exactly one Stripe charge was created', allCreateAttempts(w).length, 1);
    eq('double click: exactly one ledger operation, applied once', (await payRows(id)).map((p: any) => [p.status, p.order_financials_applied]), [['succeeded', true]]);
    eq('double click: the deposit was applied once', (await snapshot(id)).dp, 5000);
  }
  {
    // simultaneous requests with no gating: whichever way they interleave, one charge
    const w = newWorld();
    const id = await seedOrder(w, {});
    const rs = await Promise.all([accept(w, id), accept(w, id), accept(w, id)]);
    eq('three simultaneous requests: exactly one Stripe charge', allCreateAttempts(w).length, 1);
    ok('three simultaneous requests: exactly one succeeded with a payment, the rest were refused or saw it paid', rs.filter((r) => r.json?.paymentDetails).length === 1 && rs.every((r) => r.status === 200 || r.status === 409));
    eq('three simultaneous requests: deposit applied once and one ledger row', [(await snapshot(id)).dp, (await payRows(id)).length], [5000, 1]);
  }
  {
    // the response from Stripe is lost after Stripe took the money
    const w = newWorld();
    const id = await seedOrder(w, { tip: 2000 });
    w.stripe.behaviors.push('succeed_then_connection_error');
    const r1 = await accept(w, id);
    ok('lost response: the caller is told the status is unknown and that a retry is safe', r1.status === 202 && r1.json?.code === 'PAYMENT_STATUS_UNKNOWN' && r1.json?.retrySafe === true);
    const mid = await payRows(id);
    eq('lost response: the operation stays open (pending) with no owner, ready to resume', mid.map((p: any) => [p.status, p.claim_id, p.order_financials_applied]), [['pending', null, false]]);
    eq('lost response: the order is not changed', await snapshot(id), { status: 'pending_review', dp: 0, bd: 10000, bp: 0, tip: 2000, sps: 'unpaid' });
    const key1 = creates(w)[0].key;
    const r2 = await accept(w, id);
    ok('retry: succeeds', r2.status === 200 && r2.json?.success === true);
    eq('retry: Stripe was asked again with the SAME idempotency key', allCreateAttempts(w).map((c) => c.key), [key1, key1]);
    eq('retry: Stripe holds exactly one PaymentIntent and charged exactly once', [w.stripe.createdCount, w.stripe.succeededCount, w.stripe.charged], [1, 1, 7000]);
    eq('retry: still one ledger row; applied once', (await payRows(id)).map((p: any) => [p.status, p.order_financials_applied]), [['succeeded', true]]);
    eq('retry: the deposit and the tip were applied once', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 2000, sps: 'paid' });
  }
  {
    // the request never reached Stripe
    const w = newWorld();
    const id = await seedOrder(w);
    w.stripe.behaviors.push('connection_error_before');
    const r1 = await accept(w, id);
    ok('request never reached Stripe: unknown status, retry safe', r1.status === 202 && r1.json?.code === 'PAYMENT_STATUS_UNKNOWN');
    const r2 = await accept(w, id);
    ok('... the retry then charges once', r2.status === 200 && w.stripe.succeededCount === 1 && (await payRows(id)).length === 1);
  }
  {
    // a Stripe server error
    const w = newWorld();
    const id = await seedOrder(w);
    w.stripe.behaviors.push('api_error_500');
    const r1 = await accept(w, id);
    ok('Stripe server error: unknown status, operation kept open', r1.status === 202 && (await payRows(id))[0].status === 'pending');
    ok('... nothing was charged', w.stripe.succeededCount === 0);
  }
  {
    // declined card
    const w = newWorld();
    const id = await seedOrder(w, { tip: 500 });
    w.stripe.behaviors.push('decline');
    const r1 = await accept(w, id);
    ok('declined card: 400 CARD_DECLINED', r1.status === 400 && r1.json?.code === 'CARD_DECLINED');
    eq('declined card: the operation is closed as failed and nothing is applied', [(await payRows(id)).map((p: any) => [p.status, p.order_financials_applied]), await snapshot(id)], [[['failed', false]], { status: 'pending_review', dp: 0, bd: 10000, bp: 0, tip: 500, sps: 'unpaid' }]);
    ok('declined card: the order was not confirmed and the lifecycle was not called', lifecycleCalls(w).length === 0);
    const r2 = await accept(w, id);
    ok('after a decline a new attempt is a NEW operation with a NEW key (a declined key is never replayed)', r2.status === 200 && new Set(allCreateAttempts(w).map((c) => c.key)).size === 2);
    eq('... two ledger rows: one failed, one succeeded; one charge', [(await payRows(id)).map((p: any) => p.status), w.stripe.succeededCount], [['failed', 'succeeded'], 1]);
  }
  {
    // authentication required / invalid request / processing
    const w1 = newWorld(); const id1 = await seedOrder(w1);
    w1.stripe.behaviors.push('requires_action');
    const a = await accept(w1, id1);
    ok('card needs action: refused, the PaymentIntent is cancelled, the operation is failed', a.status === 400 && w1.stripe.count('paymentIntents.cancel') === 1 && (await payRows(id1))[0].status === 'failed');
    const w2 = newWorld(); const id2 = await seedOrder(w2);
    w2.stripe.behaviors.push('invalid_request');
    const b = await accept(w2, id2);
    ok('invalid request: closed as failed, nothing charged', b.status === 400 && b.json?.code === 'PAYMENT_REQUEST_INVALID' && (await payRows(id2))[0].status === 'failed' && w2.stripe.succeededCount === 0);
    const w3 = newWorld(); const id3 = await seedOrder(w3);
    w3.stripe.behaviors.push('processing');
    const c = await accept(w3, id3);
    ok('processing: reported as such; the operation stays open with its PaymentIntent recorded', c.status === 202 && c.json?.code === 'PAYMENT_PROCESSING' && (await payRows(id3))[0].status === 'pending' && !!(await payRows(id3))[0].stripe_payment_intent_id);
    const piId = (await payRows(id3))[0].stripe_payment_intent_id;
    w3.stripe.paymentIntents_[piId].status = 'succeeded';
    w3.stripe.paymentIntents_[piId].amount_received = w3.stripe.paymentIntents_[piId].amount;
    const d = await accept(w3, id3);
    ok('processing, then it settles: the retry finalizes the SAME PaymentIntent (no second charge)', d.status === 200 && w3.stripe.createdCount === 1 && (await snapshot(id3)).dp === 5000);
  }

  // =================================================================================================================
  // 3. Failures around the local operation
  // =================================================================================================================
  {
    // the operation cannot be created: Stripe is never called
    const w = newWorld();
    const id = await seedOrder(w);
    w.failRpc.claim_payment_operation = { error: { message: 'db down' } };
    const r = await accept(w, id);
    ok('the operation cannot be created: PAYMENT_UNAVAILABLE', r.status === 500 && r.json?.code === 'PAYMENT_UNAVAILABLE');
    ok('... zero Stripe calls of any kind that move money, and nothing recorded', allCreateAttempts(w).length === 0 && (await payRows(id)).length === 0);
  }
  {
    // the charge succeeds but the financial application fails: no second charge, recoverable
    const w = newWorld();
    const id = await seedOrder(w, { tip: 1000 });
    w.failRpc.finalize_payment_operation = { error: { message: 'db down' }, times: 1 };
    const r = await accept(w, id);
    ok('finalize fails after Stripe took the money: success=false with chargeSucceeded and FINALIZATION_PENDING', r.status === 200 && r.json?.success === false && r.json?.chargeSucceeded === true && r.json?.code === 'FINALIZATION_PENDING');
    eq('... the operation stays open with its PaymentIntent recorded; nothing applied', [(await payRows(id)).map((p: any) => [p.status, p.order_financials_applied, !!p.stripe_payment_intent_id]), (await snapshot(id)).dp], [[['pending', false, true]], 0]);
    const retry = await accept(w, id);
    ok('retry after the failed finalize: applied, with NO second Stripe charge', retry.status === 200 && w.stripe.createdCount === 1 && allCreateAttempts(w).length === 1 && (await snapshot(id)).dp === 5000);
    ok('... and it retrieved the existing PaymentIntent instead of creating one', w.stripe.count('paymentIntents.retrieve') >= 1);
  }
  {
    // the charge succeeds, the finalize fails, and the webhook finalizes
    const w = newWorld();
    const id = await seedOrder(w, { tip: 1000 });
    w.failRpc.finalize_payment_operation = { error: { message: 'db down' }, times: 1 };
    await accept(w, id);
    const piId = (await payRows(id))[0].stripe_payment_intent_id;
    const handlers = loadModule('supabase/functions/stripe-webhook/handlers.ts', w, { ...shared, sendCheckoutBalanceReceiptEmail: async () => { w.invokes.push({ name: 'send-email', body: 'balance' }); }, sendDepositReceiptEmail: async () => { w.invokes.push({ name: 'send-email', body: 'deposit' }); } });
    await handlers.handlePaymentIntentSucceeded(w.stripe.paymentIntents_[piId], (await import('./paymentHarness')).makeClient(w), w.stripe);
    eq('webhook after a crash between the charge and the finalize: applied exactly once', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 1000, sps: 'paid' });
    eq('... the webhook confirmed the order and sent the receipt', [lifecycleCalls(w).map((c) => c.body.action), emails(w)], [['enter_confirmed'], 1]);
    eq('... one Stripe charge only', w.stripe.succeededCount, 1);
  }

  // =================================================================================================================
  // 4. Webhook and request together
  // =================================================================================================================
  async function webhookFor(w: World, extra: Record<string, unknown> = {}) {
    const handlers = loadModule('supabase/functions/stripe-webhook/handlers.ts', w, {
      ...shared,
      sendCheckoutBalanceReceiptEmail: async () => { w.invokes.push({ name: 'send-email', body: 'balance' }); },
      sendDepositReceiptEmail: async () => { w.invokes.push({ name: 'send-email', body: 'deposit' }); },
      ...extra,
    });
    const client = (await import('./paymentHarness')).makeClient(w);
    return { handlers, client, succeeded: (pi: any) => handlers.handlePaymentIntentSucceeded(pi, client, w.stripe) };
  }
  {
    // the webhook arrives first (while the request is between the charge and its finalize)
    const w = newWorld();
    const id = await seedOrder(w, { tip: 1000 });
    const wh = await webhookFor(w);
    w.beforeRpc.finalize_payment_operation = async () => {
      w.beforeRpc.finalize_payment_operation = () => {};
      const pi = Object.values(w.stripe.paymentIntents_)[0] as any;
      await wh.succeeded(pi);
    };
    const r = await accept(w, id);
    ok('webhook first: the request still reports success', r.status === 200 && r.json?.success === true);
    eq('webhook first: the payment was applied exactly once', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 1000, sps: 'paid' });
    eq('webhook first: the lifecycle and the receipt happened exactly once (the webhook applied it, the request stayed quiet)', [lifecycleCalls(w).length, emails(w)], [1, 1]);
    eq('webhook first: one charge, one ledger row', [w.stripe.succeededCount, (await payRows(id)).length], [1, 1]);
  }
  {
    // the request finishes first, then the webhook, then the same webhook again
    const w = newWorld();
    const id = await seedOrder(w, { tip: 1000 });
    const r = await accept(w, id);
    ok('request first: success', r.status === 200);
    const before = await snapshot(id);
    const pi = Object.values(w.stripe.paymentIntents_)[0] as any;
    const wh = await webhookFor(w);
    await wh.succeeded(pi);
    await wh.succeeded(pi);
    eq('request first, then the webhook twice: nothing changed again', await snapshot(id), before);
    eq('... one lifecycle call and one email in total (from the request)', [lifecycleCalls(w).length, emails(w)], [1, 1]);
    eq('... one ledger row', (await payRows(id)).length, 1);
  }
  {
    // the webhook for an operation with the wrong amount is refused and reported, never applied
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.failRpc.finalize_payment_operation = { error: { message: 'db down' }, times: 1 };
    await accept(w, id);
    const pi = Object.values(w.stripe.paymentIntents_)[0] as any;
    const wh = await webhookFor(w);
    await wh.succeeded({ ...pi, amount_received: pi.amount_received - 1 });
    eq('webhook with a different amount: nothing applied', (await snapshot(id)).dp, 0);
    ok('... and the payment is recorded for reconciliation', (await changelog(id)).some((c: any) => /PAYMENT_NEEDS_RECONCILIATION/.test(c.notes ?? '')));
  }
  {
    // a successful PaymentIntent with no operation is never guessed into a deposit, balance or tip
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dp: 5000, bd: 10000 });
    const wh = await webhookFor(w);
    await wh.succeeded({ id: 'pi_unknown', metadata: { order_id: id, payment_type: 'balance' }, amount_received: 4000, payment_method: null, customer: 'cus_1' });
    eq('PaymentIntent with no operation: no financials applied', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 0, sps: 'unpaid' });
    ok('... and it is reported for reconciliation, with no ledger row invented', (await changelog(id)).some((c: any) => /PAYMENT_NEEDS_RECONCILIATION/.test(c.notes ?? '')) && (await payRows(id)).length === 0);
    await wh.succeeded({ id: 'pi_unknown2', metadata: { order_id: id, payment_type: 'deposit', payment_operation_key: 'bpc-pay-nonexistent', payment_id: '00000000-0000-4000-8000-000000000000' }, amount_received: 4000, payment_method: null, customer: 'cus_1' });
    ok('PaymentIntent naming an operation that does not exist: nothing applied, reported', (await snapshot(id)).dp === 5000 && (await changelog(id)).length === 2);
  }
  {
    // legacy PaymentIntent (no operation key) with its own ledger row: only provider details are refreshed
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dp: 5000, bd: 10000 });
    await pg.exec(`INSERT INTO public.payments (order_id, type, amount_cents, status, stripe_payment_intent_id) VALUES ('${id}', 'balance', 3000, 'pending', 'pi_legacy_${TAG}');`);
    const wh = await webhookFor(w);
    await wh.succeeded({ id: `pi_legacy_${TAG}`, metadata: { order_id: id, payment_type: 'balance' }, amount_received: 3000, payment_method: 'pm_card', customer: 'cus_1' });
    eq('legacy PaymentIntent: the existing row is marked succeeded; no order financials are applied from a raw amount', [(await payRows(id))[0].status, (await snapshot(id)).bp, (await snapshot(id)).bd], ['succeeded', 0, 10000]);
  }
  {
    // payment_intent.payment_failed only closes an open card operation
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('succeed_then_connection_error');
    await accept(w, id);
    const pi = Object.values(w.stripe.paymentIntents_)[0] as any;
    await pg.exec(`UPDATE public.payments SET stripe_payment_intent_id = '${pi.id}' WHERE order_id = '${id}';`);
    const wh = await webhookFor(w);
    await wh.handlers.handlePaymentIntentFailed({ id: pi.id }, wh.client);
    eq('payment_failed: an open card operation is closed as failed', (await payRows(id))[0].status, 'failed');
    const w2 = newWorld();
    const id2 = await seedOrder(w2, { status: 'confirmed', dp: 5000, bd: 10000 });
    await pg.exec(`INSERT INTO public.payments (order_id, type, amount_cents, status, stripe_payment_intent_id, order_financials_applied) VALUES ('${id2}', 'balance', 3000, 'succeeded', 'pi_done_${TAG}', true);`);
    const wh2 = await webhookFor(w2);
    await wh2.handlers.handlePaymentIntentFailed({ id: `pi_done_${TAG}` }, wh2.client);
    eq('payment_failed: a payment that already succeeded is never flipped to failed', (await payRows(id2))[0].status, 'succeeded');
  }

  // =================================================================================================================
  // 5. Customer approval after an Admin edit (awaiting_customer_approval)
  // =================================================================================================================
  const customer = (w: World, id: string, extra: Record<string, unknown> = {}) => callHandler(deposit(w), { orderId: id, invoiceToken: tok(id), ...extra }, ANON_KEY);
  {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'awaiting_customer_approval', dd: 6000, bd: 9000, selType: 'deposit', selCents: 6000 });
    const r = await customer(w, id, { tipCents: 1000, expectedDepositDueCents: 6000, paymentAmountCents: 100, selectedPaymentType: 'deposit' });
    eq('customer approval: the server amount wins over a smaller browser amount', [r.status, creates(w).map((c) => c.params.amount)], [200, [7000]]);
    eq('customer approval: confirmed; deposit principal and tip stored apart', await snapshot(id), { status: 'confirmed', dp: 6000, bd: 9000, bp: 0, tip: 1000, sps: 'paid' });
    eq('customer approval: the ledger kept principal and tip apart', (await payRows(id)).map((p: any) => [p.principal_amount_cents, p.tip_amount_cents]), [[6000, 1000]]);
  }
  {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'awaiting_customer_approval', dd: 6000, bd: 9000, selType: 'deposit', selCents: 6000 });
    const r = await customer(w, id, { tipCents: 0, expectedDepositDueCents: 6000, paymentAmountCents: 999999 });
    eq('customer approval: the server amount wins over a larger browser amount', [r.status, creates(w).map((c) => c.params.amount)], [200, [6000]]);
  }
  {
    // a stale page: the admin raised the deposit after the customer loaded it
    const w = newWorld();
    const id = await seedOrder(w, { status: 'awaiting_customer_approval', dd: 8000, bd: 7000, selType: 'deposit', selCents: 8000 });
    const r = await customer(w, id, { tipCents: 0, expectedDepositDueCents: 5000, paymentAmountCents: 5000 });
    ok('stale page (deposit raised): ORDER_CHANGED, nothing charged, nothing recorded', r.status === 409 && r.json?.code === 'ORDER_CHANGED' && w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
    eq('stale page: the order is unchanged', (await snapshot(id)).status, 'awaiting_customer_approval');
    const lower = await seedOrder(w, { status: 'awaiting_customer_approval', dd: 3000, bd: 12000, selType: 'deposit', selCents: 3000 });
    const r2 = await customer(w, lower, { tipCents: 0, expectedDepositDueCents: 5000 });
    ok('stale page (deposit lowered): also ORDER_CHANGED, so a lowered requirement is never silently charged either', r2.status === 409 && r2.json?.code === 'ORDER_CHANGED' && w.stripe.calls.length === 0);
  }
  {
    // a token for one order cannot approve another order
    const w = newWorld();
    const a = await seedOrder(w, { status: 'awaiting_customer_approval' });
    const b = await seedOrder(w, { status: 'awaiting_customer_approval' });
    const r = await callHandler(deposit(w), { orderId: b, invoiceToken: tok(a), tipCents: 0 }, ANON_KEY);
    ok('a link token for another order proves nothing', (r.status === 401 || r.status === 403) && w.stripe.calls.length === 0 && (await payRows(b)).length === 0);
  }
  {
    // edited order whose deposit was already part-paid: fail closed
    const w = newWorld();
    const id = await seedOrder(w, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, bd: 7000, selType: 'deposit', selCents: 8000 });
    const r = await customer(w, id, { tipCents: 500, expectedDepositDueCents: 8000 });
    ok('edited order with a part-paid deposit nobody can classify: DEPOSIT_CATCH_UP_REVIEW_REQUIRED, the original deposit is not charged again', r.status === 409 && r.json?.code === 'DEPOSIT_CATCH_UP_REVIEW_REQUIRED' && w.stripe.calls.length === 0);
    eq('... nothing changed', await snapshot(id), { status: 'awaiting_customer_approval', dp: 5000, bd: 7000, bp: 0, tip: 0, sps: 'unpaid' });
  }
  {
    // the customer approves the edited order: deposit selection; a NEW tip the customer chooses now is added
    const w = newWorld();
    const id = await seedOrder(w, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, bd: 7000, selType: 'deposit', selCents: 8000 });
    await paidDeposit(id, 5000);
    const r = await customer(w, id, { tipCents: 500, expectedDepositDueCents: 8000 });
    ok('catch-up (customer approval): charges successfully', r.status === 200 && r.json?.success === true);
    eq('catch-up (customer approval): 3000 of deposit + the new 500 tip, nothing else', creates(w)[0]?.params.amount, 3500);
    eq('catch-up (customer approval): deposit paid up, tip recorded once', await snapshot(id), { status: 'confirmed', dp: 8000, bd: 7000, bp: 0, tip: 500, sps: 'paid' });
  }
  {
    // the customer pays everything that is left: the remaining deposit AND the balance, never the 5000 already paid
    const w = newWorld();
    const id = await seedOrder(w, { status: 'awaiting_customer_approval', dd: 8000, dp: 5000, bd: 7000, selType: 'full', selCents: 15000 });
    await paidDeposit(id, 5000);
    const r = await customer(w, id, { tipCents: 0, expectedDepositDueCents: 8000 });
    eq('catch-up (Full): 3000 + 7000 = 10000 is charged', [r.status, creates(w)[0]?.params.amount], [200, 10000]);
    eq('catch-up (Full): deposit paid 8000, balance paid 7000, balance due 0', await snapshot(id), { status: 'confirmed', dp: 8000, bd: 0, bp: 7000, tip: 0, sps: 'paid' });
  }
  {
    // the original tip is never charged a second time
    const w = newWorld();
    const id = await seedOrder(w, { status: 'pending_review', tip: 2000 });
    await accept(w, id);
    eq('tip: charged once with the deposit', creates(w).map((c) => c.params.amount), [7000]);
    // the same order later comes back needing a deposit again (an edit raised it); the stored tip was already charged
    await pg.exec(`UPDATE public.orders SET status = 'awaiting_customer_approval', deposit_paid_cents = 0, deposit_due_cents = 5000 WHERE id = '${id}';`);
    const client = (await import('./paymentHarness')).makeClient(w);
    const second = await payOps.claimPaymentOperation(client, { orderId: id, purpose: 'deposit', actor: 'customer', claimId: '99999999-9999-4999-8999-000000000001', useSelection: true, expectedDepositDueCents: 5000 });
    ok('a second deposit-related charge refuses to run beside a recorded deposit payment (ledger conflict), so the tip cannot be recharged', !second.ok && second.outcome === 'ledger_conflict' && creates(w).length === 1);
  }

  // =================================================================================================================
  // 6. Admin Invoice: the persisted Deposit / Full / Custom selection decides, never a browser amount
  // =================================================================================================================
  for (const [label, sel, expected, state, comps] of [
    ['Deposit', { selType: 'deposit', selCents: 5000 }, 5000, { dp: 5000, bp: 0, bd: 10000 }, [5000, 5000, 0]],
    ['Full', { selType: 'full', selCents: 15000 }, 15000, { dp: 5000, bp: 10000, bd: 0 }, [15000, 5000, 10000]],
    ['Custom', { selType: 'custom', selCents: 8000 }, 8000, { dp: 5000, bp: 3000, bd: 7000 }, [8000, 5000, 3000]],
  ] as Array<[string, Seed, number, { dp: number; bp: number; bd: number }, number[]]>) {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 5000, bd: 10000, ...sel });
    // what the return page sends: no amount at all (and a hostile browser could add one)
    const r = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id), paymentAmountCents: 100, tipCents: 0, selectedPaymentType: 'deposit' }, ANON_KEY);
    eq(`Admin Invoice ${label}: the server derives the principal from the persisted selection`, [r.status, creates(w).map((c) => c.params.amount)], [200, [expected]]);
    const snap = await snapshot(id);
    eq(`Admin Invoice ${label}: the principal is split by what it satisfied (deposit_paid / balance_paid / balance_due), never all into the deposit`, [snap.status, snap.dp, snap.bp, snap.bd], ['confirmed', state.dp, state.bp, state.bd]);
    eq(`Admin Invoice ${label}: the payment row keeps principal, deposit part, balance part, tip and gross`, (await payRows(id)).map((p: any) => [p.principal_amount_cents, p.deposit_principal_cents, p.balance_principal_cents, p.tip_amount_cents, p.amount_cents, p.status, p.order_financials_applied]), [[comps[0], comps[1], comps[2], 0, expected, 'succeeded', true]]);
  }
  {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 5000, bd: 10000, selType: 'custom', selCents: 99999 });
    const r = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    ok('Admin Invoice Custom outside the allowed range: PAYMENT_SELECTION_INVALID, nothing charged', r.status === 409 && r.json?.code === 'PAYMENT_SELECTION_INVALID' && w.stripe.calls.length === 0);
    const w2 = newWorld();
    const id2 = await seedOrder(w2, { status: 'draft', invoice: true, dd: 5000, bd: 10000, selType: 'custom', selCents: 1 });
    const r2 = await callHandler(deposit(w2), { orderId: id2, invoiceToken: tok(id2), paymentAmountCents: 1 }, ANON_KEY);
    ok('Admin Invoice Custom below the required deposit: refused, even if the browser sends the same small amount', r2.status === 409 && w2.stripe.calls.length === 0);
  }
  {
    // a booking request that is only a draft (not an invoice) can never be paid by its customer
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: false });
    const r = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    ok('a non-invoice draft cannot be charged by its customer', r.status === 409 && r.json?.code === 'ORDER_STATUS_NOT_PAYABLE' && w.stripe.calls.length === 0);
  }
  {
    // a true $0 invoice: no positive charge is attempted
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 0, bd: 0 });
    const r = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    ok('a $0 invoice: NO_DEPOSIT_DUE and no charge of any kind', r.status === 400 && r.json?.code === 'NO_DEPOSIT_DUE' && allCreateAttempts(w).length === 0 && (await payRows(id)).length === 0);
  }
  {
    // invoice return path twice (a page refresh): the second call is already paid, not a second charge
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 5000, bd: 10000, selType: 'deposit', selCents: 5000 });
    const r1 = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    const r2 = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    ok('invoice return path refreshed: the second request is refused or reports paid; one charge in total', r1.status === 200 && w.stripe.succeededCount === 1 && (r2.status === 409 || r2.json?.alreadyCharged === true));
  }

  // =================================================================================================================
  // 7. Admin balance charge (the real "Charge card on file" button)
  // =================================================================================================================
  const adminBalance = (w: World, id: string, amount: unknown, extra: Record<string, unknown> = {}) =>
    callHandler(deposit(w), { orderId: id, paymentAmountCents: amount, tipCents: 0, selectedPaymentType: 'balance', ...extra }, 'jwt-admin');
  {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, tip: 3000 });
    const r = await adminBalance(w, id, 4000);
    eq('admin balance charge: one charge for the amount asked (inside the server balance)', [r.status, creates(w).map((c) => c.params.amount)], [200, [4000]]);
    eq('admin balance charge: balance paid and due move by the principal; the stored tip is NOT erased', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 6000, bp: 4000, tip: 3000, sps: 'unpaid' });
    eq('admin balance charge: one balance ledger row with the components', (await payRows(id)).map((p: any) => [p.type, p.status, p.principal_amount_cents, p.tip_amount_cents, p.order_financials_applied]), [['balance', 'succeeded', 4000, 0, true]]);
    ok('admin balance charge: no booking-confirmation lifecycle call and no deposit email', lifecycleCalls(w).length === 0 && emails(w) === 0);
    // the webhook then arrives for the same PaymentIntent: it must not apply it a second time
    const wh = await webhookFor(w);
    await wh.succeeded(Object.values(w.stripe.paymentIntents_)[0] as any);
    await wh.succeeded(Object.values(w.stripe.paymentIntents_)[0] as any);
    eq('admin balance charge then webhook (twice): still applied exactly once', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 6000, bp: 4000, tip: 3000, sps: 'unpaid' });
    const again = await adminBalance(w, id, 6000);
    ok('a second admin charge for the rest works and the balance reaches zero, never below', again.status === 200 && (await snapshot(id)).bd === 0 && (await snapshot(id)).bp === 10000);
  }
  {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 });
    const r = await adminBalance(w, id, 10001);
    ok('admin balance charge above the balance is refused (BALANCE_CHANGED), zero Stripe calls', r.status === 409 && r.json?.code === 'BALANCE_CHANGED' && w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
    const none = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 0 });
    const r2 = await adminBalance(w, none, 500);
    ok('admin balance charge against a balance that is already zero: success with nothing charged', r2.status === 200 && r2.json?.alreadyCharged === true && w.stripe.calls.length === 0);
  }
  for (const [label, amount, code] of [['fractional', 100.5, 'INVALID_AMOUNT'], ['negative', -100, 'INVALID_AMOUNT'], ['text', '100', 'INVALID_AMOUNT'], ['missing', undefined, 'INVALID_AMOUNT']] as Array<[string, unknown, string]>) {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 });
    const r = await adminBalance(w, id, amount);
    ok(`admin balance charge with a ${label} amount: ${code}, zero Stripe calls`, r.status === 400 && r.json?.code === code && w.stripe.calls.length === 0);
  }
  {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 });
    const r = await callHandler(deposit(w), { orderId: id, paymentAmountCents: 1000, selectedPaymentType: 'balance', invoiceToken: tok(id) }, ANON_KEY);
    ok('a customer cannot run a balance charge through charge-deposit', (r.status === 401 || r.status === 403) && w.stripe.calls.length === 0);
    const crew = await callHandler(deposit(w), { orderId: id, paymentAmountCents: 1000, selectedPaymentType: 'balance' }, 'jwt-crew');
    ok('crew cannot charge a card', crew.status === 403 && w.stripe.calls.length === 0);
    const svc = await callHandler(deposit(w), { orderId: id, paymentAmountCents: 1000, selectedPaymentType: 'balance' }, SERVICE_KEY);
    ok('the backend (service role) can', svc.status === 200 && creates(w).length === 1);
  }
  {
    // admin balance charge with a tip chosen by staff is added, never replaces
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, tip: 1000 });
    const r = await adminBalance(w, id, 5000, { tipCents: 500 });
    eq('admin balance charge with a tip: gross is principal plus tip; the tip is added to the stored tip', [r.status, creates(w).map((c) => c.params.amount), (await snapshot(id)).tip, (await snapshot(id)).bp], [200, [5500], 1500, 5000]);
  }
  {
    // double click on the admin button
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 });
    const rs = await Promise.all([adminBalance(w, id, 10000), adminBalance(w, id, 10000)]);
    eq('admin balance charge double click: exactly one charge', allCreateAttempts(w).length, 1);
    eq('admin balance charge double click: balance cleared once', [(await snapshot(id)).bp, (await snapshot(id)).bd], [10000, 0]);
    ok('... the other request was refused or saw nothing left to pay', rs.filter((r) => r.json?.paymentDetails).length === 1);
  }

  // =================================================================================================================
  // 8. Customer balance payment
  // =================================================================================================================
  const payBalance = (w: World, id: string, amount: unknown, tip: unknown = 0, extra: Record<string, unknown> = {}, bearer: string | null = ANON_KEY) =>
    callHandler(balance(w), { orderId: id, amountCents: amount, tipCents: tip, invoiceToken: tok(id), ...extra }, bearer);
  const confirmedOrder = (w: World, extra: Seed = {}) => seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, ...extra });
  {
    const w = newWorld();
    const id = await confirmedOrder(w, { withCustomer: true });
    const r = await payBalance(w, id, 5000);
    eq('balance: 5000 of a 10000 balance is allowed', [r.status, r.json?.success, creates(w).map((c) => c.params.amount)], [200, true, [5000]]);
    eq('balance: the order shows 5000 paid and 5000 left', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 5000, bp: 5000, tip: 0, sps: 'unpaid' });
    ok('balance: the charge carries a stable idempotency key and names its operation', /:pi$/.test(creates(w)[0].key ?? '') && !!creates(w)[0].params.metadata.payment_operation_key);
    eq('balance: one receipt and one email, sent by the request that applied the payment', [w.tables.transaction_receipts.length, w.fetches.filter((f) => /send-email/.test(f.url)).length], [1, 1]);
  }
  {
    const w = newWorld();
    const id = await confirmedOrder(w);
    const r = await payBalance(w, id, 20000);
    ok('balance: 20000 against a 10000 balance cannot be charged (OVER_BALANCE)', r.status === 400 && r.json?.code === 'OVER_BALANCE' && w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
    const r2 = await payBalance(w, id, 10001, 5000);
    ok('balance: a tip never raises the permitted principal', r2.status === 400 && w.stripe.calls.length === 0);
  }
  {
    const w = newWorld();
    const id = await confirmedOrder(w, { tip: 500 });
    const r = await payBalance(w, id, 10000, 2000);
    eq('balance: principal 10000 plus tip 2000 is one 12000 charge', [r.status, creates(w).map((c) => c.params.amount)], [200, [12000]]);
    eq('balance: ... rental principal 10000 applied; the tip is added to the stored tip, apart from principal', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 0, bp: 10000, tip: 2500, sps: 'unpaid' });
    eq('balance: ... the ledger row records gross, principal and tip', (await payRows(id)).map((p: any) => [p.amount_cents, p.principal_amount_cents, p.tip_amount_cents]), [[12000, 10000, 2000]]);
    eq('balance: ... the Stripe metadata states the split', [creates(w)[0].params.metadata.principal_cents, creates(w)[0].params.metadata.tip_cents], ['10000', '2000']);
  }
  {
    // two simultaneous requests for the whole balance: only one charge
    const w = newWorld();
    const id = await confirmedOrder(w);
    const rs = await Promise.all([payBalance(w, id, 10000), payBalance(w, id, 10000)]);
    eq('balance: two simultaneous 10000 requests create exactly one Stripe charge', allCreateAttempts(w).length, 1);
    eq('balance: ... applied once; nothing left to pay', [(await snapshot(id)).bp, (await snapshot(id)).bd, (await payRows(id)).length], [10000, 0, 1]);
    ok('balance: ... exactly one request was paid; the other was told a payment is in progress or that nothing is owed', rs.filter((r) => r.json?.success === true).length === 1 && rs.every((r) => [200, 400, 409].includes(r.status)));
    const third = await payBalance(w, id, 10000);
    ok('balance: once paid, asking again is refused as over the (now zero) balance', third.status === 400 && w.stripe.succeededCount === 1);
  }
  {
    // a retry after a lost response
    const w = newWorld();
    const id = await confirmedOrder(w);
    w.stripe.behaviors.push('succeed_then_connection_error');
    const r1 = await payBalance(w, id, 10000, 1000);
    ok('balance: a lost Stripe response is reported as unconfirmed and retry-safe', r1.status === 202 && r1.json?.retrySafe === true && (await snapshot(id)).bp === 0);
    const r2 = await payBalance(w, id, 10000, 1000);
    ok('balance: the retry succeeds', r2.status === 200 && r2.json?.success === true);
    eq('balance: the retry used the SAME key and Stripe took the money once', [new Set(allCreateAttempts(w).map((c) => c.key)).size, w.stripe.createdCount, w.stripe.charged], [1, 1, 11000]);
    eq('balance: applied once', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 0, bp: 10000, tip: 1000, sps: 'unpaid' });
  }
  {
    // the same request retried after the payment completed is not a second charge
    const w = newWorld();
    const id = await confirmedOrder(w);
    await payBalance(w, id, 4000);
    const again = await payBalance(w, id, 4000);
    eq('balance: a second identical request is a new, smaller payment of what remains (6000 left, 4000 more is fine)', [again.status, w.stripe.succeededCount], [200, 2]);
    const over = await payBalance(w, id, 4000);
    ok('balance: ... but a third that exceeds the 2000 left is refused', over.status === 400 && w.stripe.succeededCount === 2);
  }
  // malformed values are refused before Stripe
  for (const [label, amount, tip] of [
    ['a negative tip', 1000, -1], ['a fractional tip', 1000, 10.5], ['a text tip', 1000, '100'], ['a null tip', 1000, null], ['a negative amount', -1000, 0],
    ['a fractional amount', 1000.5, 0], ['a text amount', '1000', 0], ['NaN', NaN, 0], ['a huge tip', 1000, 1e12], ['nothing at all', 0, 0],
  ] as Array<[string, unknown, unknown]>) {
    const w = newWorld();
    const id = await confirmedOrder(w);
    const r = await payBalance(w, id, amount, tip);
    ok(`balance: ${label} is refused (400) before any lookup of Stripe`, r.status === 400 && w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
  }
  {
    // tip only
    const w = newWorld();
    const id = await confirmedOrder(w, { bd: 0 });
    const r = await payBalance(w, id, 0, 2000);
    eq('balance: a tip-only payment charges just the tip and leaves the balance alone', [r.status, creates(w).map((c) => c.params.amount), await snapshot(id)], [200, [2000], { status: 'confirmed', dp: 5000, bd: 0, bp: 0, tip: 2000, sps: 'unpaid' }]);
  }
  for (const st of ['draft', 'pending_review', 'awaiting_customer_approval', 'cancelled', 'void']) {
    const w = newWorld();
    const id = await seedOrder(w, { status: st, dd: 5000, dp: 5000, bd: 10000 });
    const r = await payBalance(w, id, 1000);
    ok(`balance: not payable on a ${st} order (409), zero Stripe calls`, r.status === 409 && w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
  }
  {
    const w = newWorld();
    const id = await confirmedOrder(w);
    const none = await callHandler(balance(w), { orderId: id, amountCents: 1000, tipCents: 0 }, ANON_KEY);
    const wrong = await callHandler(balance(w), { orderId: id, amountCents: 1000, tipCents: 0, invoiceToken: 'x'.repeat(40) }, ANON_KEY);
    ok('balance: no proof and a wrong proof are refused with zero Stripe calls', [none.status, wrong.status].every((s) => s === 401 || s === 403) && w.stripe.calls.length === 0);
  }
  {
    // declined card -> Checkout, with a new operation that owns the session
    const w = newWorld();
    const id = await confirmedOrder(w);
    w.stripe.behaviors.push('decline');
    const r = await payBalance(w, id, 6000, 1000);
    ok('balance: a declined card falls back to Checkout and returns a URL', r.status === 200 && /^https:\/\/checkout\.fake\//.test(r.json?.url ?? ''));
    const rows = await payRows(id);
    eq('balance: the declined card operation is closed; the Checkout operation is open with its session recorded and no owner', rows.map((p: any) => [p.status, !!p.stripe_checkout_session_id, p.claim_id]), [['failed', false, null], ['pending', true, null]]);
    const session = Object.values(w.stripe.sessions_)[0] as any;
    eq('balance: the session amount is the server principal plus tip', session.amount_total, 7000);
    ok('balance: the session carries the operation key and a stable idempotency key', session.metadata.payment_operation_key === rows[1].operation_key && w.stripe.calls.find((c) => c.api === 'checkout.sessions.create')?.key === `${rows[1].operation_key}:cs`);
    ok('balance: the session expires (so an abandoned one cannot be paid later)', typeof w.stripe.calls.find((c) => c.api === 'checkout.sessions.create')?.params.expires_at === 'number');
    eq('balance: nothing is applied until the customer pays', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 0, sps: 'unpaid' });

    // the same request again reuses the same session
    const again = await payBalance(w, id, 6000, 1000);
    eq('balance: asking again reuses the same open session (no second session)', [again.json?.url, w.stripe.count('checkout.sessions.create')], [r.json.url, 1]);

    // the customer pays; the webhook and the reconciler arrive (in either order, repeatedly)
    const paid = w.stripe.paySession(session.id);
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted(paid.session, wh.client, w.stripe);
    eq('Checkout paid, webhook delivered: applied once', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 4000, bp: 6000, tip: 1000, sps: 'unpaid' });
    await wh.handlers.handleCheckoutSessionCompleted(paid.session, wh.client, w.stripe);
    const recon = await callHandler(loadHandler('reconcile-balance-payment', w, { ...shared }), { sessionId: session.id, orderId: id }, ANON_KEY);
    ok('Checkout paid: the reconciler after the webhook reports it already reconciled', recon.status === 200 && recon.json?.alreadyReconciled === true);
    eq('Checkout paid: a replayed webhook and the reconciler changed nothing', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 4000, bp: 6000, tip: 1000, sps: 'unpaid' });
    eq('Checkout paid: one succeeded Checkout row, one receipt email in total', [(await payRows(id)).filter((p: any) => p.status === 'succeeded').length, emails(w)], [1, 1]);
    ok('Checkout paid: the row remembers the PaymentIntent and the session', !!(await payRows(id))[1].stripe_payment_intent_id && (await payRows(id))[1].stripe_checkout_session_id === session.id);
  }
  {
    // the reconciler first, then the webhook
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const r = await payBalance(w, id, 10000, 0);
    ok('balance: an order with no saved card goes straight to Checkout', r.status === 200 && !!r.json?.url && allCreateAttempts(w).length === 0);
    const session = Object.values(w.stripe.sessions_)[0] as any;
    const paid = w.stripe.paySession(session.id);
    const recon = await callHandler(loadHandler('reconcile-balance-payment', w, { ...shared }), { sessionId: session.id, orderId: id }, ANON_KEY);
    ok('reconcile first: applied', recon.status === 200 && recon.json?.success === true && recon.json?.alreadyReconciled === false);
    eq('reconcile first: the order is settled', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 0, bp: 10000, tip: 0, sps: 'unpaid' });
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted(paid.session, wh.client, w.stripe);
    await wh.succeeded(w.stripe.paymentIntents_[paid.paymentIntent.id]);
    eq('reconcile first, then the webhook (both event types): nothing applied twice', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 0, bp: 10000, tip: 0, sps: 'unpaid' });
    eq('reconcile first: one receipt email (from the reconciler that applied it)', emails(w), 1);
    const again = await callHandler(loadHandler('reconcile-balance-payment', w, { ...shared }), { sessionId: session.id, orderId: id }, ANON_KEY);
    ok('reconciling twice is a no-op', again.json?.alreadyReconciled === true);
  }
  {
    // reconcile refuses sessions it cannot tie to an operation or an order
    const w = newWorld();
    const id = await confirmedOrder(w);
    const other = await confirmedOrder(w);
    const orphan = { id: 'cs_orphan', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 4000, metadata: { order_id: id, payment_type: 'balance', tip_cents: '0' }, customer: 'cus_1', payment_intent: 'pi_orphan' };
    w.stripe.sessions_.cs_orphan = orphan;
    w.stripe.paymentIntents_.pi_orphan = { id: 'pi_orphan', amount: 4000, amount_received: 4000, status: 'succeeded', payment_method: 'pm_card', latest_charge: null, metadata: {} };
    const recon = loadHandler('reconcile-balance-payment', w, { ...shared });
    const r1 = await callHandler(recon, { sessionId: 'cs_orphan', orderId: id }, ANON_KEY);
    ok('reconcile: a paid session that names no payment operation is NOT turned into a payment (409)', r1.status === 409 && r1.json?.code === 'PAYMENT_OPERATION_MISSING' && (await snapshot(id)).bp === 0 && (await payRows(id)).length === 0);
    const r2 = await callHandler(recon, { sessionId: 'cs_orphan', orderId: other }, ANON_KEY);
    ok('reconcile: a session for another order is refused', r2.status === 400 && (await snapshot(other)).bp === 0);
    const pending = await payBalance(w, id, 2000, 0, {}, ANON_KEY);
    void pending;
    const forged = { ...orphan, id: 'cs_forged', payment_intent: 'pi_orphan', metadata: { order_id: id, payment_type: 'balance', payment_operation_key: 'bpc-pay-forged', payment_id: '00000000-0000-4000-8000-000000000000' } };
    w.stripe.sessions_.cs_forged = forged;
    const r3 = await callHandler(recon, { sessionId: 'cs_forged', orderId: id }, ANON_KEY);
    ok('reconcile: a session that names an operation that does not exist is refused (409)', r3.status === 409 && (await snapshot(id)).bp === 2000);
    const unpaid = { ...orphan, id: 'cs_unpaid', payment_status: 'unpaid' };
    w.stripe.sessions_.cs_unpaid = unpaid;
    const r4 = await callHandler(recon, { sessionId: 'cs_unpaid', orderId: id }, ANON_KEY);
    ok('reconcile: an unpaid session is reported as not complete', r4.status === 200 && r4.json?.reason === 'payment_not_complete');
  }
  {
    // an abandoned Checkout session is replaced (never two payable sessions)
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const r1 = await payBalance(w, id, 10000, 0);
    const s1 = Object.values(w.stripe.sessions_)[0] as any;
    const r2 = await payBalance(w, id, 10000, 500);
    const sessions = Object.values(w.stripe.sessions_) as any[];
    ok('a different request while a session is open replaces it: the first session is expired and a second is offered', r1.status === 200 && r2.status === 200 && sessions.length === 2 && s1.status === 'expired' && sessions[1].status === 'open');
    eq('... the first operation is cancelled and exactly one is open', (await payRows(id)).map((p: any) => p.status), ['cancelled', 'pending']);
    // the admin charges the card instead while the second session is open
    await pg.exec(`UPDATE public.orders SET stripe_customer_id = 'cus_1', stripe_payment_method_id = 'pm_card' WHERE id = '${id}';`);
    const adminRes = await adminBalance(w, id, 10000);
    ok('an admin charge while a session is open: the session is expired and the card is charged once', adminRes.status === 200 && sessions[1].status === 'expired' && w.stripe.succeededCount === 1);
    eq('... one balance application, nothing double counted', [(await snapshot(id)).bp, (await snapshot(id)).bd], [10000, 0]);
  }
  {
    // the customer already paid the session, but nobody has processed it yet: a new request settles it instead of opening another
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    await payBalance(w, id, 10000, 0);
    const session = Object.values(w.stripe.sessions_)[0] as any;
    const paid = w.stripe.paySession(session.id);
    const r = await payBalance(w, id, 10000, 0);
    ok('a paid session is settled by the next request (no new session, no second charge)', r.status === 200 && r.json?.alreadyPaid === true && w.stripe.count('checkout.sessions.create') === 1);
    eq('... applied once', [(await snapshot(id)).bp, (await snapshot(id)).bd], [10000, 0]);
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted(paid.session, wh.client, w.stripe);
    eq('... and the late webhook changes nothing', [(await snapshot(id)).bp, (await payRows(id)).length], [10000, 1]);
  }

  // =================================================================================================================
  // 9. A crashed request is recovered without a second charge
  // =================================================================================================================
  const ownedAgo = (id: string, seconds: number) => pg.exec(`UPDATE public.payments SET claim_id = gen_random_uuid(), claimed_at = now() - interval '${seconds} seconds' WHERE order_id = '${id}' AND status = 'pending';`);
  {
    // claim taken, Stripe accepted the charge, the process died before anything else (the lease is still held)
    const w = newWorld();
    const id = await seedOrder(w, { tip: 1000 });
    w.stripe.behaviors.push('succeed_then_connection_error');
    await accept(w, id);
    await ownedAgo(id, 100);
    const fresh = await accept(w, id);
    ok('a crashed request whose lease is only 100 seconds old still owns the operation: PAYMENT_IN_PROGRESS', fresh.status === 409 && fresh.json?.code === 'PAYMENT_IN_PROGRESS' && allCreateAttempts(w).length === 1);
    await ownedAgo(id, 400);
    const later = await accept(w, id);
    ok('after the lease goes stale the next request RESUMES the same operation', later.status === 200 && later.json?.success === true);
    eq('... with the same idempotency key: one PaymentIntent, one charge, one applied deposit', [new Set(allCreateAttempts(w).map((c) => c.key)).size, w.stripe.createdCount, w.stripe.charged, (await snapshot(id)).dp], [1, 1, 6000, 5000]);
  }
  {
    // claim taken and the process died before Stripe was called at all
    const w = newWorld();
    const id = await seedOrder(w, {});
    const client = (await import('./paymentHarness')).makeClient(w);
    const claimed = await payOps.claimPaymentOperation(client, { orderId: id, purpose: 'deposit', actor: 'staff', claimId: '99999999-9999-4999-8999-000000000002' });
    ok('setup: an operation exists and its owner "dies"', claimed.ok);
    await ownedAgo(id, 600);
    const r = await accept(w, id);
    ok('a claim that died before Stripe is resumed and then charged exactly once', r.status === 200 && w.stripe.createdCount === 1 && (await payRows(id)).length === 1 && (await snapshot(id)).dp === 5000);
  }
  {
    // a stale claim from a request that was slow, not dead: it cannot finalize or release the newer owner's operation
    const w = newWorld();
    const id = await seedOrder(w, {});
    const client = (await import('./paymentHarness')).makeClient(w);
    const old = await payOps.claimPaymentOperation(client, { orderId: id, purpose: 'deposit', actor: 'staff', claimId: '99999999-9999-4999-8999-000000000003' });
    await ownedAgo(id, 600);
    const next = await payOps.claimPaymentOperation(client, { orderId: id, purpose: 'deposit', actor: 'staff', claimId: '99999999-9999-4999-8999-000000000004' });
    if (!old.ok || !next.ok) throw new Error('setup failed');
    const f = await payOps.finalizeOperation(client, { paymentId: old.op.paymentId, claimId: old.op.claimId, paymentIntentId: 'pi_slow', amountReceivedCents: old.op.grossCents });
    const rl = await payOps.releaseOperation(client, old.op, 'failed');
    ok('stale owner: cannot finalize and cannot release the newer owner\'s operation', f.outcome === 'not_owner' && rl === false);
    eq('... the newer owner still holds an open operation and nothing was applied', [(await payRows(id)).map((p: any) => [p.status, p.claim_id === next.op.claimId]), (await snapshot(id)).dp], [[['pending', true]], 0]);
  }
  {
    // beyond Stripe's replay window (counted from the FIRST provider request) the operation is looked up, never blindly created again
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('succeed_then_connection_error');
    await accept(w, id);
    await pg.exec(`UPDATE public.payments SET provider_attempted_at = now() - interval '14 hours' WHERE order_id = '${id}';`);
    const r = await accept(w, id);
    ok('old unfinished operation: found by its metadata at Stripe and finalized, no new charge', r.status === 200 && w.stripe.count('paymentIntents.search') === 1 && allCreateAttempts(w).length === 1 && w.stripe.createdCount === 1 && (await snapshot(id)).dp === 5000);
    const w2 = newWorld();
    const id2 = await seedOrder(w2, {});
    w2.stripe.behaviors.push('connection_error_before');
    await accept(w2, id2);
    await pg.exec(`UPDATE public.payments SET provider_attempted_at = now() - interval '14 hours' WHERE order_id = '${id2}';`);
    w2.stripe.searchMode = 'miss';
    const r2 = await accept(w2, id2);
    ok('old attempted operation, lookup finds nothing: NOT closed and NOT blindly created again; the status is unknown', r2.status === 202 && r2.json?.code === 'PAYMENT_STATUS_UNKNOWN' && w2.stripe.createdCount === 0 && allCreateAttempts(w2).length === 1 && (await payRows(id2))[0].status === 'pending');
    const r3 = await accept(w2, id2);
    ok('... and it stays that way on every retry (no fresh operation)', r3.status === 202 && (await payRows(id2)).length === 1 && w2.stripe.createdCount === 0);
  }

  // =================================================================================================================
  // 10. Card save is not payment (Admin Invoice) and a booking request never charges
  // =================================================================================================================
  const setupSession = (id: string, extra: Record<string, unknown> = {}) => ({ id: `cs_setup_${id.slice(-6)}`, mode: 'setup', setup_intent: 'seti_1', customer: 'cus_1', payment_method: null, metadata: { order_id: id, payment_type: 'card_update', tip_cents: '0' }, ...extra });
  for (const [label, seed, expectStatus, expectLifecycle] of [
    ['an Admin Invoice with a deposit due', { status: 'draft', invoice: true, dd: 5000, dp: 0, bd: 10000 }, 'draft', []],
    ['an Admin Invoice with a Full or Custom amount required (deposit due)', { status: 'draft', invoice: true, dd: 5000, dp: 0, bd: 10000, selType: 'full', selCents: 15000 }, 'draft', []],
    ['an Admin Invoice whose deposit is only part paid', { status: 'draft', invoice: true, dd: 5000, dp: 2000, bd: 8000 }, 'draft', []],
    ['an Admin Invoice with an explicit $0 deposit and a card required', { status: 'draft', invoice: true, dd: 0, bd: 15000 }, 'confirmed', ['zero_due_with_card']],
    ['an Admin Invoice whose deposit is already paid', { status: 'draft', invoice: true, dd: 5000, dp: 5000, bd: 10000 }, 'confirmed', ['charged_now']],
    ['a booking request', { status: 'draft', invoice: false, dd: 5000, dp: 0, bd: 10000 }, 'pending_review', [undefined]],
  ] as Array<[string, Seed, string, Array<string | undefined>]>) {
    for (const via of ['checkout.session.completed', 'setup_intent.succeeded']) {
      const w = newWorld();
      const id = await seedOrder(w, seed);
      const wh = await webhookFor(w);
      if (via === 'checkout.session.completed') await wh.handlers.handleCheckoutSessionCompleted(setupSession(id), wh.client, w.stripe);
      else await wh.handlers.handleSetupIntentSucceeded({ id: 'seti_1', metadata: { order_id: id }, payment_method: 'pm_card', customer: 'cus_1' }, wh.client, w.stripe);
      const snap = await snapshot(id);
      eq(`card saved (${via}) for ${label}: status`, snap.status, expectStatus);
      eq(`card saved (${via}) for ${label}: lifecycle outcome`, lifecycleCalls(w).map((c) => c.body.paymentOutcome), expectLifecycle);
      ok(`card saved (${via}) for ${label}: the card is stored, and nothing is charged or recorded`, (await orderRow(id)).stripe_payment_method_id === 'pm_card' && w.stripe.calls.every((c) => !c.api.startsWith('paymentIntents.create')) && (await payRows(id)).length === 0 && snap.dp === (seed.dp ?? 0));
    }
  }
  {
    // two invoice links on one order (the lookup must not fail and treat it as a booking)
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 5000, bd: 10000 });
    await pg.exec(`INSERT INTO public.invoice_links (order_id, link_type, link_token, expires_at) VALUES ('${id}', 'invoice', 'second-${tok(id)}', now() + interval '1 day');`);
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted(setupSession(id), wh.client, w.stripe);
    eq('two invoice links: still recognized as an Admin Invoice (not confirmed, not sent to review)', (await snapshot(id)).status, 'draft');
  }
  {
    // the invoice is confirmed by the PAYMENT that follows the card save
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 5000, bd: 10000, selType: 'deposit', selCents: 5000 });
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted(setupSession(id), wh.client, w.stripe);
    eq('invoice: card saved, still unconfirmed', (await snapshot(id)).status, 'draft');
    const r = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id), sessionId: 'cs_x' }, ANON_KEY);
    ok('invoice: the charge that follows succeeds', r.status === 200 && r.json?.success === true);
    eq('invoice: only now is it confirmed, with the deposit recorded', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 0, sps: 'paid' });
    eq('invoice: one charge', w.stripe.succeededCount, 1);
  }
  {
    // payment declined after the card save: the invoice stays unconfirmed
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 5000, bd: 10000, selType: 'deposit', selCents: 5000 });
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted(setupSession(id), wh.client, w.stripe);
    w.stripe.behaviors.push('decline');
    const r = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    ok('invoice: a declined deposit leaves the invoice unconfirmed', r.status === 400 && (await snapshot(id)).status === 'draft' && (await snapshot(id)).dp === 0);
  }

  // stripe-checkout never creates a charge
  {
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dp: 5000, bd: 10000 });
    const co = loadHandler('stripe-checkout', w, { ...shared });
    for (const [label, bearer, extra] of [
      ['anonymous with a token', ANON_KEY, { invoiceLinkToken: tok(id) }],
      ['an admin', 'jwt-admin', {}],
      ['the backend', SERVICE_KEY, {}],
    ] as Array<[string, string, Record<string, unknown>]>) {
      const r = await callHandler(co, { orderId: id, depositCents: 100, tipCents: 5, ...extra }, bearer);
      ok(`stripe-checkout payment mode (${label}) is retired: 410 and no session`, r.status === 410 && r.json?.code === 'PAYMENT_MODE_RETIRED' && w.stripe.count('checkout.sessions.create') === 0);
    }
    const noAmount = await callHandler(co, { orderId: id }, SERVICE_KEY);
    ok('stripe-checkout with no mode at all is also refused', noAmount.status === 410 && w.stripe.calls.length === 0);
  }
  {
    // booking request end to end: the customer only saves a card; the Admin's approval is the first and only charge
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: false, card: false, dd: 5000, bd: 10000, tip: 1500 });
    const co = loadHandler('stripe-checkout', w, { ...shared });
    const r = await callHandler(co, { orderId: id, bookingMode: true, origin: 'https://site.fake' }, SERVICE_KEY);
    ok('booking: stripe-checkout creates a card-saving session', r.status === 200 && !!r.json?.url);
    const session = Object.values(w.stripe.sessions_)[0] as any;
    const params = w.stripe.calls.find((c) => c.api === 'checkout.sessions.create')?.params;
    ok('booking: the session is mode=setup with no line items and no payment intent data', session.mode === 'setup' && params.mode === 'setup' && !params.line_items && !params.payment_intent_data);
    ok('booking: ZERO PaymentIntents and ZERO ledger rows after the request is submitted', allCreateAttempts(w).length === 0 && (await payRows(id)).length === 0);
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted({ id: session.id, mode: 'setup', setup_intent: 'seti_b', customer: 'cus_book', metadata: { order_id: id, payment_type: 'booking_request', tip_cents: '1500' } }, wh.client, w.stripe);
    eq('booking: the card is saved and the request waits for review; nothing was charged', [(await snapshot(id)).status, (await snapshot(id)).dp, allCreateAttempts(w).length, (await payRows(id)).length], ['pending_review', 0, 0, 0]);
    eq('booking: the lifecycle moved it to review, not to confirmed', lifecycleCalls(w).map((c) => c.body.action), ['enter_pending_review']);
    const approve = await accept(w, id);
    ok('booking: the Admin approval charges once', approve.status === 200 && approve.json?.success === true);
    eq('booking: exactly one server-derived charge: the required deposit plus the customer\'s tip', creates(w).map((c) => c.params.amount), [6500]);
    eq('booking: confirmed only after the charge, applied once', [await snapshot(id), (await payRows(id)).length], [{ status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 1500, sps: 'paid' }, 1]);
    const second = await accept(w, id);
    ok('booking: approving again does not charge again', allCreateAttempts(w).length === 1 && (second.status === 409 || second.json?.alreadyCharged === true));
  }
  {
    // the retired stripe-charge function never reaches Stripe or the database
    const w = newWorld();
    const handler = loadHandler('stripe-charge', w, { ...shared });
    for (const bearer of [ANON_KEY, 'jwt-admin', SERVICE_KEY]) {
      const r = await callHandler(handler, { orderId: nextId(), amountCents: 5000, paymentType: 'balance', description: 'x' }, bearer);
      ok(`stripe-charge is retired: 410 for ${bearer === ANON_KEY ? 'anonymous' : bearer}`, r.status === 410 && r.json?.code === 'ENDPOINT_RETIRED');
    }
    ok('stripe-charge: no Stripe call and no table access at all', w.stripe.calls.length === 0 && w.log.length === 0 && w.rpcCalls.length === 0);
  }

  // =================================================================================================================
  // 11. Source guards: the unsafe patterns are gone and every provider charge carries an idempotency key
  // =================================================================================================================
  {
    const fsx = require('fs');
    const readSrc = (p: string): string => fsx.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    const fnDir = 'supabase/functions';
    const listTs = (d: string): string[] => fsx.readdirSync(d, { withFileTypes: true }).flatMap((e: any) => (e.name === 'node_modules' ? [] : e.isDirectory() ? listTs(`${d}/${e.name}`) : e.name.endsWith('.ts') ? [`${d}/${e.name}`] : []));
    const all = listTs(fnDir);
    const cd = readSrc(`${fnDir}/charge-deposit/index.ts`);
    const cb = readSrc(`${fnDir}/customer-balance-payment/index.ts`);
    const ops = readSrc(`${fnDir}/_shared/payment-operations.ts`);
    const wh = readSrc(`${fnDir}/stripe-webhook/handlers.ts`);
    ok('source: charge-deposit does not use the boolean payment lock any more', !/payment_lock/.test(cd));
    ok('source: charge-deposit never writes a payment row itself (the database operation does)', !/from\("payments"\)\s*\.insert/.test(cd) && !/from\("payments"\)\s*\.update/.test(cd));
    ok('source: charge-deposit never computes an amount from the request', !/requestPaymentAmountCents\s*[+\-*]/.test(cd) && /requestedPrincipalCents: isBalanceCharge/.test(cd));
    ok('source: charge-deposit only passes a browser amount to the claim for an admin balance charge', (cd.match(/requestedPrincipalCents:/g) ?? []).length === 2);
    ok('source: customer-balance-payment no longer rounds or clamps request values into shape', !/Math\.round\(Number\(/.test(cb) && !/Math\.max\(0, Math\.round/.test(cb));
    ok('source: every PaymentIntent creation goes through chargeSavedCard (one place, one idempotency key)', all.filter((f: string) => /paymentIntents\.create\(/.test(readSrc(f))).join(',') === `${fnDir}/_shared/payment-operations.ts`);
    ok('source: that creation passes an idempotency key built from the persisted operation key', /\{ idempotencyKey: operationIdempotencyKey\(op, "pi"\) \}/.test(ops));
    ok('source: the Checkout Session for a balance payment passes an idempotency key', /\{ idempotencyKey: operationIdempotencyKey\(op, "cs"\) \}/.test(cb));
    ok('source: the idempotency key is never random', !/idempotencyKey:\s*(crypto|Math|Date|`[^`]*\$\{(crypto|Math|Date))/.test(ops + cb + cd));
    ok('source: no function still uses the old balance-apply RPC or writes balance_paid_cents directly', !all.some((f: string) => /apply_balance_payment_financials|balance_paid_cents:\s/.test(readSrc(f)) && !/\/migrations\//.test(f)));
    ok('source: the webhook never writes order money columns itself (only the card, the customer, status and a booking tip selection)', (wh.match(/\.update\(\{[\s\S]*?\}\)/g) ?? []).every((u: string) => !/deposit_paid_cents|balance_due_cents|balance_paid_cents|stripe_payment_status/.test(u)));
    ok('source: the webhook decides invoice confirmation from the deposit, not from the card save', /principalOutstanding/.test(wh) && !/isAdminInvoice \? "confirmed" : "pending_review"/.test(wh));
    ok('source: stripe-checkout has no payment-mode branch and no deposit amount from the body', !/mode: "payment"/.test(readSrc(`${fnDir}/stripe-checkout/index.ts`)) && !/depositCents/.test(readSrc(`${fnDir}/stripe-checkout/index.ts`)));
    ok('source: the retired stripe-charge function imports nothing that can reach Stripe or the database', !/createClient|Stripe/.test(readSrc(`${fnDir}/stripe-charge/index.ts`).replace(/\/\/.*$/gm, '')));
    ok('source: only the refund handler inserts payment rows from an Edge Function', all.filter((f: string) => /from\("payments"\)\s*\.insert|from\('payments'\)\s*\.insert/.test(readSrc(f))).join(',') === `${fnDir}/stripe-webhook/handlers.ts`);
    ok('source: the payment operation module keeps the lease short and the amount limit at the provider maximum', /PAYMENT_LEASE_SECONDS = 300/.test(ops) && /MAX_PAYMENT_CENTS = 99_999_999/.test(ops));
    ok('source: no code or migration name carries an internal planning label', !all.concat(['src/lib/paymentHarness.ts']).some((f: string) => /\b(Phase|Stage) ?[A-Z0-9]\b|payment safety phase/i.test(readSrc(f).split('\n').filter((l: string) => /payment-operations|claim_payment_operation/.test(l)).join('\n'))));
  }

  // =================================================================================================================
  // 12. More interleavings
  // =================================================================================================================
  {
    // an unexpected failure after the operation exists gives the lease back but keeps the operation (and its key) open
    const w = newWorld();
    const id = await seedOrder(w, { tip: 500 });
    let boom = true;
    const h = deposit(w, { validatePaymentMethod: async () => { if (boom) throw new Error('boom'); return { valid: true }; } });
    const r1 = await callHandler(h, { orderId: id }, 'jwt-admin');
    ok('an unexpected failure is reported as an error', r1.status === 500);
    eq('... and the operation is open again, owned by nobody, nothing charged', [(await payRows(id)).map((p: any) => [p.status, p.claim_id]), w.stripe.createdCount], [[['pending', null]], 0]);
    boom = false;
    const r2 = await callHandler(h, { orderId: id }, 'jwt-admin');
    ok('... so the very next attempt resumes it at once and charges once', r2.status === 200 && (await payRows(id)).length === 1 && w.stripe.createdCount === 1);
  }
  {
    // customer balance: the webhook applies the payment first; the request must stay quiet
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, withCustomer: true });
    const wh = await webhookFor(w);
    w.beforeRpc.finalize_payment_operation = async () => {
      w.beforeRpc.finalize_payment_operation = () => {};
      await wh.succeeded(Object.values(w.stripe.paymentIntents_)[0] as any);
    };
    const r = await payBalance(w, id, 10000, 500);
    ok('customer balance, webhook first: the request still reports success', r.status === 200 && r.json?.success === true);
    eq('customer balance, webhook first: applied once', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 0, bp: 10000, tip: 500, sps: 'unpaid' });
    eq('customer balance, webhook first: exactly one receipt email (the webhook\'s), no duplicate from the request', emails(w), 1);
  }
  {
    // customer balance: the card charge reached Stripe but the response was lost, and the card is gone before the retry:
    // the payment is found at Stripe and settled; it is not collected a second time through Checkout
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 });
    w.stripe.behaviors.push('succeed_then_connection_error');
    const r1 = await payBalance(w, id, 10000, 0);
    ok('setup: the card charge outcome is unknown', r1.status === 202);
    await pg.exec(`UPDATE public.orders SET stripe_payment_method_id = NULL WHERE id = '${id}';`);
    const r2 = await payBalance(w, id, 10000, 0);
    ok('the charge is found by its operation key and settled, with no Checkout session', r2.status === 200 && r2.json?.success === true && w.stripe.count('checkout.sessions.create') === 0 && w.stripe.createdCount === 1);
    eq('... applied once', [(await snapshot(id)).bp, (await snapshot(id)).bd], [10000, 0]);
  }
  {
    // a card attempt WAS started (its outcome unknown) and the card is gone: Checkout is never offered, at any age
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 });
    w.stripe.behaviors.push('connection_error_before');
    const r1 = await payBalance(w, id, 10000, 0);
    ok('setup: the card attempt was started and its outcome is unknown', r1.status === 202);
    await pg.exec(`UPDATE public.orders SET stripe_payment_method_id = NULL WHERE id = '${id}';`);
    const young = await payBalance(w, id, 10000, 0);
    ok('an unresolved attempted card operation blocks a Checkout alternative: PAYMENT_STATUS_UNKNOWN, no session', young.status === 202 && young.json?.code === 'PAYMENT_STATUS_UNKNOWN' && w.stripe.count('checkout.sessions.create') === 0);
    await pg.exec(`UPDATE public.payments SET created_at = now() - interval '20 hours', provider_attempted_at = now() - interval '20 hours' WHERE order_id = '${id}';`);
    w.stripe.searchMode = 'miss';
    const old = await payBalance(w, id, 10000, 0);
    ok('... and the passage of time (even past the idempotency window) with a lookup miss changes nothing', old.status === 202 && old.json?.code === 'PAYMENT_STATUS_UNKNOWN' && w.stripe.count('checkout.sessions.create') === 0);
    eq('... the ledger still shows the one open card operation', (await payRows(id)).map((p: any) => [p.status, !!p.stripe_checkout_session_id]), [['pending', false]]);
  }
  {
    // no provider request was ever started and the card is gone: the operation is closed and Checkout starts fresh
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000 });
    w.failRpc.mark_payment_operation_provider_attempt = { error: { message: 'marker unavailable' }, times: 1 };
    const r1 = await payBalance(w, id, 10000, 0);
    ok('setup: the card attempt never started a provider request', r1.status === 202 && allCreateAttempts(w).length === 0);
    await pg.exec(`UPDATE public.orders SET stripe_payment_method_id = NULL WHERE id = '${id}';`);
    const r2 = await payBalance(w, id, 10000, 0);
    ok('never attempted: the operation is cancelled and Checkout gets a NEW operation', r2.status === 200 && !!r2.json?.url);
    eq('... the ledger shows one cancelled card operation and one open Checkout operation', (await payRows(id)).map((p: any) => [p.status, !!p.stripe_checkout_session_id]), [['cancelled', false], ['pending', true]]);
  }
  {
    // webhook: payment_failed must not close a Checkout operation (the customer can retry on Stripe's page)
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, card: false });
    await payBalance(w, id, 10000, 0);
    const session = Object.values(w.stripe.sessions_)[0] as any;
    const paid = w.stripe.paySession(session.id);
    await pg.exec(`UPDATE public.payments SET stripe_payment_intent_id = '${paid.paymentIntent.id}' WHERE order_id = '${id}';`);
    const wh = await webhookFor(w);
    await wh.handlers.handlePaymentIntentFailed({ id: paid.paymentIntent.id }, wh.client);
    eq('payment_failed on a Checkout operation leaves it open', (await payRows(id))[0].status, 'pending');
  }
  {
    // webhook: a session that is not paid yet is not a payment
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, card: false });
    await payBalance(w, id, 10000, 0);
    const session = Object.values(w.stripe.sessions_)[0] as any;
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted({ ...session, payment_status: 'unpaid' }, wh.client, w.stripe);
    eq('an unpaid Checkout Session is not applied', [(await snapshot(id)).bp, (await payRows(id))[0].status], [0, 'pending']);
  }
  {
    // webhook: a transient database failure makes Stripe deliver the event again (the event is NOT swallowed)
    const w = newWorld();
    const id = await seedOrder(w, { tip: 100 });
    w.failRpc.finalize_payment_operation = { error: { message: 'db down' }, times: 1 };
    await accept(w, id);
    const pi = Object.values(w.stripe.paymentIntents_)[0] as any;
    const wh = await webhookFor(w);
    w.failRpc.finalize_payment_operation = { error: { message: 'db down' }, times: 1 };
    let threw = false;
    try { await wh.succeeded(pi); } catch { threw = true; }
    ok('webhook: a failed finalize throws so Stripe retries the event', threw);
    await wh.succeeded(pi);
    eq('webhook: the redelivery then applies it once', (await snapshot(id)).dp, 5000);
  }
  {
    // reconcile: when the webhook already applied the payment, the reconciler stays quiet
    const w = newWorld();
    const id = await seedOrder(w, { status: 'confirmed', dd: 5000, dp: 5000, bd: 10000, card: false, withCustomer: true });
    await payBalance(w, id, 10000, 0);
    const session = Object.values(w.stripe.sessions_)[0] as any;
    const paid = w.stripe.paySession(session.id);
    const wh = await webhookFor(w);
    await wh.handlers.handleCheckoutSessionCompleted(paid.session, wh.client, w.stripe);
    const before = emails(w);
    await callHandler(loadHandler('reconcile-balance-payment', w, { ...shared }), { sessionId: session.id, orderId: id }, ANON_KEY);
    eq('reconcile after the webhook sends nothing more', emails(w), before);
  }

  // =================================================================================================================
  // 13. The result helpers themselves
  // =================================================================================================================
  {
    const fake = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) });
    const base = { paymentId: 'p', claimId: 'c', amountReceivedCents: 1 };
    ok('finalize: only "applied" and "already_applied" are success', (await payOps.finalizeOperation(fake({ outcome: 'applied', applied: true }), base)).ok && (await payOps.finalizeOperation(fake({ outcome: 'already_applied' }), base)).ok);
    for (const outcome of ['error', 'not_owner', 'amount_mismatch', 'provider_mismatch', 'provider_conflict', 'not_found', 'invalid_request', 'something_new']) {
      ok(`finalize: "${outcome}" is not success`, !(await payOps.finalizeOperation(fake({ outcome }), base)).ok);
    }
    ok('finalize: a database error is not success', !(await payOps.finalizeOperation(fake(null, { message: 'x' }), base)).ok);
    ok('finalize: an empty answer is not success', !(await payOps.finalizeOperation(fake(null), base)).ok);
    const claimFake = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) });
    const refusal = await payOps.claimPaymentOperation(claimFake({ outcome: 'something_new' }), { orderId: 'o', purpose: 'deposit', actor: 'staff', claimId: 'c' });
    ok('claim: an unknown outcome is a refusal, never an operation', !refusal.ok);
    const dbErr = await payOps.claimPaymentOperation(claimFake(null, { message: 'down' }), { orderId: 'o', purpose: 'deposit', actor: 'staff', claimId: 'c' });
    ok('claim: a database error is a refusal (outcome error), never an operation', !dbErr.ok && dbErr.outcome === 'error');
    ok('isCents accepts whole non-negative cents only', [0, 1, 99999999].every((v) => payOps.isCents(v)) && [-1, 1.5, NaN, Infinity, 100000000, '5', null, undefined, 1e21].every((v) => !payOps.isCents(v)));
    ok('classifyStripeError: card errors are declines, bad requests are invalid, everything else is unknown', payOps.classifyStripeError({ type: 'StripeCardError' }) === 'declined' && payOps.classifyStripeError({ type: 'StripeInvalidRequestError', code: 'x' }) === 'invalid' && payOps.classifyStripeError({ type: 'StripeConnectionError' }) === 'unknown' && payOps.classifyStripeError({ type: 'StripeAPIError' }) === 'unknown' && payOps.classifyStripeError({ type: 'StripeIdempotencyError', code: 'idempotency_key_in_use' }) === 'unknown' && payOps.classifyStripeError(new Error('x')) === 'unknown' && payOps.classifyStripeError(null) === 'unknown');
    ok('the idempotency key is a pure function of the operation key and the purpose of the call', payOps.operationIdempotencyKey({ operationKey: 'k' }, 'pi') === 'k:pi' && payOps.operationIdempotencyKey({ operationKey: 'k' }, 'cs') === 'k:cs' && payOps.operationIdempotencyKey({ operationKey: 'k' }, 'pi') === payOps.operationIdempotencyKey({ operationKey: 'k' }, 'pi'));
  }

  // =================================================================================================================
  // 14. A stale open operation never makes a new provider charge
  // =================================================================================================================
  // An operation is "opened" by a first attempt that never reached Stripe (or whose response was lost): it stays open, owned by
  // nobody, with no PaymentIntent recorded. Then the order changes. Every retry must be refused without a new charge.
  const aged = (id: string, seconds = 300) => pg.exec(`UPDATE public.payments SET created_at = now() - interval '${seconds} seconds' WHERE order_id = '${id}';`);
  // An open operation for which NO provider request was ever started: the durable attempt marker could not be written, so the
  // request stopped before it touched Stripe.
  const openUnreached = async (w: World, run: () => Promise<{ status: number; json: any }>) => {
    w.failRpc.mark_payment_operation_provider_attempt = { error: { message: 'attempt marker unavailable' }, times: 1 };
    return run();
  };
  const noNewCharge = (w: World, attempts: number) => allCreateAttempts(w).length === attempts && w.stripe.succeededCount === 0 && w.stripe.createdCount === 0;
  const opStatuses = async (id: string) => (await payRows(id)).map((p: any) => p.status);

  for (const [label, change, code] of [
    ['the deposit went up', 'deposit_due_cents = 6000, balance_due_cents = 9000', 'ORDER_CHANGED'],
    ['the deposit went down', 'deposit_due_cents = 4000, balance_due_cents = 11000', 'ORDER_CHANGED'],
    ['the order was cancelled', "status = 'cancelled'", 'ORDER_STATUS_NOT_PAYABLE'],
    ['the order was voided', "status = 'void'", 'ORDER_STATUS_NOT_PAYABLE'],
    ['the order went back to the customer for approval', "status = 'awaiting_customer_approval'", 'ORDER_STATUS_NOT_PAYABLE'],
    ['the deposit was part paid by another route', 'deposit_paid_cents = 2000', 'DEPOSIT_CATCH_UP_REVIEW_REQUIRED'],
  ] as Array<[string, string, string]>) {
    const w = newWorld();
    const id = await seedOrder(w, { tip: 0 });
    const first = await openUnreached(w, () => accept(w, id));
    ok(`setup (${label}): the first attempt never reached Stripe and left an open operation`, first.status === 202 && (await opStatuses(id)).join() === 'pending');
    await aged(id);
    await pg.exec(`UPDATE public.orders SET ${change} WHERE id = '${id}';`);
    const retry = await accept(w, id);
    ok(`stale Admin approval, ${label}: refused with ${code}, ZERO new Stripe charge`, retry.status === 409 && retry.json?.code === code && noNewCharge(w, 0));
    eq(`stale Admin approval, ${label}: the stale operation is closed and nothing is applied`, [await opStatuses(id), (await snapshot(id)).dp], [['cancelled'], change.startsWith('deposit_paid') ? 2000 : 0]);
  }

  {
    // balance decreased: the operation (10000) is larger than what is now owed (2000)
    const w = newWorld();
    const id = await confirmedOrder(w);
    const first = await openUnreached(w, () => payBalance(w, id, 10000, 0));
    ok('setup: a customer balance attempt that never reached Stripe left an open operation', first.status === 202);
    await aged(id);
    await pg.exec(`UPDATE public.orders SET balance_due_cents = 2000 WHERE id = '${id}';`);
    const retry = await payBalance(w, id, 10000, 0);
    ok('stale balance operation after the balance decreased: refused, STRIPE CREATE COUNT stays zero, nothing charged', retry.status === 400 && retry.json?.code === 'OVER_BALANCE' && noNewCharge(w, 0));
    const smaller = await payBalance(w, id, 2000, 0);
    ok('... and a fresh, smaller request for what is now owed is a NEW operation that charges once', smaller.status === 200 && w.stripe.succeededCount === 1 && w.stripe.charged === 2000);
  }
  {
    // the Admin changes the required payment of an Admin Invoice before Stripe was reached
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 5000, bd: 10000, selType: 'full', selCents: 15000 });
    const first = await openUnreached(w, () => callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY));
    ok('setup: an Admin Invoice Full attempt never reached Stripe', first.status === 202);
    await aged(id);
    await pg.exec(`UPDATE public.orders SET deposit_due_cents = 7000, balance_due_cents = 8000 WHERE id = '${id}';`);
    const retry = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    ok('stale Full invoice operation after the Admin changed the required payment: refused, zero new charge', retry.status === 409 && retry.json?.code === 'ORDER_CHANGED' && noNewCharge(w, 0));
  }
  {
    // the persisted Custom selection changes before Stripe was reached
    const w = newWorld();
    const id = await seedOrder(w, { status: 'draft', invoice: true, dd: 5000, bd: 10000, selType: 'custom', selCents: 8000 });
    const first = await openUnreached(w, () => callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY));
    ok('setup: an Admin Invoice Custom attempt never reached Stripe', first.status === 202);
    await aged(id);
    await pg.exec(`UPDATE public.orders SET customer_selected_payment_cents = 12000 WHERE id = '${id}';`);
    const retry = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    ok('stale Custom invoice operation after the persisted selection changed: refused, zero new charge', retry.status === 409 && retry.json?.code === 'ORDER_CHANGED' && noNewCharge(w, 0));
    await pg.exec(`UPDATE public.orders SET customer_selected_payment_cents = 99999 WHERE id = '${id}';`);
    const bad = await callHandler(deposit(w), { orderId: id, invoiceToken: tok(id) }, ANON_KEY);
    ok('... and a persisted amount that is no longer valid is refused as such, still zero charge', bad.status === 409 && bad.json?.code === 'PAYMENT_SELECTION_INVALID' && noNewCharge(w, 0));
  }
  {
    // a customer approval page opened against an operation whose order then changed
    const w = newWorld();
    const id = await seedOrder(w, { status: 'awaiting_customer_approval', dd: 5000, bd: 10000, selType: 'deposit', selCents: 5000 });
    const first = await openUnreached(w, () => customer(w, id, { tipCents: 0, expectedDepositDueCents: 5000 }));
    ok('setup: a customer approval attempt never reached Stripe', first.status === 202);
    await aged(id);
    await pg.exec(`UPDATE public.orders SET deposit_due_cents = 6500, balance_due_cents = 8500, customer_selected_payment_cents = 6500 WHERE id = '${id}';`);
    const retry = await customer(w, id, { tipCents: 0, expectedDepositDueCents: 5000 });
    ok('stale customer approval operation: ORDER_CHANGED, zero new charge', retry.status === 409 && retry.json?.code === 'ORDER_CHANGED' && noNewCharge(w, 0));
  }
  {
    // a lease takeover is not a way around revalidation
    const w = newWorld();
    const id = await seedOrder(w, {});
    const first = await openUnreached(w, () => accept(w, id));
    ok('setup: an open operation', first.status === 202);
    await ownedAgo(id, 400);
    await aged(id);
    await pg.exec(`UPDATE public.orders SET deposit_due_cents = 6000, balance_due_cents = 9000 WHERE id = '${id}';`);
    const retry = await accept(w, id);
    ok('stale-lease takeover of an operation whose order changed: refused, zero new charge', retry.status === 409 && retry.json?.code === 'ORDER_CHANGED' && noNewCharge(w, 0));
  }
  // -----------------------------------------------------------------------------------------------------------------
  // Provider ambiguity: an attempted operation is never abandoned on a timer, a lookup miss or a failed lookup
  // -----------------------------------------------------------------------------------------------------------------
  const attemptedAt = async (id: string) => (await payRows(id))[0]?.provider_attempted_at ?? null;
  const ageAttempt = (id: string, seconds: number) => pg.exec(`UPDATE public.payments SET provider_attempted_at = now() - interval '${seconds} seconds' WHERE order_id = '${id}' AND provider_attempted_at IS NOT NULL;`);
  const changeDeposit = (id: string) => pg.exec(`UPDATE public.orders SET deposit_due_cents = 6000, balance_due_cents = 9000 WHERE id = '${id}';`);
  const searches = (w: World) => w.stripe.count('paymentIntents.search');

  {
    // A. a stale operation that never made a provider request is closed with zero Stripe calls of any kind
    const w = newWorld();
    const id = await seedOrder(w, {});
    const first = await openUnreached(w, () => accept(w, id));
    ok('A setup: an open operation and no provider request was ever started', first.status === 202 && (await attemptedAt(id)) === null && w.stripe.calls.filter((c) => c.api.startsWith('paymentIntents')).length === 0);
    await changeDeposit(id);
    w.stripe.searchMode = 'throw';
    const retry = await accept(w, id);
    ok('A: stale + never attempted: ORDER_CHANGED, the operation is cancelled', retry.status === 409 && retry.json?.code === 'ORDER_CHANGED' && (await opStatuses(id)).join() === 'cancelled');
    eq('A: ZERO Stripe PaymentIntent search, create or retrieve calls', w.stripe.calls.filter((c) => c.api.startsWith('paymentIntents')).length, 0);
  }
  {
    // B. the request may have reached Stripe, the response was lost, the order changed, and the lookup finds nothing
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('connection_error_before');
    const first = await accept(w, id);
    ok('B setup: the first request failed in flight; the attempt is durably recorded', first.status === 202 && (await attemptedAt(id)) !== null);
    await changeDeposit(id);
    w.stripe.searchMode = 'miss';
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await accept(w, id));
    ok('B: attempted + changed order + search miss: PAYMENT_STATUS_UNKNOWN every time (a miss is not proof)', results.every((r) => r.status === 202 && r.json?.code === 'PAYMENT_STATUS_UNKNOWN'));
    eq('B: the same single operation stays open; no new operation, no new charge', [await opStatuses(id), allCreateAttempts(w).length, w.stripe.createdCount], [['pending'], 1, 0]);
    ok('B: the provider was asked each time', searches(w) === 3);
    await ageAttempt(id, 14 * 3600);
    await pg.exec(`UPDATE public.payments SET created_at = now() - interval '14 hours' WHERE order_id = '${id}';`);
    const old = await accept(w, id);
    ok('B: even 14 hours later the operation is not closed', old.status === 202 && old.json?.code === 'PAYMENT_STATUS_UNKNOWN' && (await opStatuses(id)).join() === 'pending' && w.stripe.createdCount === 0);
  }
  {
    // C. the lookup itself throws
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('connection_error_before');
    await accept(w, id);
    await changeDeposit(id);
    w.stripe.searchMode = 'throw';
    const retry = await accept(w, id);
    ok('C: search throws: PAYMENT_STATUS_UNKNOWN, the operation stays open, nothing charged, lease given back', retry.status === 202 && retry.json?.code === 'PAYMENT_STATUS_UNKNOWN' && (await opStatuses(id)).join() === 'pending' && (await payRows(id))[0].claim_id === null && w.stripe.createdCount === 0);
    w.stripe.searchMode = 'malformed';
    const bad = await accept(w, id);
    ok('C: a malformed lookup answer is unknown too', bad.status === 202 && bad.json?.code === 'PAYMENT_STATUS_UNKNOWN' && (await opStatuses(id)).join() === 'pending');
  }
  {
    // D. the lookup finds the charge: adopted and reconciled exactly once, even though the order changed afterwards
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('succeed_then_connection_error');
    const first = await accept(w, id);
    ok('D setup: Stripe took the money, the response was lost', first.status === 202 && (await attemptedAt(id)) !== null);
    await changeDeposit(id);
    const retry = await accept(w, id);
    ok('D: found by the lookup: reconciled, no second charge', retry.status === 200 && allCreateAttempts(w).length === 1 && w.stripe.createdCount === 1 && w.stripe.charged === 5000);
    eq('D: applied exactly once', [(await payRows(id)).map((p: any) => [p.status, p.order_financials_applied]), (await snapshot(id)).dp], [[['succeeded', true]], 5000]);
  }
  {
    // E. found at the provider but the id cannot be saved: that is unknown, never "no payment"
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('succeed_then_connection_error');
    await accept(w, id);
    await changeDeposit(id);
    w.failRpc.record_payment_operation_provider = { error: { message: 'save failed' }, times: 1 };
    const retry = await accept(w, id);
    ok('E: found but the record fails: PAYMENT_STATUS_UNKNOWN, the operation stays open, not cancelled, no new charge', retry.status === 202 && retry.json?.code === 'PAYMENT_STATUS_UNKNOWN' && (await opStatuses(id)).join() === 'pending' && w.stripe.createdCount === 1);
    const again = await accept(w, id);
    ok('E: the next attempt (record works) reconciles the charge exactly once', again.status === 200 && w.stripe.createdCount === 1 && (await snapshot(id)).dp === 5000 && (await payRows(id)).length === 1);
  }
  {
    // F. the operation's own age is irrelevant: created long before its first provider request
    for (const secs of [1200, 14 * 3600]) {
      const w = newWorld();
      const id = await seedOrder(w, {});
      await openUnreached(w, () => accept(w, id));
      await pg.exec(`UPDATE public.payments SET created_at = now() - interval '${secs} seconds' WHERE order_id = '${id}';`);
      const ok1 = await accept(w, id);
      ok(`F: created ${secs}s before its first attempt, order unchanged: it charges normally on the idempotency key (no lookup, no blind age rule)`, ok1.status === 200 && w.stripe.createdCount === 1 && searches(w) === 0 && (await attemptedAt(id)) !== null);
    }
    {
      const w = newWorld();
      const id = await seedOrder(w, {});
      await openUnreached(w, () => accept(w, id));
      await pg.exec(`UPDATE public.payments SET created_at = now() - interval '14 hours' WHERE order_id = '${id}';`);
      await changeDeposit(id);
      const r = await accept(w, id);
      ok('F: created 14 hours ago, never attempted, order changed: cancelled with zero Stripe calls', r.status === 409 && r.json?.code === 'ORDER_CHANGED' && w.stripe.calls.filter((c) => c.api.startsWith('paymentIntents')).length === 0 && (await opStatuses(id)).join() === 'cancelled');
    }
    {
      // an attempt older than the provider's idempotency window can no longer be replayed blind: look first, and stay open on a miss
      const w = newWorld();
      const id = await seedOrder(w, {});
      w.stripe.behaviors.push('connection_error_before');
      await accept(w, id);
      await ageAttempt(id, 14 * 3600);
      w.stripe.searchMode = 'miss';
      const r = await accept(w, id);
      ok('F: first attempt 14 hours ago, nothing found: no blind create, PAYMENT_STATUS_UNKNOWN, operation open', r.status === 202 && r.json?.code === 'PAYMENT_STATUS_UNKNOWN' && allCreateAttempts(w).length === 1 && (await opStatuses(id)).join() === 'pending');
      w.stripe.searchMode = 'normal';
    }
  }
  {
    // G. repeated retries after an order change keep the same identity and never produce a second operation
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('connection_error_before');
    await accept(w, id);
    const keyBefore = (await payRows(id))[0].operation_key;
    await changeDeposit(id);
    w.stripe.searchMode = 'miss';
    for (let i = 0; i < 5; i++) await accept(w, id);
    const rows = await payRows(id);
    eq('G: five retries: one operation, same key, still pending, zero new Stripe PaymentIntent', [rows.length, rows[0].operation_key, rows[0].status, w.stripe.createdCount], [1, keyBefore, 'pending', 0]);
  }
  {
    // H. a later webhook reconciles the ambiguous operation exactly once
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('succeed_then_connection_error');
    await accept(w, id);
    await changeDeposit(id);
    w.stripe.searchMode = 'miss';
    const unknown = await accept(w, id);
    ok('H setup: lookup miss with a changed order: unknown, open', unknown.status === 202 && (await opStatuses(id)).join() === 'pending');
    const wh = await webhookFor(w);
    const pi: any = Object.values(w.stripe.paymentIntents_)[0];
    await wh.succeeded(pi);
    await wh.succeeded(pi);
    eq('H: the webhook (twice) applied the money exactly once', [(await payRows(id)).map((p: any) => [p.status, p.order_financials_applied]), (await snapshot(id)).dp, w.stripe.createdCount], [[['succeeded', true]], 5000, 1]);
  }
  {
    // I. the attempt marker is written BEFORE the provider call, and a failed marker means no provider call
    const w = newWorld();
    const id = await seedOrder(w, {});
    let markedBeforeCreate = false;
    const realCreate = w.stripe.paymentIntents.create.bind(w.stripe.paymentIntents);
    w.stripe.paymentIntents.create = async (...args: any[]) => { markedBeforeCreate = (await attemptedAt(id)) !== null; return (realCreate as any)(...args); };
    const r = await accept(w, id);
    ok('I: provider_attempted_at is already durable when paymentIntents.create is called', r.status === 200 && markedBeforeCreate);
    const w2 = newWorld();
    const id2 = await seedOrder(w2, {});
    w2.failRpc.mark_payment_operation_provider_attempt = { error: { message: 'down' }, times: 1 };
    const r2 = await accept(w2, id2);
    ok('I: if the marker cannot be written no provider call is made', r2.status === 202 && allCreateAttempts(w2).length === 0 && (await opStatuses(id2)).join() === 'pending');
  }
  {
    // J. the three lookup answers are different facts and stay different all the way to the caller
    const { makeClient } = await import('./paymentHarness');
    const lookupKinds: string[] = [];
    const scenario = async (mode: 'normal' | 'miss' | 'throw' | 'malformed', opts: { saveFails?: boolean; exists?: boolean } = {}) => {
      const w = newWorld();
      const id = await seedOrder(w, {});
      const client = makeClient(w);
      if (opts.exists) w.stripe.behaviors.push('succeed_then_connection_error');
      else w.stripe.behaviors.push('connection_error_before');
      await accept(w, id);
      await changeDeposit(id);
      w.stripe.searchMode = mode;
      if (opts.saveFails) w.failRpc.record_payment_operation_provider = { error: { message: 'save failed' }, times: 1 };
      const res = await payOps.claimPaymentOperation(client, { orderId: id, purpose: 'deposit', actor: 'staff', claimId: '99999999-9999-4999-8999-000000000031' }, w.stripe);
      return { res, w, id };
    };
    const miss = await scenario('miss');
    const thrown = await scenario('throw');
    const bad = await scenario('malformed');
    const unsaved = await scenario('normal', { saveFails: true, exists: true });
    const found = await scenario('normal', { exists: true });
    const kind = (s: any) => (s.res.ok ? 'ok' : s.res.detail?.lookup ?? s.res.outcome);
    eq('J: a successful empty search is NOT_FOUND', kind(miss), 'not_found');
    eq('J: a search that throws is UNKNOWN', kind(thrown), 'unknown');
    eq('J: a malformed search answer is UNKNOWN', kind(bad), 'unknown');
    eq('J: a found PaymentIntent whose id cannot be saved is UNKNOWN', kind(unsaved), 'unknown');
    eq('J: a found and saved PaymentIntent is adopted', kind(found), 'ok');
    ok('J: every non-found answer keeps the operation open and the status unknown', [miss, thrown, bad, unsaved].every((s) => !s.res.ok && s.res.outcome === 'payment_status_unknown'));
    lookupKinds.push(kind(miss));
  }

  // the provider already has the charge
  {
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('processing');
    const first = await accept(w, id);
    ok('setup: the provider is still processing', first.status === 202 && first.json?.code === 'PAYMENT_PROCESSING');
    await pg.exec(`UPDATE public.orders SET deposit_due_cents = 6000, balance_due_cents = 9000 WHERE id = '${id}';`);
    const retry = await accept(w, id);
    ok('provider processing, order changed since: NO second provider operation; the existing PaymentIntent stays the reconciliation target', retry.status === 202 && allCreateAttempts(w).length === 1 && w.stripe.createdCount === 1 && (await opStatuses(id)).join() === 'pending');
    const piId = (await payRows(id))[0].stripe_payment_intent_id;
    w.stripe.paymentIntents_[piId].status = 'succeeded';
    w.stripe.paymentIntents_[piId].amount_received = w.stripe.paymentIntents_[piId].amount;
    const settled = await accept(w, id);
    ok('... when it succeeds, the actual money is reconciled exactly once', settled.status === 200 && w.stripe.createdCount === 1 && (await opStatuses(id)).join() === 'succeeded' && (await snapshot(id)).dp === 5000);
  }
  {
    // the charge succeeded but the response was lost; the order shrank afterwards. The money that really moved is reconciled once.
    const w = newWorld();
    const id = await seedOrder(w, {});
    w.stripe.behaviors.push('succeed_then_connection_error');
    const first = await accept(w, id);
    ok('setup: Stripe took the money but the response was lost', first.status === 202);
    await pg.exec(`UPDATE public.orders SET deposit_due_cents = 4000, balance_due_cents = 11000 WHERE id = '${id}';`);
    const retry = await accept(w, id);
    ok('provider already succeeded, order changed afterwards: NO second charge; the real payment is reconciled', retry.status === 200 && allCreateAttempts(w).length === 1 && w.stripe.createdCount === 1 && w.stripe.charged === 5000);
    eq('... exactly once, clamped only as recovery of money that already arrived (4000 of deposit applied)', [(await snapshot(id)).dp, (await payRows(id)).map((p: any) => [p.status, p.order_financials_applied]), (await changelog(id)).filter((c: any) => /PAYMENT_EXCEEDS_AMOUNT_DUE/.test(c.notes ?? '')).length], [4000, [['succeeded', true]], 1]);
    const again = await accept(w, id);
    ok('... and asking again does not apply or charge anything', allCreateAttempts(w).length === 1 && (await snapshot(id)).dp === 4000 && again.status !== 500);
  }
  {
    // OVERPAYMENT PREVENTION: an operation whose principal is now larger than the authorized principal and has NOT reached Stripe
    const w = newWorld();
    const id = await confirmedOrder(w);
    const client = (await import('./paymentHarness')).makeClient(w);
    const opened = await payOps.claimPaymentOperation(client, { orderId: id, purpose: 'balance', actor: 'customer', claimId: '99999999-9999-4999-8999-000000000010', requestedPrincipalCents: 10000, requestedTipCents: 0 });
    ok('setup: an operation for 10000 exists and has not reached Stripe', opened.ok);
    if (opened.ok) await payOps.releaseOperation(client, opened.op, null);
    await aged(id);
    await pg.exec(`UPDATE public.orders SET balance_due_cents = 2000 WHERE id = '${id}';`);
    const retry = await payBalance(w, id, 10000, 0);
    eq('overpayment prevention: the principal is now larger than authorized and never reached Stripe: STRIPE CREATE COUNT', [allCreateAttempts(w).length, w.stripe.createdCount, retry.status >= 400], [0, 0, true]);
    eq('... the order is not touched and the stale operation is closed', [await snapshot(id), await opStatuses(id)], [{ status: 'confirmed', dp: 5000, bd: 2000, bp: 0, tip: 0, sps: 'unpaid' }, ['cancelled']]);
  }

  // the state barrier, seen from the handlers: a payment in flight cannot have its authority changed underneath it
  {
    const w = newWorld();
    const id = await seedOrder(w, { tip: 0 });
    let attempted: any[] = [];
    w.beforeRpc.finalize_payment_operation = async () => {
      w.beforeRpc.finalize_payment_operation = () => {};
      // The charge has been made and the request still owns the operation. Try to change what authorized it.
      attempted = await Promise.all([
        pg.query(`UPDATE public.orders SET deposit_due_cents = 6000 WHERE id = '${id}' RETURNING to_jsonb(orders) AS j`),
        pg.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = '${id}' RETURNING to_jsonb(orders) AS j`),
        pg.query(`UPDATE public.orders SET balance_due_cents = 1 WHERE id = '${id}' RETURNING to_jsonb(orders) AS j`),
        pg.query(`UPDATE public.orders SET admin_message = 'still allowed' WHERE id = '${id}' RETURNING to_jsonb(orders) AS j`),
        pg.query(`UPDATE public.orders SET tip_cents = 4000 WHERE id = '${id}' RETURNING to_jsonb(orders) AS j`),
      ]);
    };
    const r = await accept(w, id);
    ok('while the charge is in flight the payment fields cannot be changed (deposit, status, balance, tip), unrelated fields can', r.status === 200 && [0, 1, 2, 4].every((i) => attempted[i]?.__error && /payment is in progress/.test(attempted[i].__error)) && Array.isArray(attempted[3]) && attempted[3].length === 1);
    eq('... and the payment is applied against exactly the state that authorized it', await snapshot(id), { status: 'confirmed', dp: 5000, bd: 10000, bp: 0, tip: 0, sps: 'paid' });
  }

  // =================================================================================================================
  // 15. Defense in depth around stale operations
  // =================================================================================================================
  {
    // a stale CHECKOUT operation is never offered again, even when the customer asks for exactly what it contains
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const r1 = await payBalance(w, id, 10000, 0);
    const s1 = Object.values(w.stripe.sessions_)[0] as any;
    ok('setup: a Checkout session for 10000 is open', r1.status === 200 && !!r1.json?.url && s1.status === 'open');
    await pg.exec(`UPDATE public.orders SET balance_due_cents = 2000 WHERE id = '${id}';`);
    const r2 = await payBalance(w, id, 10000, 0);
    ok('the balance dropped to 2000: the same 10000 request is NOT given the old session; it is refused (OVER_BALANCE)', r2.status === 400 && r2.json?.code === 'OVER_BALANCE' && !r2.json?.url);
    eq('... the stale session was expired at Stripe and its operation cancelled; nothing was charged', [s1.status, await opStatuses(id), w.stripe.succeededCount], ['expired', ['cancelled'], 0]);
    const r3 = await payBalance(w, id, 2000, 0);
    ok('... and a request for what is now owed gets a NEW session', r3.status === 200 && !!r3.json?.url && r3.json.url !== r1.json.url);
  }
  {
    // the very last line of defense: a stale operation with no provider charge can never create one
    const w = newWorld();
    const id = await seedOrder(w, {});
    const client = (await import('./paymentHarness')).makeClient(w);
    const claimed = await payOps.claimPaymentOperation(client, { orderId: id, purpose: 'deposit', actor: 'staff', claimId: '99999999-9999-4999-8999-000000000020' });
    if (!claimed.ok) throw new Error('setup failed');
    const staleOp = { ...claimed.op, stale: true };
    const result = await payOps.chargeSavedCard({ db: client, stripe: w.stripe, op: staleOp, orderId: id, stripeCustomerId: 'cus_1', paymentMethodId: 'pm_card' });
    ok('chargeSavedCard refuses a stale operation without calling Stripe', result.kind === 'invalid' && w.stripe.calls.length === 0);
    eq('... and gives the lease back, keeping the operation open', (await payRows(id)).map((p: any) => [p.status, p.claim_id]), [['pending', null]]);
  }

  // @@MORE@@

  await pg.exec(`DELETE FROM public.payments WHERE order_id::text LIKE 'eeeeeeee-0000-4000-8000-${TAG}%'; DELETE FROM public.invoice_links WHERE order_id::text LIKE 'eeeeeeee-0000-4000-8000-${TAG}%'; DELETE FROM public.order_changelog WHERE order_id::text LIKE 'eeeeeeee-0000-4000-8000-${TAG}%'; DELETE FROM public.orders WHERE id::text LIKE 'eeeeeeee-0000-4000-8000-${TAG}%'; DELETE FROM public.customers WHERE email LIKE 'eeeeeeee-0000-4000-8000-${TAG}%@payment-tests.example';`);
  pg.close();
  finish();
})().catch((e) => {
  console.error(e);
  failed++;
  finish();
});

function finish() {
  console.log(`Payment charging tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    (globalThis as any).process.exit(1);
  }
}
