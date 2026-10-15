// Refund safety (Step 3C-A): the REAL stripe-refund Edge Function source, the REAL refund module and webhook handlers, and the REAL
// refund SQL against a scratch PostgreSQL database, with a fake Stripe that records every call (see paymentHarness.ts).
//
// Every money-movement case checks BOTH sides: what the provider was asked to do (how many refunds were created, with which
// idempotency key) AND what the database now says (refund rows, the order-level total, the ledger rows).
//
//   - one intended refund is one Stripe refund, however many times it is submitted, retried or raced;
//   - concurrent distinct requests cannot refund more than was paid;
//   - a Stripe refund whose result was lost is found again, not repeated;
//   - the webhook records every individual refund exactly once (ours, or one made in the Stripe dashboard);
//   - pending and failed refunds are not cash returned, and a failed refund releases its reservation;
//   - historical refund rows are preserved and never speculatively rewritten;
//   - cancelling an order cancels only payment attempts that never reached the provider.
//
// The database privileges (who may write payments / order_refunds) are proved for the real roles in coreDatabaseAccess.test.ts.
// With no reachable scratch database the file is SKIPPED (ROLE_DB_REQUIRE=1 makes that a failure).
// Run: node node_modules/jiti/bin/jiti.js src/lib/refundSafety.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const process: { env: Record<string, string | undefined>; pid: number };
declare const require: (id: string) => any;

import * as authHelpers from '../../../../supabase/functions/_shared/auth';
import * as refundOps from '../../../../supabase/functions/_shared/payments/refund-operations';
import { PgPool, ensurePayDatabase, psqlArgs, makeWorld, makeClient, loadHandler, loadModule, callHandler, SERVICE_KEY, type World } from '../support/paymentHarness';
import { classifyRefundResponse, refundAttemptFor } from '../../payments/refundOperationKey';
import { RefundController, type RefundApi } from '../../payments/refundController';

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

const TAG = String((Date.now() % 1e6) * 1000 + (process.pid % 1000)).padStart(9, '0');
let counter = 0;
const nextId = () => `ffffffff-0000-4000-8000-${TAG}${String(++counter).padStart(3, '0')}`;
const ADMIN = `aaaaaaaa-0000-4000-8000-${TAG}a11`;
const MASTER = `aaaaaaaa-0000-4000-8000-${TAG}a12`;
const CREW = `aaaaaaaa-0000-4000-8000-${TAG}a13`;
const CUST = `aaaaaaaa-0000-4000-8000-${TAG}a14`;
let keyCounter = 0;
const newKey = (label = 'op') => `${label}-${TAG}-${String(++keyCounter).padStart(3, '0')}`;

(async () => {
  const db = ensurePayDatabase();
  if (!db) {
    if (process.env.ROLE_DB_REQUIRE) ok('executed: the scratch database is available (ROLE_DB_REQUIRE is set)', false);
    else console.log('Refund safety tests SKIPPED: the scratch database was not reachable.');
    finish();
    return;
  }
  const pg = new PgPool(db.psql, db.db, 8);
  const createdOrders: string[] = [];

  for (const [id, k] of [[ADMIN, 'a11'], [MASTER, 'a12'], [CREW, 'a13'], [CUST, 'a14']] as const) {
    await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${id}', 'refund-${TAG}-${k}@example.test') ON CONFLICT DO NOTHING;`);
  }

  const shared = { ...authHelpers, ...refundOps };

  interface Case { w: World; orderId: string; pis: string[]; payIds: string[] }
  // An order with card payments of the given amounts (the first is the oldest). Each payment is a real PaymentIntent at the fake
  // Stripe and a succeeded row in the ledger (no components: the refund rules do not depend on them).
  async function newCase(amounts: number[], opts: { status?: string; offline?: number } = {}): Promise<Case> {
    const w = makeWorld(pg);
    w.users = { 'jwt-admin': ADMIN, 'jwt-master': MASTER, 'jwt-crew': CREW, 'jwt-cust': CUST };
    w.tables.user_roles = [{ user_id: MASTER, role: 'master' }, { user_id: ADMIN, role: 'admin' }, { user_id: CREW, role: 'crew' }, { user_id: CUST, role: 'customer' }];
    const orderId = nextId();
    createdOrders.push(orderId);
    await pg.exec(`INSERT INTO public.orders (id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents)
      VALUES ('${orderId}', '${opts.status ?? 'confirmed'}', 'residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 'next_day', 20000, 5000, 15000);`);
    const pis: string[] = [];
    const payIds: string[] = [];
    for (let i = 0; i < amounts.length; i++) {
      const pi = w.stripe.addSucceededPaymentIntent(amounts[i]);
      const payId = nextId();
      pis.push(pi.id);
      payIds.push(payId);
      await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, stripe_payment_intent_id, paid_at, created_at, payment_method, payment_brand)
        VALUES ('${payId}', '${orderId}', '${i === 0 ? 'deposit' : 'balance'}', ${amounts[i]}, 'succeeded', '${pi.id}', now(), now() - interval '${amounts.length - i} minutes', 'card', 'visa');`);
    }
    if (opts.offline) {
      await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, payment_method, paid_at) VALUES ('${nextId()}', '${orderId}', 'balance', ${opts.offline}, 'succeeded', 'cash', now());`);
    }
    return { w, orderId, pis, payIds };
  }

  const refundCall = (c: Case, body: Record<string, unknown>, bearer: string | null = 'jwt-admin') => callHandler(loadHandler('stripe-refund', c.w, shared), { orderId: c.orderId, reason: 'cancellation', ...body }, bearer);
  const refundRows = async (orderId: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.order_refunds t WHERE order_id = '${orderId}' ORDER BY operation_index NULLS LAST, created_at, id`)).map((r: any) => r.j);
  const negativePayments = async (orderId: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.payments t WHERE order_id = '${orderId}' AND amount_cents < 0 ORDER BY created_at, ledger_sequence`)).map((r: any) => r.j);
  const orderRow = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.orders t WHERE id = '${id}'`))[0].j;
  const changelog = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.order_changelog t WHERE order_id = '${id}' ORDER BY created_at`)).map((r: any) => r.j);
  const creates = (c: Case) => c.w.stripe.calls.filter((x) => x.api === 'refunds.create');
  const allCreateAttempts = (c: Case) => c.w.stripe.calls.filter((x) => x.api.startsWith('refunds.create'));
  const totalRefunded = async (id: string) => (await orderRow(id)).total_refunded_cents;
  const handlers = (c: Case) => loadModule('supabase/functions/stripe-webhook/handlers.ts', c.w, { ...shared, sendCheckoutBalanceReceiptEmail: async () => {}, sendDepositReceiptEmail: async () => {} });
  const wh = (c: Case) => ({ h: handlers(c), client: makeClient(c.w) });
  const refundEvent = (c: Case, id: string) => ({ ...c.w.stripe.refunds_[id] });
  const retryError = { message: 'database unavailable', code: '08006' };

  // =================================================================================================================
  // 1. One normal successful refund
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    const key = newKey();
    const r = await refundCall(c, { amountCents: 3000, operationKey: key });
    eq('normal refund: succeeds', [r.status, r.json?.success, r.json?.status, r.json?.succeededCents], [200, true, 'succeeded', 3000]);
    eq('normal refund: exactly one Stripe refund, for that amount, on that PaymentIntent', creates(c).map((x) => [x.params.amount, x.params.payment_intent]), [[3000, c.pis[0]]]);
    ok('normal refund: the Stripe request carries a stable idempotency key built from the operation key', creates(c)[0].key === `refund:${key}:0`);
    const rows = await refundRows(c.orderId);
    eq('normal refund: one refund row, linked to the original payment, succeeded, provider id recorded', rows.map((x: any) => [x.amount_cents, x.status, x.payment_id, x.stripe_payment_intent_id, x.ledger_version, x.source, x.operation_key]), [[3000, 'succeeded', c.payIds[0], c.pis[0], 2, 'admin', key]]);
    ok('normal refund: the row carries the Stripe refund id', rows[0].stripe_refund_id === Object.keys(c.w.stripe.refunds_)[0]);
    ok('normal refund: the Stripe refund names its row in its metadata (so a lost result can be found again)', creates(c)[0].params.metadata.bpc_refund_id === rows[0].id);
    eq('normal refund: the order-level total was incremented once', await totalRefunded(c.orderId), 3000);
    const neg = await negativePayments(c.orderId);
    eq('normal refund: one negative ledger row, linked to the original payment and to the Stripe refund', neg.map((x: any) => [x.amount_cents, x.refunded_payment_id, x.stripe_refund_id, x.status]), [[-3000, c.payIds[0], rows[0].stripe_refund_id, 'succeeded']]);
    ok('normal refund: the refund is in the change log', (await changelog(c.orderId)).some((x: any) => x.change_type === 'refund'));

    // access
    eq('roles: Master can refund too', (await refundCall(c, { amountCents: 100, operationKey: newKey() }, 'jwt-master')).status, 200);
    eq('roles: Crew is refused', (await refundCall(c, { amountCents: 100, operationKey: newKey() }, 'jwt-crew')).status, 403);
    eq('roles: a customer is refused', (await refundCall(c, { amountCents: 100, operationKey: newKey() }, 'jwt-cust')).status, 403);
    eq('roles: an anonymous caller is refused', (await refundCall(c, { amountCents: 100, operationKey: newKey() }, null)).status, 401);
    eq('roles: refused callers created no Stripe refund (only the normal one and the Master one exist)', creates(c).length, 2);
  }

  // =================================================================================================================
  // 2. Request validation
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    for (const [label, body, code] of [
      ['no operation key', { amountCents: 100 }, 'OPERATION_KEY_REQUIRED'],
      ['a too-short operation key', { amountCents: 100, operationKey: 'short' }, 'OPERATION_KEY_REQUIRED'],
      ['an operation key with illegal characters', { amountCents: 100, operationKey: 'bad key with spaces!!' }, 'OPERATION_KEY_REQUIRED'],
      ['a zero amount', { amountCents: 0, operationKey: newKey() }, 'INVALID_REQUEST'],
      ['a negative amount', { amountCents: -5, operationKey: newKey() }, 'INVALID_REQUEST'],
      ['a fractional amount', { amountCents: 10.5, operationKey: newKey() }, 'INVALID_REQUEST'],
      ['a string amount', { amountCents: '100', operationKey: newKey() }, 'INVALID_REQUEST'],
    ] as Array<[string, Record<string, unknown>, string]>) {
      const r = await refundCall(c, body);
      ok(`validation: ${label} is refused (400 ${code}) and nothing is reserved`, r.status === 400 && r.json?.code === code);
    }
    const noOrder = await callHandler(loadHandler('stripe-refund', c.w, shared), { orderId: nextId(), amountCents: 100, operationKey: newKey(), reason: 'x' }, 'jwt-admin');
    eq('validation: an unknown order is 404', noOrder.status, 404);
    const badOrder = await callHandler(loadHandler('stripe-refund', c.w, shared), { orderId: 'not-a-uuid', amountCents: 100, operationKey: newKey() }, 'jwt-admin');
    eq('validation: a malformed order id is 400', badOrder.status, 400);
    eq('validation: none of those created a refund row or a Stripe refund', [(await refundRows(c.orderId)).length, c.w.stripe.refundCreatedCount], [0, 0]);
    const over = await refundCall(c, { amountCents: 10001, operationKey: newKey() });
    ok('validation: more than was paid is 400 EXCEEDS_REFUNDABLE with the maximum', over.status === 400 && over.json?.code === 'EXCEEDS_REFUNDABLE' && over.json?.maxRefundableCents === 10000);
    const cash = await newCase([], { offline: 5000 });
    const none = await refundCall(cash, { amountCents: 100, operationKey: newKey() });
    ok('validation: an order that only has cash is not refundable through Stripe (404 NO_REFUNDABLE_PAYMENT)', none.status === 404 && none.json?.code === 'NO_REFUNDABLE_PAYMENT');
    const invalidResponse = await refundCall(c, { amountCents: 100, operationKey: newKey() });
    ok('validation: a valid request still works afterwards', invalidResponse.status === 200);
  }

  // =================================================================================================================
  // 3. Duplicate submission with the same operation identity
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    const key = newKey();
    const first = await refundCall(c, { amountCents: 4000, operationKey: key });
    const second = await refundCall(c, { amountCents: 4000, operationKey: key });
    const third = await refundCall(c, { amountCents: 4000, operationKey: key });
    eq('duplicate: every submission answers success', [first.status, second.status, third.status], [200, 200, 200]);
    ok('duplicate: the repeats are recognised as the same operation', second.json?.existing === true && third.json?.existing === true);
    eq('duplicate: ONE Stripe refund was created', c.w.stripe.refundCreatedCount, 1);
    eq('duplicate: no second create call was even made (not even an idempotent replay)', allCreateAttempts(c).length, 1);
    eq('duplicate: one refund row and one ledger row', [(await refundRows(c.orderId)).length, (await negativePayments(c.orderId)).length], [1, 1]);
    eq('duplicate: the order total counted it once', await totalRefunded(c.orderId), 4000);
    const reused = await refundCall(c, { amountCents: 3999, operationKey: key });
    ok('duplicate: the same key for a different amount is refused (409) and changes nothing', reused.status === 409 && reused.json?.code === 'OPERATION_KEY_REUSED' && c.w.stripe.refundCreatedCount === 1);
    const other = await newCase([10000]);
    const otherKeyUse = await refundCall(other, { amountCents: 4000, operationKey: key });
    ok('duplicate: the key is global: it cannot be reused on another order', otherKeyUse.status === 409 && otherKeyUse.json?.code === 'OPERATION_KEY_REUSED' && other.w.stripe.refundCreatedCount === 0);
  }

  // =================================================================================================================
  // 4. Two simultaneous identical requests; concurrent distinct requests
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    const key = newKey();
    const [a, b] = await Promise.all([refundCall(c, { amountCents: 5000, operationKey: key }), refundCall(c, { amountCents: 5000, operationKey: key })]);
    // Whichever request reserves second may find the first still talking to Stripe: it then answers "not final" (202, success true, retry
    // the same key) instead of 200. Both orders are correct, so the interleaving must not decide the verdict; what must hold is below.
    ok('simultaneous identical: both answer success (200, or 202 not final when the other was still in flight)', [a, b].every((r) => (r.status === 200 && r.json?.success === true) || (r.status === 202 && r.json?.success === true && r.json?.final === false)));
    const settledRetry = await refundCall(c, { amountCents: 5000, operationKey: key });
    eq('simultaneous identical: a retry of the same key settles to success without a second request', [settledRetry.status, settledRetry.json?.status], [200, 'succeeded']);
    eq('simultaneous identical: ONE Stripe refund exists (the fake enforces Stripe\'s idempotency rule)', c.w.stripe.refundCreatedCount, 1);
    ok('simultaneous identical: whatever the interleaving, no second refund with a different key was created', new Set(allCreateAttempts(c).map((x) => x.key)).size === 1);
    eq('simultaneous identical: one row; total counted once', [(await refundRows(c.orderId)).length, await totalRefunded(c.orderId)], [1, 5000]);
  }
  {
    const c = await newCase([10000]);
    const results = await Promise.all([refundCall(c, { amountCents: 6000, operationKey: newKey() }), refundCall(c, { amountCents: 6000, operationKey: newKey() })]);
    const okCount = results.filter((r) => r.status === 200).length;
    // The second request either finds the first still unsettled (blocked, naming it) or finds the money already reserved (exceeds).
    eq('concurrent distinct (6000 + 6000 of 10000): exactly one succeeds, the other is refused', [okCount, results.filter((r) => r.json?.code === 'EXCEEDS_REFUNDABLE' || r.json?.code === 'UNSETTLED_REFUND_EXISTS').length], [1, 1]);
    eq('concurrent distinct: Stripe was asked for 6000 once, never more than was paid', [c.w.stripe.refundCreatedCount, c.w.stripe.refundedTotal], [1, 6000]);
    eq('concurrent distinct: the order total is 6000', await totalRefunded(c.orderId), 6000);
  }
  {
    const c = await newCase([10000]);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => refundCall(c, { amountCents: 4000, operationKey: newKey() })));
    ok('concurrent distinct (5 x 4000 of 10000): at most two succeed', results.filter((r) => r.status === 200).length >= 1 && results.filter((r) => r.status === 200).length <= 2);
    ok('concurrent distinct: the others were refused (exceeding what is refundable, or blocked by the unsettled request)', results.filter((r) => r.status !== 200).every((r) => r.json?.code === 'EXCEEDS_REFUNDABLE' || r.json?.code === 'UNSETTLED_REFUND_EXISTS'));
    ok('concurrent distinct: Stripe never refunded more than was paid', c.w.stripe.refundedTotal <= 10000 && c.w.stripe.refundedTotal % 4000 === 0);
    ok('concurrent distinct: reservations never exceed the payments', (await refundRows(c.orderId)).reduce((a: number, x: any) => a + x.amount_cents, 0) <= 10000);
  }

  // =================================================================================================================
  // 5. Retry after provider success but before local finalization / unknown provider result
  // =================================================================================================================
  {
    // Stripe created the refund, then the database write that records it fails.
    const c = await newCase([10000]);
    const key = newKey();
    c.w.failRpc['record_refund_provider_result'] = { error: retryError, times: 1 };
    const first = await refundCall(c, { amountCents: 2500, operationKey: key });
    eq('lost local write: the answer says the result is not final (202, success true, retry the same key)', [first.status, first.json?.status, first.json?.success], [202, 'unresolved', true]);
    eq('lost local write: Stripe has exactly one refund', c.w.stripe.refundCreatedCount, 1);
    let rows = await refundRows(c.orderId);
    eq('lost local write: the reservation is still held (pending) with a durable record that a request was started', [rows.length, rows[0].status, rows[0].stripe_refund_id, rows[0].provider_attempted_at !== null], [1, 'pending', null, true]);
    eq('lost local write: nothing was counted as returned yet', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], [0, 0]);
    const reservedDuring = await refundCall(c, { amountCents: 9000, operationKey: newKey() });
    ok('lost local write: another request is blocked while this one is unsettled, and the answer names it', reservedDuring.status === 409 && reservedDuring.json?.code === 'UNSETTLED_REFUND_EXISTS' && reservedDuring.json?.resumeOperationKey === key && reservedDuring.json?.resumeAmountCents === 2500);
    const retry = await refundCall(c, { amountCents: 2500, operationKey: key });
    eq('lost local write: the retry settles the SAME refund', [retry.status, retry.json?.status, retry.json?.existing], [200, 'succeeded', true]);
    eq('lost local write: Stripe was NOT asked a second time (still one create call, one refund)', [creates(c).length, c.w.stripe.refundCreatedCount], [1, 1]);
    rows = await refundRows(c.orderId);
    eq('lost local write: now succeeded with the provider id; counted once', [rows[0].status, rows[0].stripe_refund_id === Object.keys(c.w.stripe.refunds_)[0], await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], ['succeeded', true, 2500, 1]);
  }
  {
    // The response never reaches us (timeout). Stripe did create the refund.
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
    const first = await refundCall(c, { amountCents: 2500, operationKey: key });
    eq('timeout after success: unresolved, not an error, not a second attempt', [first.status, first.json?.status], [202, 'unresolved']);
    eq('timeout after success: Stripe has the refund', c.w.stripe.refundCreatedCount, 1);
    const retry = await refundCall(c, { amountCents: 2500, operationKey: key });
    eq('timeout after success: the retry finds that refund again and records it', [retry.status, retry.json?.status], [200, 'succeeded']);
    eq('timeout after success: still one refund at Stripe and one create call', [c.w.stripe.refundCreatedCount, creates(c).length], [1, 1]);
    eq('timeout after success: counted once', await totalRefunded(c.orderId), 2500);
  }
  {
    // Same, but Stripe cannot be listed during the retry: the stable idempotency key makes re-sending safe.
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
    await refundCall(c, { amountCents: 2500, operationKey: key });
    c.w.stripe.refundListMode = 'throw';
    const retry = await refundCall(c, { amountCents: 2500, operationKey: key });
    eq('timeout, lookup down: the retry is re-sent with the SAME idempotency key and Stripe replays the original', [retry.status, retry.json?.status], [200, 'succeeded']);
    eq('timeout, lookup down: still one Stripe refund', c.w.stripe.refundCreatedCount, 1);
    ok('timeout, lookup down: the second request was a replay of the first key', c.w.stripe.calls.filter((x) => x.api === 'refunds.create(replay)').length === 1);
  }
  {
    // The request never reached Stripe.
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['connection_error_before'];
    const first = await refundCall(c, { amountCents: 2500, operationKey: key });
    eq('connection failure: unresolved and nothing refunded', [first.status, first.json?.status, c.w.stripe.refundCreatedCount], [202, 'unresolved', 0]);
    const retry = await refundCall(c, { amountCents: 2500, operationKey: key });
    eq('connection failure: the retry creates the refund once', [retry.status, retry.json?.status, c.w.stripe.refundCreatedCount], [200, 'succeeded', 1]);
    eq('connection failure: counted once', await totalRefunded(c.orderId), 2500);
  }
  {
    // Stripe 5xx: the outcome is unknown, so the reservation stays; a later success is not repeated.
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['api_error_500'];
    const first = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('Stripe 5xx: unresolved, reservation kept', [first.status, first.json?.status, (await refundRows(c.orderId))[0].status], [202, 'unresolved', 'pending']);
  }
  {
    // A request older than Stripe's idempotency window is never re-sent blind.
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['connection_error_before'];
    await refundCall(c, { amountCents: 1000, operationKey: key });
    await pg.exec(`UPDATE public.order_refunds SET created_at = now() - interval '30 hours' WHERE operation_key = '${key}';`);
    c.w.stripe.refundListMode = 'throw';
    const retry = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('old pending, lookup down: not re-sent blind (could duplicate a refund older than the idempotency window)', [retry.status, retry.json?.status, c.w.stripe.refundCreatedCount], [202, 'unresolved', 0]);
    c.w.stripe.refundListMode = 'normal';
    const retry2 = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('old pending, lookup up: Stripe has none, so the refund is created once', [retry2.json?.status, c.w.stripe.refundCreatedCount], ['succeeded', 1]);
  }

  // =================================================================================================================
  // 6. Stripe refund failure releases its reservation
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['invalid_request'];
    const r = await refundCall(c, { amountCents: 6000, operationKey: key });
    eq('Stripe rejects: the answer says failed (422), nothing refunded', [r.status, r.json?.status, r.json?.failedCents, c.w.stripe.refundCreatedCount], [422, 'failed', 6000, 0]);
    const rows = await refundRows(c.orderId);
    ok('Stripe rejects: the row is failed with a reason, and nothing was counted as returned', rows[0].status === 'failed' && !!rows[0].failure_reason && (await totalRefunded(c.orderId)) === 0 && (await negativePayments(c.orderId)).length === 0);
    const again = await refundCall(c, { amountCents: 6000, operationKey: key });
    ok('Stripe rejects: the same key answers the same final failure and does not call Stripe again', again.status === 422 && allCreateAttempts(c).length === 1);
    const fresh = await refundCall(c, { amountCents: 10000, operationKey: newKey() });
    eq('Stripe rejects: the failed reservation was released, so the full amount can be requested again', [fresh.status, fresh.json?.status, await totalRefunded(c.orderId)], [200, 'succeeded', 10000]);
  }

  // =================================================================================================================
  // 7. Pending refund followed by success / failure (webhook)
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['pending'];
    const r = await refundCall(c, { amountCents: 3000, operationKey: key });
    eq('pending: the answer is pending (accepted), not succeeded', [r.status, r.json?.status, r.json?.pendingCents, r.json?.succeededCents], [200, 'pending', 3000, 0]);
    const rows = await refundRows(c.orderId);
    eq('pending: the row is pending with the provider id', [rows[0].status, !!rows[0].stripe_refund_id], ['pending', true]);
    eq('pending: it is NOT cash returned: no order total, no ledger row', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], [0, 0]);
    const during = await refundCall(c, { amountCents: 8000, operationKey: newKey() });
    ok('pending: it still reserves its amount (8000 > 7000 refused)', during.status === 400 && during.json?.maxRefundableCents === 7000);

    const w = wh(c);
    const refundId = rows[0].stripe_refund_id;
    c.w.stripe.setRefundStatus(refundId, 'succeeded');
    await w.h.handleRefundEvent(refundEvent(c, refundId), w.client);
    const after = await refundRows(c.orderId);
    eq('pending then succeeded: the row is succeeded', after[0].status, 'succeeded');
    eq('pending then succeeded: counted once in the total and once in the ledger', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], [3000, 1]);
    await w.h.handleRefundEvent(refundEvent(c, refundId), w.client);
    await w.h.handleChargeRefunded({ id: c.w.stripe.paymentIntents_[c.pis[0]].latest_charge }, w.client, c.w.stripe);
    eq('pending then succeeded: replays (refund event, charge.refunded) change nothing', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length, (await refundRows(c.orderId)).length], [3000, 1, 1]);
  }
  {
    const c = await newCase([10000]);
    c.w.stripe.refundBehaviors = ['pending'];
    await refundCall(c, { amountCents: 3000, operationKey: newKey() });
    const rows = await refundRows(c.orderId);
    const refundId = rows[0].stripe_refund_id;
    const w = wh(c);
    c.w.stripe.setRefundStatus(refundId, 'failed', 'declined');
    await w.h.handleRefundEvent(refundEvent(c, refundId), w.client);
    const after = await refundRows(c.orderId);
    ok('pending then failed: the row is failed, with the provider\'s reason', after[0].status === 'failed' && after[0].failure_reason === 'declined');
    eq('pending then failed: nothing was ever counted as returned', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], [0, 0]);
    const free = await refundCall(c, { amountCents: 10000, operationKey: newKey() });
    eq('pending then failed: the reservation is released (the full amount can be refunded again)', [free.status, free.json?.status], [200, 'succeeded']);
    // a late "succeeded" cannot resurrect the failed row
    c.w.stripe.setRefundStatus(refundId, 'succeeded');
    await w.h.handleRefundEvent(refundEvent(c, refundId), w.client);
    eq('failed is final: a later succeeded event does not change the row or the totals', [(await refundRows(c.orderId))[0].status, await totalRefunded(c.orderId)], ['failed', 10000]);
    ok('failed is final: the contradiction is left for a person in the change log', (await changelog(c.orderId)).some((x: any) => /REFUND_EVENT_AFTER_FAILURE/.test(x.notes ?? '')));
  }
  {
    // A refund that succeeded and is later reported failed (funds returned to Stripe) reverses.
    const c = await newCase([10000]);
    await refundCall(c, { amountCents: 3000, operationKey: newKey() });
    const refundId = (await refundRows(c.orderId))[0].stripe_refund_id;
    const w = wh(c);
    c.w.stripe.setRefundStatus(refundId, 'failed', 'expired_or_canceled_card');
    await w.h.handleRefundEvent(refundEvent(c, refundId), w.client);
    eq('succeeded then failed: the row is failed, the total is reversed, the ledger row no longer counts', [(await refundRows(c.orderId))[0].status, await totalRefunded(c.orderId), (await negativePayments(c.orderId))[0].status], ['failed', 0, 'failed']);
    await w.h.handleRefundEvent(refundEvent(c, refundId), w.client);
    eq('succeeded then failed: the replay reverses nothing twice', await totalRefunded(c.orderId), 0);
  }

  // =================================================================================================================
  // 8. Multiple distinct partial refunds; refunds spanning payments; failure after the first of several
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    const r1 = await refundCall(c, { amountCents: 2000, operationKey: newKey() });
    const r2 = await refundCall(c, { amountCents: 3000, operationKey: newKey() });
    eq('partial refunds: both succeed', [r1.status, r2.status], [200, 200]);
    eq('partial refunds: two Stripe refunds, two rows, two ledger rows', [c.w.stripe.refundCreatedCount, (await refundRows(c.orderId)).length, (await negativePayments(c.orderId)).length], [2, 2, 2]);
    eq('partial refunds: recorded individually, with their own amounts', (await refundRows(c.orderId)).map((x: any) => x.amount_cents), [2000, 3000]);
    eq('partial refunds: the total is the sum', await totalRefunded(c.orderId), 5000);
    const r3 = await refundCall(c, { amountCents: 5001, operationKey: newKey() });
    ok('partial refunds: what remains is exactly 5000', r3.status === 400 && r3.json?.maxRefundableCents === 5000);
    const r4 = await refundCall(c, { amountCents: 5000, operationKey: newKey() });
    eq('partial refunds: the rest can be refunded, and no more', [r4.status, await totalRefunded(c.orderId), (await refundCall(c, { amountCents: 1, operationKey: newKey() })).json?.code], [200, 10000, 'EXCEEDS_REFUNDABLE']);
  }
  {
    const c = await newCase([4000, 6000]); // the 6000 payment is the newest
    const key = newKey();
    const r = await refundCall(c, { amountCents: 7000, operationKey: key });
    eq('spanning payments: succeeds', [r.status, r.json?.status], [200, 'succeeded']);
    eq('spanning payments: two Stripe refunds, newest payment first, each with its own idempotency key', creates(c).map((x) => [x.params.payment_intent === c.pis[1] ? 'newest' : 'oldest', x.params.amount, x.key]), [['newest', 6000, `refund:${key}:0`], ['oldest', 1000, `refund:${key}:1`]]);
    const rows = await refundRows(c.orderId);
    eq('spanning payments: one row per provider refund, each linked to its payment', rows.map((x: any) => [x.operation_index, x.payment_id === c.payIds[1] ? 'newest' : 'oldest', x.amount_cents, x.status]), [[0, 'newest', 6000, 'succeeded'], [1, 'oldest', 1000, 'succeeded']]);
    eq('spanning payments: the total and the ledger agree', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).map((x: any) => x.amount_cents).sort((a: number, b: number) => a - b)], [7000, [-6000, -1000]]);
    const more = await refundCall(c, { amountCents: 3001, operationKey: newKey() });
    ok('spanning payments: only 3000 remains (the oldest payment has 3000 left)', more.json?.maxRefundableCents === 3000);
    const rest = await refundCall(c, { amountCents: 3000, operationKey: newKey() });
    eq('spanning payments: the remainder goes to the payment that still has it', [rest.status, creates(c)[2].params.payment_intent === c.pis[0], creates(c)[2].params.amount], [200, true, 3000]);
  }
  {
    // Definitive failure on the second of two provider refunds.
    const c = await newCase([4000, 6000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['succeed', 'invalid_request'];
    const r = await refundCall(c, { amountCents: 7000, operationKey: key });
    eq('failure after the first: partial (207), only the first refund counted', [r.status, r.json?.status, r.json?.succeededCents, r.json?.failedCents], [207, 'partial', 6000, 1000]);
    eq('failure after the first: the first refund is recorded and counted; the second is failed and released', [(await refundRows(c.orderId)).map((x: any) => x.status), await totalRefunded(c.orderId)], [['succeeded', 'failed'], 6000]);
    const retry = await refundCall(c, { amountCents: 7000, operationKey: key });
    eq('failure after the first: retrying the same key neither repeats the first refund nor retries the failed one', [retry.status, allCreateAttempts(c).length], [207, 2]);
    const rest = await refundCall(c, { amountCents: 1000, operationKey: newKey() });
    eq('failure after the first: the failed part can be requested again as a new refund', [rest.status, await totalRefunded(c.orderId)], [200, 7000]);
  }
  {
    // Unknown failure on the second of two provider refunds: the first is not lost, the second is settled by the retry.
    const c = await newCase([4000, 6000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['succeed', 'connection_error_before'];
    const r = await refundCall(c, { amountCents: 7000, operationKey: key });
    eq('unknown failure after the first: unresolved; the first refund is already recorded', [r.status, r.json?.status, r.json?.succeededCents, r.json?.unresolvedCents], [202, 'unresolved', 6000, 1000]);
    eq('unknown failure after the first: the first refund is counted', await totalRefunded(c.orderId), 6000);
    const retry = await refundCall(c, { amountCents: 7000, operationKey: key });
    eq('unknown failure after the first: the retry completes ONLY the second refund', [retry.status, retry.json?.status, c.w.stripe.refundCreatedCount, await totalRefunded(c.orderId)], [200, 'succeeded', 2, 7000]);
    eq('unknown failure after the first: the first refund was not created again', creates(c).filter((x) => x.params.amount === 6000).length, 1);
  }

  // =================================================================================================================
  // 9. Webhook ordering and duplicates
  // =================================================================================================================
  {
    // The webhook arrives while the initiating request is still between Stripe and its own write.
    const c = await newCase([10000]);
    const w = wh(c);
    let delivered = false;
    c.w.beforeRpc['record_refund_provider_result'] = async () => {
      if (delivered) return;
      delivered = true;
      const id = Object.keys(c.w.stripe.refunds_)[0];
      await w.h.handleRefundEvent(refundEvent(c, id), w.client);
    };
    const key = newKey();
    const r = await refundCall(c, { amountCents: 2000, operationKey: key });
    eq('webhook first: the request still ends succeeded', [r.status, r.json?.status], [200, 'succeeded']);
    eq('webhook first: one refund row (the webhook found OUR row through the refund metadata, it did not add another)', (await refundRows(c.orderId)).map((x: any) => [x.source, x.operation_key === key, x.status]), [['admin', true, 'succeeded']]);
    eq('webhook first: counted once', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length, c.w.stripe.refundCreatedCount], [2000, 1, 1]);
  }
  {
    // The webhook arrives after the request has finished (the usual case), and is delivered twice.
    const c = await newCase([10000]);
    await refundCall(c, { amountCents: 2000, operationKey: newKey() });
    const w = wh(c);
    const id = Object.keys(c.w.stripe.refunds_)[0];
    await w.h.handleRefundEvent(refundEvent(c, id), w.client);
    await w.h.handleRefundEvent(refundEvent(c, id), w.client);
    await w.h.handleChargeRefunded({ id: c.w.stripe.paymentIntents_[c.pis[0]].latest_charge }, w.client, c.w.stripe);
    await w.h.handleChargeRefunded({ id: c.w.stripe.paymentIntents_[c.pis[0]].latest_charge }, w.client, c.w.stripe);
    eq('webhook after: no duplicate refund row, ledger row or total', [(await refundRows(c.orderId)).length, (await negativePayments(c.orderId)).length, await totalRefunded(c.orderId)], [1, 1, 2000]);
  }
  {
    // Concurrent deliveries of the same event.
    const c = await newCase([10000]);
    c.w.stripe.refundBehaviors = ['pending'];
    await refundCall(c, { amountCents: 2000, operationKey: newKey() });
    const id = Object.keys(c.w.stripe.refunds_)[0];
    c.w.stripe.setRefundStatus(id, 'succeeded');
    const a = wh(c);
    const b = wh(c);
    await Promise.all([a.h.handleRefundEvent(refundEvent(c, id), a.client), b.h.handleRefundEvent(refundEvent(c, id), b.client), a.h.handleRefundEvent(refundEvent(c, id), a.client)]);
    eq('concurrent webhooks: the refund is applied exactly once', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length, (await refundRows(c.orderId))[0].status], [2000, 1, 'succeeded']);
  }

  // =================================================================================================================
  // 10. Refunds made outside the application; the original payment is always the positive one
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    const w = wh(c);
    // charge.amount_refunded is the RUNNING TOTAL of the charge; the handler must never record that as one refund.
    const charge: any = { id: c.w.stripe.paymentIntents_[c.pis[0]].latest_charge, amount_refunded: 2500 };
    const r1 = c.w.stripe.externalRefund(c.pis[0], 2500);
    await w.h.handleChargeRefunded(charge, w.client, c.w.stripe);
    let rows = await refundRows(c.orderId);
    eq('outside refund: recorded once, as an external refund of its own amount, linked to the original payment', rows.map((x: any) => [x.source, x.operation_key, x.amount_cents, x.status, x.payment_id, x.stripe_refund_id === r1.id, x.refunded_by]), [['external', null, 2500, 'succeeded', c.payIds[0], true, null]]);
    eq('outside refund: counted in the total and the ledger', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], [2500, 1]);

    // A second, distinct outside refund: the lookup of the original payment must not trip over the negative row of the first.
    const r2 = c.w.stripe.externalRefund(c.pis[0], 1000);
    charge.amount_refunded = 3500;
    await w.h.handleChargeRefunded(charge, w.client, c.w.stripe);
    rows = await refundRows(c.orderId);
    eq('outside refunds: the second is recorded individually (not the cumulative 3500, not skipped)', rows.map((x: any) => [x.amount_cents, x.stripe_refund_id === r1.id || x.stripe_refund_id === r2.id]), [[2500, true], [1000, true]]);
    ok('outside refunds: both rows point at the POSITIVE original payment, never at a refund row', rows.every((x: any) => x.payment_id === c.payIds[0]));
    eq('outside refunds: total 3500 and two ledger rows', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], [3500, 2]);
    await w.h.handleChargeRefunded(charge, w.client, c.w.stripe);
    await w.h.handleRefundEvent(refundEvent(c, r2.id), w.client);
    eq('outside refunds: replays change nothing', [await totalRefunded(c.orderId), (await refundRows(c.orderId)).length, (await negativePayments(c.orderId)).length], [3500, 2, 2]);

    // Our reservation sees outside refunds: only 6500 of the 10000 is left.
    const over = await refundCall(c, { amountCents: 6501, operationKey: newKey() });
    ok('outside refunds: the application knows about them (6500 left)', over.json?.maxRefundableCents === 6500);
  }
  {
    // A dashboard refund that is still pending, then succeeds.
    const c = await newCase([10000]);
    const w = wh(c);
    const r = c.w.stripe.externalRefund(c.pis[0], 1500, 'pending');
    await w.h.handleRefundEvent(refundEvent(c, r.id), w.client);
    eq('outside pending refund: recorded as pending, not returned', [(await refundRows(c.orderId))[0].status, await totalRefunded(c.orderId)], ['pending', 0]);
    c.w.stripe.setRefundStatus(r.id, 'succeeded');
    await w.h.handleRefundEvent(refundEvent(c, r.id), w.client);
    eq('outside pending refund: then succeeded and counted once', [(await refundRows(c.orderId))[0].status, await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], ['succeeded', 1500, 1]);
  }
  {
    // A refund for a PaymentIntent the application has no payment for is not invented.
    const c = await newCase([10000]);
    const stray = c.w.stripe.addSucceededPaymentIntent(5000);
    const w = wh(c);
    const rf = c.w.stripe.externalRefund(stray.id, 100);
    await w.h.handleRefundEvent(refundEvent(c, rf.id), w.client);
    eq('unknown payment: nothing is recorded for a refund of a payment this order does not have', [(await refundRows(c.orderId)).length, await totalRefunded(c.orderId)], [0, 0]);
  }

  {
    // The very first delivery of an outside refund arrives twice at the same moment: one row, and both answers are truthful.
    const c = await newCase([10000]);
    const rf = c.w.stripe.externalRefund(c.pis[0], 1200);
    const a = makeClient(c.w);
    const b = makeClient(c.w);
    const args = { p_stripe_refund_id: rf.id, p_payment_intent_id: c.pis[0], p_amount_cents: 1200, p_stripe_status: 'succeeded' };
    const [ra, rb] = await Promise.all([a.rpc('apply_provider_refund_event', args), b.rpc('apply_provider_refund_event', args)]) as any[];
    const outcomes = [ra.data?.outcome, rb.data?.outcome].sort();
    eq('simultaneous first deliveries of an outside refund: one applies it, the other recognises it', outcomes, ['succeeded', 'unchanged']);
    eq('simultaneous first deliveries of an outside refund: one row, counted once', [(await refundRows(c.orderId)).length, await totalRefunded(c.orderId), (await negativePayments(c.orderId)).length], [1, 1200, 1]);
  }
  {
    // Two refunds exist when ONE charge.refunded event is finally handled: both are recorded, individually.
    const c = await newCase([10000]);
    const r1 = c.w.stripe.externalRefund(c.pis[0], 1100);
    const r2 = c.w.stripe.externalRefund(c.pis[0], 2200);
    const w = wh(c);
    await w.h.handleChargeRefunded({ id: c.w.stripe.paymentIntents_[c.pis[0]].latest_charge, amount_refunded: 3300 }, w.client, c.w.stripe);
    eq('one charge.refunded for two refunds: both are recorded with their own amounts', (await refundRows(c.orderId)).map((x: any) => x.amount_cents).sort((x: number, y: number) => x - y), [1100, 2200]);
    ok('one charge.refunded for two refunds: each under its own Stripe refund id', new Set((await refundRows(c.orderId)).map((x: any) => x.stripe_refund_id)).size === 2 && (await refundRows(c.orderId)).every((x: any) => [r1.id, r2.id].includes(x.stripe_refund_id)));
    eq('one charge.refunded for two refunds: total 3300', await totalRefunded(c.orderId), 3300);
  }

  // =================================================================================================================
  // 11. Historical refund rows
  // =================================================================================================================
  {
    const c = await newCase([10000]);
    // A refund recorded by the OLD local flow (the amount of one refund) and two rows recorded by the OLD webhook (cumulative amount, same refund id twice).
    await pg.exec(`INSERT INTO public.order_refunds (order_id, amount_cents, reason, status, stripe_refund_id, refunded_by, ledger_version)
      VALUES ('${c.orderId}', 2000, 'old local refund', 'succeeded', 're_legacy_local_${TAG}', NULL, NULL),
             ('${c.orderId}', 3000, 'old webhook', 'pending', 're_legacy_dup_${TAG}', NULL, NULL),
             ('${c.orderId}', 3000, 'old webhook again', 'pending', 're_legacy_dup_${TAG}', NULL, NULL);`);
    await pg.exec(`UPDATE public.orders SET total_refunded_cents = 2000 WHERE id = '${c.orderId}';`);
    const before = await refundRows(c.orderId);
    ok('historical rows: legacy rows have no ledger version, no allocation and may even repeat a provider id', before.every((x: any) => x.ledger_version === null && x.payment_id === null) && before.filter((x: any) => x.stripe_refund_id === `re_legacy_dup_${TAG}`).length === 2);
    const over = await refundCall(c, { amountCents: 5001, operationKey: newKey() });
    ok('historical rows: they still reserve their amounts (10000 - 2000 - 3000 - 3000 = 2000), so refundable can only be understated', over.status === 400 && over.json?.maxRefundableCents === 2000);
    const fine = await refundCall(c, { amountCents: 2000, operationKey: newKey() });
    eq('historical rows: the remainder can still be refunded', [fine.status, c.w.stripe.refundCreatedCount], [200, 1]);

    // Provider events for a legacy row: status only, never the totals or the ledger; a different amount is not forced.
    const w = wh(c);
    const legacyTotalBefore = await totalRefunded(c.orderId);
    await w.client.rpc('apply_provider_refund_event', { p_stripe_refund_id: `re_legacy_local_${TAG}`, p_payment_intent_id: c.pis[0], p_amount_cents: 2000, p_stripe_status: 'succeeded' });
    await w.client.rpc('apply_provider_refund_event', { p_stripe_refund_id: `re_legacy_dup_${TAG}`, p_payment_intent_id: c.pis[0], p_amount_cents: 1000, p_stripe_status: 'succeeded' });
    const after = await refundRows(c.orderId);
    const legacyDup = after.filter((x: any) => x.stripe_refund_id === `re_legacy_dup_${TAG}`);
    ok('historical rows: an event that disagrees with a legacy row\'s amount changes nothing', legacyDup.every((x: any) => x.status === 'pending' && x.amount_cents === 3000));
    ok('historical rows: nothing was rewritten or deleted', after.filter((x: any) => x.ledger_version === null).length === 3 && after.find((x: any) => x.stripe_refund_id === `re_legacy_local_${TAG}`).amount_cents === 2000);
    eq('historical rows: a legacy status event did not touch the order total or the ledger', [await totalRefunded(c.orderId), (await negativePayments(c.orderId)).filter((x: any) => x.stripe_refund_id === `re_legacy_local_${TAG}`).length], [legacyTotalBefore, 0]);
    ok('historical rows: the disagreement is left for a person in the change log', (await changelog(c.orderId)).some((x: any) => /REFUND_AMOUNT_MISMATCH/.test(x.notes ?? '')));
    // a legacy pending row whose individual amount DOES match is allowed to settle its status only
    await pg.exec(`INSERT INTO public.order_refunds (order_id, amount_cents, reason, status, stripe_refund_id, ledger_version) VALUES ('${c.orderId}', 500, 'old pending', 'pending', 're_legacy_pending_${TAG}', NULL);`);
    const totalNow = await totalRefunded(c.orderId);
    await w.client.rpc('apply_provider_refund_event', { p_stripe_refund_id: `re_legacy_pending_${TAG}`, p_payment_intent_id: c.pis[0], p_amount_cents: 500, p_stripe_status: 'succeeded' });
    const lp = (await refundRows(c.orderId)).find((x: any) => x.stripe_refund_id === `re_legacy_pending_${TAG}`);
    eq('historical rows: a matching event settles a legacy row\'s STATUS only (no total, no ledger row: its history is unknown)', [lp.status, lp.total_applied, await totalRefunded(c.orderId), (await negativePayments(c.orderId)).filter((x: any) => x.stripe_refund_id === `re_legacy_pending_${TAG}`).length], ['succeeded', null, totalNow, 0]);
  }
  {
    // The old negative ledger rows (no refund id) are left alone and do not confuse the lookup of the original payment.
    const c = await newCase([10000]);
    await pg.exec(`INSERT INTO public.payments (order_id, stripe_payment_intent_id, amount_cents, type, status, refunded_payment_id, paid_at) VALUES ('${c.orderId}', '${c.pis[0]}', -1000, 'incidental', 'succeeded', '${c.payIds[0]}', now());`);
    const w = wh(c);
    const rf = c.w.stripe.externalRefund(c.pis[0], 700);
    await w.h.handleRefundEvent(refundEvent(c, rf.id), w.client);
    const rows = await refundRows(c.orderId);
    eq('old negative row: the new refund still resolves to the positive original payment', rows.map((x: any) => [x.payment_id, x.amount_cents]), [[c.payIds[0], 700]]);
    eq('old negative row: the old row is untouched and a new one is added for the new refund', (await negativePayments(c.orderId)).map((x: any) => [x.amount_cents, x.stripe_refund_id === null]), [[-1000, true], [-700, false]]);
  }

  // =================================================================================================================
  // 12. Order cancellation / rejection and a late provider success
  // =================================================================================================================
  {
    const c = await newCase([], { status: 'pending_review' });
    const orderId = c.orderId;
    // (An order can have only one open payment operation, so the never-attempted one is on a second order.)
    const c2 = await newCase([], { status: 'pending_review' });
    const unattempted = nextId(); const attempted = nextId(); const withPi = nextId(); const legacy = nextId();
    await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, operation_key, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, order_financials_applied)
      VALUES ('${unattempted}', '${c2.orderId}', 'deposit', 5000, 'pending', 'op-unattempted-${TAG}', 5000, 0, 5000, 0, false);`);
    await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, operation_key, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, order_financials_applied, provider_attempted_at)
        VALUES ('${attempted}', '${orderId}', 'deposit', 5000, 'pending', 'op-attempted-${TAG}', 5000, 0, 5000, 0, false, now());
      INSERT INTO public.payments (id, order_id, type, amount_cents, status, stripe_payment_intent_id)
        VALUES ('${withPi}', '${orderId}', 'balance', 1000, 'pending', 'pi_pending_${TAG}');
      INSERT INTO public.payments (id, order_id, type, amount_cents, status) VALUES ('${legacy}', '${orderId}', 'balance', 1000, 'pending');`);
    await pg.exec(`UPDATE public.orders SET status = 'cancelled', cancelled_at = now() WHERE id IN ('${orderId}', '${c2.orderId}');`);
    const rows = (await pg.query(`SELECT to_jsonb(t) AS j FROM public.payments t WHERE order_id IN ('${orderId}', '${c2.orderId}')`)).map((r: any) => r.j);
    const st = (id: string) => rows.find((x: any) => x.id === id)?.status;
    eq('rejection: pending payment attempts that never reached the provider are cancelled (operation row, legacy row)', [st(unattempted), st(legacy)], ['cancelled', 'cancelled']);
    eq('rejection: an attempt whose provider request may have started, or that already has a PaymentIntent, is left alone', [st(attempted), st(withPi)], ['pending', 'pending']);
    eq('rejection: the order itself is cancelled', (await orderRow(orderId)).status, 'cancelled');

    // A late provider success: still applied (the money is real), the order stays cancelled, and it says so.
    const fin = await c.w.pg.query(`SELECT public.finalize_payment_operation('${attempted}', NULL, 'op-attempted-${TAG}', 'pi_late_${TAG}', NULL, 5000, 'card', 'visa', '4242', NULL, NULL, NULL, NULL) AS j`, true);
    eq('late success: the payment is applied', fin[0].j.outcome, 'applied');
    const o = await orderRow(orderId);
    eq('late success: the order stays cancelled and records the money that really arrived', [o.status, o.deposit_paid_cents], ['cancelled', 5000]);
    ok('late success: the change log tells a person (the refund decision stays manual)', (await changelog(orderId)).some((x: any) => /PAYMENT_APPLIED_TO_CLOSED_ORDER/.test(x.notes ?? '')));
    eq('late success: no automatic refund was issued', [c.w.stripe.refundCreatedCount, (await refundRows(orderId)).length], [0, 0]);
  }
  {
    // A payment in flight (live lease) blocks the cancellation itself (existing state barrier), so an in-flight attempt is never cancelled underneath a running charge.
    const c = await newCase([], { status: 'pending_review' });
    await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, operation_key, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, order_financials_applied, claim_id, claimed_at)
      VALUES ('${nextId()}', '${c.orderId}', 'deposit', 5000, 'pending', 'op-live-${TAG}', 5000, 0, 5000, 0, false, gen_random_uuid(), now());`);
    const res = await pg.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = '${c.orderId}' RETURNING 1`);
    ok('rejection while a charge is in flight: the state barrier refuses the status change', !!res?.__error && res.__code === '55000');
    eq('rejection while a charge is in flight: the order is unchanged', (await orderRow(c.orderId)).status, 'pending_review');
  }

  // =================================================================================================================
  // 13. Browser helper (stable keys; what an answer means)
  // =================================================================================================================
  {
    const a = refundAttemptFor(null, 'o1', 5000);
    const same = refundAttemptFor(a, 'o1', 5000);
    const otherAmount = refundAttemptFor(a, 'o1', 5001);
    const otherOrder = refundAttemptFor(a, 'o2', 5000);
    ok('browser key: a retry of the same refund keeps its key', same.key === a.key);
    ok('browser key: a different amount or order gets a new key', otherAmount.key !== a.key && otherOrder.key !== a.key);
    ok('browser key: keys are valid for the server', /^[A-Za-z0-9_-]{8,64}$/.test(a.key));
    eq('browser answer: succeeded releases the key', [classifyRefundResponse(200, { success: true, status: 'succeeded', requestedCents: 100 }).kind, classifyRefundResponse(200, { success: true, status: 'succeeded', requestedCents: 100 }).keepKey], ['succeeded', false]);
    eq('browser answer: pending is accepted', classifyRefundResponse(200, { success: true, status: 'pending', requestedCents: 100 }).kind, 'pending');
    eq('browser answer: unresolved (202) keeps the key', [classifyRefundResponse(202, { status: 'unresolved' }).kind, classifyRefundResponse(202, { status: 'unresolved' }).keepKey], ['unresolved', true]);
    eq('browser answer: a server error or a non-JSON answer keeps the key', [classifyRefundResponse(500, null).keepKey, classifyRefundResponse(502, { error: 'x' }).keepKey], [true, true]);
    eq('browser answer: partial / failed / rejected end the attempt as errors', [classifyRefundResponse(207, { status: 'partial', succeededCents: 1, pendingCents: 0, requestedCents: 2 }).tone, classifyRefundResponse(422, { status: 'failed' }).tone, classifyRefundResponse(400, { error: 'no' }).tone], ['error', 'error', 'error']);
  }

  // =================================================================================================================
  // 15. Final recovery corrections: the attempt marker, an exhaustive provider lookup, retry identity, other sessions, history
  // =================================================================================================================
  const ageOperation = (key: string, hours: number) => pg.exec(`UPDATE public.order_refunds SET created_at = now() - interval '${hours} hours' WHERE operation_key = '${key}';`);
  const providerCalls = (c: Case) => allCreateAttempts(c).length;
  {
    // 15a. the durable marker is written before a provider request, or nothing is sent
    const c = await newCase([10000]);
    const key = newKey();
    c.w.failRpc['mark_refund_provider_attempt'] = { error: retryError, times: 1 };
    const first = await refundCall(c, { amountCents: 2000, operationKey: key });
    eq('marker write fails: NO provider request is made', providerCalls(c), 0);
    eq('marker write fails: the answer is unresolved (nothing sent), not a success and not a plain failure', [first.status, first.json?.status, first.json?.success, first.json?.final], [202, 'unresolved', true, false]);
    ok('marker write fails: the answer says the request could not be started safely', /could not be started safely/.test(first.json?.warning ?? ''));
    const rows = await refundRows(c.orderId);
    eq('marker write fails: the reservation is kept, unsent, unmarked', [rows[0].status, rows[0].stripe_refund_id, rows[0].provider_attempted_at], ['pending', null, null]);
    const retry = await refundCall(c, { amountCents: 2000, operationKey: key });
    eq('marker write fails: the retry under the same key sends exactly one refund', [retry.status, retry.json?.status, providerCalls(c), c.w.stripe.refundCreatedCount], [200, 'succeeded', 1, 1]);
  }
  {
    // the marker call THROWS (a dropped database connection)
    const c = await newCase([10000]);
    const key = newKey();
    let thrown = false;
    c.w.beforeRpc['mark_refund_provider_attempt'] = () => { if (!thrown) { thrown = true; throw new Error('connection reset by peer'); } };
    const first = await refundCall(c, { amountCents: 2000, operationKey: key });
    eq('marker call throws: NO provider request is made and the answer is unresolved', [providerCalls(c), first.status, first.json?.status], [0, 202, 'unresolved']);
    const retry = await refundCall(c, { amountCents: 2000, operationKey: key });
    eq('marker call throws: the retry sends exactly one refund', [retry.json?.status, providerCalls(c)], ['succeeded', 1]);
  }
  {
    // the marker comes back FALSE: the row is no longer an unsent, pending one (someone else settled it between the reservation and now)
    const c = await newCase([10000]);
    const key = newKey();
    c.w.beforeRpc['mark_refund_provider_attempt'] = async () => {
      await pg.exec(`UPDATE public.order_refunds SET stripe_refund_id = 're_taken_${TAG}' WHERE operation_key = '${key}';`);
    };
    const first = await refundCall(c, { amountCents: 2000, operationKey: key });
    eq('marker returns false: NO provider request is made', providerCalls(c), 0);
    eq('marker returns false: the answer is unresolved and nothing is claimed', [first.status, first.json?.status], [202, 'unresolved']);
  }
  {
    // the durable marker already exists from an earlier attempt: a failing marker write does not strand the retry (the stable key makes re-sending safe)
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['connection_error_before'];
    await refundCall(c, { amountCents: 2000, operationKey: key });
    eq('marker already on record: the first (unknown) attempt reached no refund', c.w.stripe.refundCreatedCount, 0);
    c.w.failRpc['mark_refund_provider_attempt'] = { error: retryError, times: 1 };
    const retry = await refundCall(c, { amountCents: 2000, operationKey: key });
    eq('marker already on record: the retry proceeds with the same key and creates one refund', [retry.json?.status, c.w.stripe.refundCreatedCount], ['succeeded', 1]);
  }

  {
    // 15b. the provider lookup must be exhaustive before absence is believed
    const bigCase = async () => {
      const c = await newCase([2000000]);
      return c;
    };
    // a refund of ours on the SECOND page (150 later refunds on the same PaymentIntent), outside the replay window
    const c = await bigCase();
    const key = newKey();
    c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
    await refundCall(c, { amountCents: 1000, operationKey: key });
    for (let i = 0; i < 150; i++) c.w.stripe.externalRefund(c.pis[0], 100);
    await ageOperation(key, 30);
    const retry = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('later page: the refund on page two is found and recorded', [retry.status, retry.json?.status, (await refundRows(c.orderId)).find((x: any) => x.operation_key === key)?.status], [200, 'succeeded', 'succeeded']);
    eq('later page: NO second Stripe refund (one create call in total, 151 refunds at Stripe)', [creates(c).length, c.w.stripe.refundCreatedCount], [1, 151]);
    ok('later page: the lookup really paged', c.w.stripe.calls.filter((x) => x.api === 'refunds.list' && x.params?.starting_after).length >= 1);
  }
  {
    // exactly 100 later refunds and NO match: the first page is full, Stripe says there is more or not
    const c = await newCase([2000000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['connection_error_before']; // never reached Stripe
    await refundCall(c, { amountCents: 1000, operationKey: key });
    for (let i = 0; i < 100; i++) c.w.stripe.externalRefund(c.pis[0], 100);
    await ageOperation(key, 30);
    const retry = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('exactly 100, complete listing, no match: absence is authoritative, so the refund is created ONCE', [retry.json?.status, providerCalls(c), c.w.stripe.refundCreatedCount], ['succeeded', 2, 101]);
  }
  {
    // exactly 100 returned but the body never says whether there is more (a truncated answer): absence is NOT established
    const c = await newCase([2000000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['succeed_then_connection_error']; // it DID reach Stripe
    await refundCall(c, { amountCents: 1000, operationKey: key });
    for (let i = 0; i < 100; i++) c.w.stripe.externalRefund(c.pis[0], 100);
    await ageOperation(key, 30);
    c.w.stripe.refundListMode = 'no_has_more';
    const calls0 = providerCalls(c);
    const retry = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('truncated listing (no has_more), aged: fails closed; NO second Stripe refund', [retry.status, retry.json?.status, providerCalls(c) - calls0, c.w.stripe.refundCreatedCount], [202, 'unresolved', 0, 101]);
    eq('truncated listing: the reservation is kept pending', (await refundRows(c.orderId)).find((x: any) => x.operation_key === key)?.status, 'pending');
  }
  {
    // the listing fails on its second page: the refund could be there
    const c = await newCase([2000000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
    await refundCall(c, { amountCents: 1000, operationKey: key });
    for (let i = 0; i < 150; i++) c.w.stripe.externalRefund(c.pis[0], 100);
    await ageOperation(key, 30);
    c.w.stripe.refundListFailFromPage = 1;
    const calls0 = providerCalls(c);
    const retry = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('listing fails on page two, aged: fails closed; NO second Stripe refund', [retry.json?.status, providerCalls(c) - calls0], ['unresolved', 0]);
    // and once the listing works again the refund is found
    c.w.stripe.refundListFailFromPage = null;
    const again = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('listing recovers: the refund is found and recorded without a second one', [again.json?.status, providerCalls(c) - calls0, c.w.stripe.refundCreatedCount], ['succeeded', 0, 151]);
  }
  {
    // inside the replay window an inconclusive lookup is harmless (the stable key replays the original)
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
    await refundCall(c, { amountCents: 1000, operationKey: key });
    c.w.stripe.refundListMode = 'no_has_more';
    const retry = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('inside the replay window, lookup inconclusive: the stable key replays the original (still one refund)', [retry.json?.status, c.w.stripe.refundCreatedCount], ['succeeded', 1]);
  }
  {
    // another operation's refund on the same PaymentIntent is never mistaken for ours
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['connection_error_before'];
    await refundCall(c, { amountCents: 1000, operationKey: key });
    const other = c.w.stripe.externalRefund(c.pis[0], 1000);
    other.metadata = { bpc_refund_id: 'someone-elses-row-id' };
    await ageOperation(key, 30);
    const retry = await refundCall(c, { amountCents: 1000, operationKey: key });
    eq('metadata identity: a refund carrying another row\'s id is not adopted (ours is created)', [retry.json?.status, c.w.stripe.refundCreatedCount, (await refundRows(c.orderId)).find((x: any) => x.operation_key === key)?.stripe_refund_id !== other.id], ['succeeded', 2, true]);
  }
  {
    // the lookup helper itself
    const stripe: any = { refunds: { list: async () => ({ data: [{ id: 're_1', metadata: { bpc_refund_id: 'row-x' } }], has_more: false }) } };
    eq('lookup: found on a single complete page', (await refundOps.lookupRefundByRow(stripe, 'pi_1', 'row-x')).complete, true);
    eq('lookup: no payment intent proves nothing', await refundOps.lookupRefundByRow(stripe, null, 'row-x'), { found: null, complete: false });
    const never: any = { refunds: { list: async (p: any) => ({ data: [{ id: `re_${p.starting_after ?? 0}x` }], has_more: true }) } };
    eq('lookup: more pages than the cap is not complete', (await refundOps.lookupRefundByRow(never, 'pi_1', 'row-x')).complete, false);
    const emptyMore: any = { refunds: { list: async () => ({ data: [], has_more: true }) } };
    eq('lookup: an empty page that claims more is not complete', (await refundOps.lookupRefundByRow(emptyMore, 'pi_1', 'row-x')).complete, false);
  }

  {
    // 15c. a multi-payment operation reports every portion truthfully and keeps its identity while anything is unfinished
    const run = async (behaviors: any[], payments: number[], amount: number) => {
      const c = await newCase(payments);
      c.w.stripe.refundBehaviors = behaviors;
      const key = newKey();
      const r = await refundCall(c, { amountCents: amount, operationKey: key });
      return { c, key, r };
    };
    const shape = (r: any) => [r.status, r.json?.status, r.json?.final, r.json?.success, r.json?.succeededCents, r.json?.pendingCents, r.json?.failedCents, r.json?.unresolvedCents];
    let x = await run(['succeed', 'pending', 'succeed'], [3000, 3000, 3000], 9000);
    eq('succeeded + pending: accepted (200), not final while Stripe is still processing a portion, nothing failed', shape(x.r), [200, 'pending', false, true, 6000, 3000, 0, 0]);
    ok('succeeded + pending: the browser accepts it and does not need the key again', classifyRefundResponse(x.r.status, x.r.json).keepKey === false);
    x = await run(['invalid_request', 'pending'], [3000, 3000], 6000);
    eq('failed + pending: unfinished (202), success false, never reported as succeeded', shape(x.r), [202, 'unresolved', false, false, 0, 3000, 3000, 0]);
    ok('failed + pending: the browser keeps the identity and says part was rejected', classifyRefundResponse(x.r.status, x.r.json).keepKey === true && /rejected/.test(classifyRefundResponse(x.r.status, x.r.json).message));
    x = await run(['invalid_request', 'connection_error_before'], [3000, 3000], 6000);
    eq('failed + unresolved: unfinished (202), success false', shape(x.r), [202, 'unresolved', false, false, 0, 0, 3000, 3000]);
    ok('failed + unresolved: the browser keeps the identity', classifyRefundResponse(x.r.status, x.r.json).keepKey === true);
    x = await run(['succeed', 'invalid_request'], [3000, 3000], 6000);
    eq('succeeded + failed: FINAL partial (207), never a success', shape(x.r), [207, 'partial', true, false, 3000, 0, 3000, 0]);
    ok('succeeded + failed: the browser keeps the key (the same request cannot refund the settled part again) and names the rejected amount', classifyRefundResponse(x.r.status, x.r.json).keepKey === true && /\$30\.00/.test(classifyRefundResponse(x.r.status, x.r.json).message));
    const same = await refundCall(x.c, { amountCents: 6000, operationKey: x.key });
    eq('retry after a final partial failure: the same answer, no provider request at all', [shape(same), providerCalls(x.c)], [shape(x.r), 2]);
    const rest = await refundCall(x.c, { amountCents: 3000, operationKey: newKey() });
    eq('...and the rejected part can be requested again explicitly as a NEW refund', [rest.status, rest.json?.status, x.c.w.stripe.refundedTotal], [200, 'succeeded', 6000]);
    x = await run(['succeed', 'invalid_request', 'pending'], [3000, 3000, 3000], 9000);
    eq('succeeded + failed + pending: unfinished (202), every amount reported', shape(x.r), [202, 'unresolved', false, false, 3000, 3000, 3000, 0]);
    x = await run(['invalid_request', 'connection_error_before'], [3000, 3000], 6000);
    const fixed = await refundCall(x.c, { amountCents: 6000, operationKey: x.key });
    eq('retry after an unresolved partial: only the unresolved portion is sent, and the result is the FINAL partial', [shape(fixed), providerCalls(x.c)], [[207, 'partial', true, false, 3000, 0, 3000, 0], 3]);
    x = await run([], [4000, 4000], 8000);
    const done = await refundCall(x.c, { amountCents: 8000, operationKey: x.key });
    eq('retry after a completed refund: the same success, no provider request, no second refund', [done.json?.status, done.json?.existing, providerCalls(x.c), x.c.w.stripe.refundedTotal], ['succeeded', true, 2, 8000]);
  }

  {
    // 15d. another session, another page, a reload: an unsettled request is resumed, never replaced
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['connection_error_before'];
    await refundCall(c, { amountCents: 2500, operationKey: key });
    const other = await refundCall(c, { amountCents: 2500, operationKey: newKey() }, 'jwt-master');
    ok('other session, same amount: blocked, and the answer names the unsettled request', other.status === 409 && other.json?.code === 'UNSETTLED_REFUND_EXISTS' && other.json?.resumeOperationKey === key && other.json?.resumeAmountCents === 2500);
    eq('other session: no provider request was made for the blocked one', providerCalls(c), 1);
    const different = await refundCall(c, { amountCents: 700, operationKey: newKey() });
    ok('other session, different amount: also blocked while the first is unsettled', different.status === 409 && different.json?.code === 'UNSETTLED_REFUND_EXISTS');
    const adopt = classifyRefundResponse(other.status, other.json);
    ok('browser: the blocked answer is turned into "resume that request"', adopt.kind === 'unsettled' && adopt.adopt?.key === key && adopt.adopt?.amountCents === 2500 && adopt.keepKey === true);
    const attempt = refundAttemptFor({ key: adopt.adopt!.key, orderId: c.orderId, amountCents: adopt.adopt!.amountCents }, c.orderId, 2500);
    ok('browser: pressing again with the adopted amount reuses the adopted key', attempt.key === key);
    const resumed = await refundCall(c, { amountCents: 2500, operationKey: attempt.key }, 'jwt-master');
    eq('resume: settles THE SAME refund (one refund at Stripe, recorded once)', [resumed.status, resumed.json?.status, c.w.stripe.refundCreatedCount, await totalRefunded(c.orderId)], [200, 'succeeded', 1, 2500]);
    const again = await refundCall(c, { amountCents: 2500, operationKey: newKey() });
    eq('explicit new refund: once settled, a NEW request of the same amount is allowed and is a second refund', [again.status, again.json?.status, c.w.stripe.refundCreatedCount, await totalRefunded(c.orderId)], [200, 'succeeded', 2, 5000]);
  }
  {
    // a pending refund that Stripe already has (provider id on record) does not block a new request
    const c = await newCase([10000]);
    c.w.stripe.refundBehaviors = ['pending'];
    await refundCall(c, { amountCents: 2000, operationKey: newKey() });
    const next = await refundCall(c, { amountCents: 3000, operationKey: newKey() });
    eq('a refund Stripe is already processing does not block another request', [next.status, next.json?.status], [200, 'succeeded']);
  }
  {
    // a request that never reached Stripe: kept for a quarter of an hour, then released
    const c = await newCase([10000]);
    const key = newKey();
    c.w.failRpc['mark_refund_provider_attempt'] = { error: retryError, times: 1 };
    await refundCall(c, { amountCents: 4000, operationKey: key });
    const young = await refundCall(c, { amountCents: 4000, operationKey: newKey() });
    ok('unsent request, young: still blocks a different request (its owner may be retrying)', young.status === 409 && young.json?.code === 'UNSETTLED_REFUND_EXISTS');
    await ageOperation(key, 1);
    const fresh = await refundCall(c, { amountCents: 9000, operationKey: newKey() });
    eq('unsent request, abandoned: it is released and the whole amount can be refunded', [fresh.status, fresh.json?.status, c.w.stripe.refundedTotal], [200, 'succeeded', 9000]);
    const old = (await refundRows(c.orderId)).find((x: any) => x.operation_key === key);
    eq('unsent request, abandoned: its row is failed with the reason, nothing was ever sent for it', [old.status, old.failure_reason, old.provider_attempted_at], ['failed', 'abandoned before any provider request was made', null]);
    const late = await refundCall(c, { amountCents: 4000, operationKey: key });
    eq('unsent request, abandoned: its old key reports it failed and sends nothing', [late.status, late.json?.status, providerCalls(c)], [422, 'failed', 1]);
  }
  {
    // an operation that was partly sent is never released row by row: its untouched second portion waits for the same key
    const c = await newCase([3000, 3000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['connection_error_before'];
    await refundCall(c, { amountCents: 6000, operationKey: key });
    await ageOperation(key, 1);
    const blocked = await refundCall(c, { amountCents: 100, operationKey: newKey() });
    ok('partly sent operation, 1 hour old: a different request is blocked and the operation keeps its second portion', blocked.status === 409 && (await refundRows(c.orderId)).filter((x: any) => x.operation_key === key && x.status === 'pending').length === 2);
    const resumed = await refundCall(c, { amountCents: 6000, operationKey: key });
    eq('partly sent operation: resuming it with its own key refunds BOTH portions, once each', [resumed.status, resumed.json?.status, c.w.stripe.refundCreatedCount, c.w.stripe.refundedTotal], [200, 'succeeded', 2, 6000]);
  }
  {
    // a request whose provider request MAY have started is never released by time
    const c = await newCase([10000]);
    const key = newKey();
    c.w.stripe.refundBehaviors = ['connection_error_before'];
    await refundCall(c, { amountCents: 4000, operationKey: key });
    await ageOperation(key, 48);
    const blocked = await refundCall(c, { amountCents: 4000, operationKey: newKey() });
    eq('attempted request, 48 hours old: still blocks (only the provider can say whether it exists)', [blocked.status, blocked.json?.code, blocked.json?.resumeOperationKey], [409, 'UNSETTLED_REFUND_EXISTS', key]);
  }
  {
    // a completed or finally failed request never blocks and is never resumed into another refund
    const c = await newCase([10000]);
    const done = newKey();
    await refundCall(c, { amountCents: 1000, operationKey: done });
    const next = await refundCall(c, { amountCents: 1000, operationKey: newKey() });
    eq('a completed request does not block a new one', [next.status, c.w.stripe.refundCreatedCount], [200, 2]);
    const replay = await refundCall(c, { amountCents: 1000, operationKey: done });
    eq('a completed request cannot be resumed into another refund', [replay.json?.existing, c.w.stripe.refundCreatedCount], [true, 2]);
    c.w.stripe.refundBehaviors = ['invalid_request'];
    const bad = newKey();
    await refundCall(c, { amountCents: 500, operationKey: bad });
    const after = await refundCall(c, { amountCents: 500, operationKey: newKey() });
    eq('a finally failed request does not block a new one', [after.status, c.w.stripe.refundCreatedCount], [200, 3]);
  }

  {
    // 15e. history: refunds recorded before refunds were linked to a payment are never guessed onto one of several payments
    const c = await newCase([4000, 6000]);
    await pg.exec(`INSERT INTO public.order_refunds (order_id, amount_cents, reason, status, stripe_refund_id, ledger_version) VALUES ('${c.orderId}', 6000, 'old refund', 'succeeded', 're_old_${TAG}', NULL);`);
    const r = await refundCall(c, { amountCents: 1000, operationKey: newKey() });
    ok('history, two payments: a new refund is refused (409 REFUND_ALLOCATION_AMBIGUOUS) and nothing is sent', r.status === 409 && r.json?.code === 'REFUND_ALLOCATION_AMBIGUOUS' && providerCalls(c) === 0);
    eq('history, two payments: nothing was reserved or rewritten', (await refundRows(c.orderId)).map((x: any) => [x.amount_cents, x.status, x.ledger_version]), [[6000, 'succeeded', null]]);
    const single = await newCase([10000]);
    await pg.exec(`INSERT INTO public.order_refunds (order_id, amount_cents, reason, status, stripe_refund_id, ledger_version) VALUES ('${single.orderId}', 6000, 'old refund', 'succeeded', 're_old2_${TAG}', NULL);`);
    const ok1 = await refundCall(single, { amountCents: 4000, operationKey: newKey() });
    eq('history, one payment: nothing is ambiguous (every old refund belongs to it), the remainder can be refunded', [ok1.status, ok1.json?.status], [200, 'succeeded']);
    const dup = await newCase([4000, 6000]);
    await pg.exec(`INSERT INTO public.order_refunds (order_id, amount_cents, reason, status, stripe_refund_id, ledger_version) VALUES ('${dup.orderId}', 1000, 'old', 'succeeded', 're_dupe_${TAG}', NULL), ('${dup.orderId}', 1000, 'old again', 'pending', 're_dupe_${TAG}', NULL);`);
    const blocked = await refundCall(dup, { amountCents: 100, operationKey: newKey() });
    ok('history, duplicated old rows: the refund is refused, never allocated by inference', blocked.status === 409 && providerCalls(dup) === 0);
  }

  {
    // 15f. the waived-deposit marker is an informational flag: the money functions never read it
    const c = await newCase([], { status: 'confirmed' });
    await pg.exec(`UPDATE public.orders SET deposit_due_cents = 0, balance_due_cents = 20000, stripe_payment_status = NULL WHERE id = '${c.orderId}';`);
    const claim = async (paymentStatus: string | null) => {
      await pg.exec(`UPDATE public.orders SET stripe_payment_status = ${paymentStatus === null ? 'NULL' : `'${paymentStatus}'`} WHERE id = '${c.orderId}';`);
      const rows = await pg.query(`SELECT public.claim_payment_operation('${c.orderId}', 'balance', 'staff', gen_random_uuid(), false, 5000, 0, NULL, 300) AS j`, true);
      const j = rows?.[0]?.j ?? rows;
      if (j?.payment_id) await pg.exec(`UPDATE public.payments SET status = 'cancelled', claim_id = NULL, claimed_at = NULL WHERE id = '${j.payment_id}';`);
      return j?.outcome ?? (j?.payment_id ? 'claimed' : JSON.stringify(rows));
    };
    const withoutMarker = await claim(null);
    const withMarker = await claim('paid');
    eq('waived deposit: a balance charge on a $0-deposit order is decided identically with and without the marker', withMarker, withoutMarker);
    const noSucceeded = await pg.query(`SELECT count(*)::int AS n FROM public.payments WHERE order_id = '${c.orderId}' AND status = 'succeeded'`);
    eq('waived deposit: a $0 deposit creates no payment row at all (no fictitious Stripe transaction)', noSucceeded[0].n, 0);
  }

  {
    // 15g. the unresolved answer's shape for the browser (every entry point shares this helper)
    const allUnfinished = classifyRefundResponse(202, { status: 'unresolved', final: false, failedCents: 0, unresolvedCents: 100 });
    ok('browser: an unresolved answer keeps the key and never reads as a success', allUnfinished.keepKey && allUnfinished.tone === 'warning' && allUnfinished.kind === 'unresolved');
    ok('browser: a failed (422) answer ends the attempt (a fresh press is a fresh request)', classifyRefundResponse(422, { status: 'failed' }).keepKey === false);
    ok('browser: an ambiguous-history answer is an error and keeps no key', classifyRefundResponse(409, { code: 'REFUND_ALLOCATION_AMBIGUOUS', error: 'x' }).keepKey === false);
  }

  // =================================================================================================================
  // 14. Source wiring (what the tests above cannot reach: the Stripe endpoint routing and the browser callers)
  // =================================================================================================================
  {
    const read = (f: string) => require('fs').readFileSync(f, 'utf8');
    const webhook = read('supabase/functions/stripe-webhook/index.ts');
    ok('wiring: charge.refunded is routed to the refund handler together with the Stripe client (it lists the refunds itself)', /case "charge\.refunded":\s*await handleChargeRefunded\(event\.data\.object as Stripe\.Charge, supabaseClient, stripe\);/.test(webhook));
    for (const ev of ['refund.created', 'refund.updated', 'refund.failed', 'charge.refund.updated']) ok(`wiring: ${ev} is routed to the individual refund handler`, new RegExp(`case "${ev.replace('.', '\\.')}":`).test(webhook) && /await handleRefundEvent\(event\.data\.object as Stripe\.Refund, supabaseClient\);/.test(webhook));
    const handlersSrc = read('supabase/functions/stripe-webhook/handlers.ts');
    ok('wiring: the webhook never uses the cumulative charge.amount_refunded or the embedded charge.refunds list', !/amount_refunded|charge\.refunds/.test(handlersSrc.replace(/\/\/.*$/gm, '')));
    ok('wiring: the webhook no longer inserts refund or payment rows itself', !/from\("order_refunds"\)|from\("payments"\)\s*\.insert/.test(handlersSrc));
    ok('wiring: the webhook lists the refunds of a charge one by one', /stripe\.refunds\.list\(\{ charge: charge\.id/.test(handlersSrc));
    for (const [file, label] of [['src/components/order-detail/PaymentsTab.tsx', 'Payments tab'], ['src/components/pending-order/PaymentManagementSection.tsx', 'pending-order payment section'], ['src/components/admin/tasks/detail/TaskDetailCustomerInfo.tsx', 'task modal']] as const) {
      const src = read(file);
      ok(`wiring: the ${label} sends refunds only through the shared refund panel (no refund request, key or amount of its own)`, /<RefundAllocationPanel/.test(src) && !/stripe-refund|operationKey|refundAttemptFor|parseFloat/.test(src));
    }
    const ctlSrc = read('src/lib/payments/refundController.ts');
    ok('wiring: the shared refund screen sends a stable operation key with every refund and reuses the previous attempt for a retry', /operationKey: attempt\.key/.test(ctlSrc) && /allocationAttemptFor\(this\.state\.frozen\?\.attempt \?\? null,/.test(ctlSrc));
    const mig4 = read('supabase/migrations/20261022120000_refund_safety_and_financial_write_authority.sql');
    const reserveFn = /FUNCTION public\.reserve_refund_operation[\s\S]*?\n\$\$;/.exec(mig4)?.[0] ?? '';
    ok('wiring: the refund reservation takes the order row lock before it reads what is refundable', /FROM public\.orders WHERE id = p_order_id FOR UPDATE;[\s\S]*?FROM public\.order_refunds WHERE order_id = p_order_id AND status IN/.test(reserveFn));
    for (const fn of ['_apply_refund_transition(uuid, text, text)', 'reserve_refund_operation(uuid, text, integer, text, uuid)', 'mark_refund_provider_attempt(uuid)', 'record_refund_provider_result(uuid, text, text, text)', 'apply_provider_refund_event(text, text, integer, text, text, text, text)', 'cancel_unattempted_payments_on_order_close()', 'note_payment_applied_to_closed_order()', 'guard_order_pricing_authority()']) {
      ok(`wiring: ${fn.split('(')[0]} is revoked from PUBLIC, anon and authenticated by the migration itself`, mig4.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`));
    }
    ok('wiring: the shared refund screen takes over an unfinished refund found in the database (its stored key and allocation) instead of starting another refund', /overview\.operations\.filter\(\(o\) => o\.unfinished\)/.test(ctlSrc) && /reconstructStoredRequest\(op\)/.test(ctlSrc) && /recoveries\.length > 0 \? 'recovery'/.test(ctlSrc));
    const opsSrc = read('supabase/functions/_shared/payments/refund-operations.ts');
    ok('wiring: a provider request needs the marker (or an earlier one on record), and only an explicit true counts as written', /marked = res\?\.data === true;/.test(opsSrc) && /if \(!\(marked \|\| \(markerFailed && alreadyMarked\)\)\) return/.test(opsSrc));
    ok('wiring: outside the replay window only a COMPLETE lookup allows a new request', /if \(!look\.complete && age > IDEMPOTENCY_SAFE_MS\) return/.test(opsSrc));
    ok('wiring: the lookup follows every page and needs an explicit has_more=false', /starting_after: startingAfter/.test(opsSrc) && /list\.has_more === false\) return \{ found: null, complete: true \}/.test(opsSrc));
    ok('wiring: the reservation blocks a new request while another is unsettled, and refuses an ambiguous history', /'outcome', 'unsettled_operation'/.test(reserveFn) && /'outcome', 'allocation_ambiguous'/.test(reserveFn));
    const refundFn = read('supabase/functions/stripe-refund/index.ts');
    ok('wiring: the refund function passes the operation key and writes nothing itself (the database functions do)', /operationKey: body\.operationKey/.test(refundFn) && !/\.insert\(|\.update\(|\.delete\(/.test(refundFn));
    const ops = read('supabase/functions/_shared/payments/refund-operations.ts');
    ok('wiring: every Stripe refund request carries the row\'s stable idempotency key', /\{ idempotencyKey: row\.provider_idempotency_key \}/.test(ops));
    ok('wiring: a refund names its row in its metadata', /bpc_refund_id: row\.id/.test(ops));
    const approval = read('src/lib/orders/orderApprovalService.ts').replace(/\/\/.*$/gm, '');
    ok('wiring: order approval and rejection no longer write payment rows or payment-state flags from the browser', !/from\('payments'\)\s*\.(update|insert|upsert|delete)/.test(approval) && !/stripe_payment_status\s*:/.test(approval));
    const lifecycle = read('supabase/functions/order-lifecycle/index.ts');
    ok('wiring: the waived-deposit marker is written by the lifecycle function for a trusted admin approval only', /trustedCaller && requestedOutcome === "waived" && source === "admin_approve_zero_deposit" && depositDue === 0/.test(lifecycle));
  }

  // =================================================================================================================
  // 13. Allocation-aware refunds through the real function: deposit / balance / tip chosen per original payment
  // =================================================================================================================
  {
    const { spawnSync } = require('child_process');
    const NLC = String.fromCharCode(10);
    // order_net_financials as the service role (the payment scratch database has no default table grants, so they are granted inside a rolled-back transaction)
    const netOf = (orderId: string): any => {
      const script = `BEGIN;${NLC}GRANT SELECT ON public.payments, public.order_refunds, public.orders TO service_role;${NLC}SET LOCAL ROLE service_role;${NLC}SELECT 'R|' || public.order_net_financials('${orderId}')::text;${NLC}ROLLBACK;`;
      const pr = spawnSync(db.psql, [...psqlArgs(db.db)], { input: script, encoding: 'utf8' });
      const line = String(pr.stdout ?? '').split(NLC).find((l: string) => l.startsWith('R|'));
      try { return JSON.parse((line ?? '').slice(2).trim()); } catch { return null; }
    };
    // An order whose card payments carry their recorded deposit / balance / tip split. Payment ids ascend, and the reservation orders the
    // lines by payment id, so the first payment is the first provider request.
    async function newAllocCase(parts: Array<{ dep?: number; bal?: number; tip?: number }>): Promise<Case> {
      const w = makeWorld(pg);
      w.users = { 'jwt-admin': ADMIN, 'jwt-master': MASTER, 'jwt-crew': CREW, 'jwt-cust': CUST };
      w.tables.user_roles = [{ user_id: MASTER, role: 'master' }, { user_id: ADMIN, role: 'admin' }, { user_id: CREW, role: 'crew' }, { user_id: CUST, role: 'customer' }];
      const orderId = nextId();
      createdOrders.push(orderId);
      await pg.exec(`INSERT INTO public.orders (id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents, deposit_paid_cents, balance_paid_cents, tip_cents, stripe_payment_status)
        VALUES ('${orderId}', 'confirmed', 'residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 'next_day', 60000, 25661, 34339, 25661, 0, 5132, 'paid');`);
      const pis: string[] = [];
      const payIds: string[] = [];
      for (const part of parts) {
        const dep = part.dep ?? 0, bal = part.bal ?? 0, tip = part.tip ?? 0;
        const amount = dep + bal + tip;
        const pi = w.stripe.addSucceededPaymentIntent(amount);
        const id = nextId();
        pis.push(pi.id);
        payIds.push(id);
        await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, stripe_payment_intent_id, paid_at, payment_method, payment_brand, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, order_financials_applied)
          VALUES ('${id}', '${orderId}', '${dep > 0 ? 'deposit' : 'balance'}', ${amount}, 'succeeded', '${pi.id}', now(), 'card', 'visa', ${dep + bal}, ${tip}, ${dep}, ${bal}, true);`);
      }
      return { w, orderId, pis, payIds };
    }
    const L = (paymentId: string, d: number, b: number, t: number) => ({ paymentId, depositPrincipalCents: d, balancePrincipalCents: b, tipCents: t });
    const allocCall = (c: Case, key: string, allocations: unknown, extra: Record<string, unknown> = {}, bearer: string | null = 'jwt-admin') => refundCall(c, { operationKey: key, allocations, ...extra }, bearer);
    const names = (c: Case) => c.w.rpcCalls.map((x) => x.name);
    const OPERATIONAL = ['deposit_due_cents', 'deposit_paid_cents', 'balance_due_cents', 'balance_paid_cents', 'tip_cents', 'stripe_payment_status', 'status'];
    const opFields = async (id: string) => { const o = await orderRow(id); return OPERATIONAL.map((k) => o[k]); };
    const sortedIds = (c: Case) => [...c.payIds].sort();
    const compsOf = (rows: any[]) => rows.map((x: any) => [x.deposit_principal_refunded_cents, x.balance_principal_refunded_cents, x.tip_refunded_cents, x.unclassified_refunded_cents, x.allocation_version]);

    // ---- routing and request validation
    {
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }]);
      const pay = c.payIds[0];
      const r1 = await refundCall(c, { amountCents: 1000, operationKey: newKey() });
      eq('routing: an amount-only request uses the amount-only reservation only', [r1.status, names(c).includes('reserve_refund_operation'), names(c).includes('reserve_refund_allocation')], [200, true, false]);
      const c2 = await newAllocCase([{ dep: 25661, tip: 5132 }]);
      const r2 = await allocCall(c2, newKey(), [L(c2.payIds[0], 7500, 0, 2500)], { amountCents: 10000 });
      eq('routing: an allocation-aware request uses the allocation reservation only', [r2.status, names(c2).includes('reserve_refund_allocation'), names(c2).includes('reserve_refund_operation')], [200, true, false]);
      void pay;
      const c3 = await newAllocCase([{ dep: 5000, tip: 1000 }]);
      const p3 = c3.payIds[0];
      const bad: Array<[string, unknown, Record<string, unknown>, string]> = [
        ['an empty allocation list with an amount (mixed mode)', [], { amountCents: 1000 }, 'allocations_required'],
        ['allocations that are not a list', 'x', {}, 'allocations_required'],
        ['allocations that are null', null, { amountCents: 1000 }, 'allocations_required'],
        ['a line that is not an object', [5], {}, 'line_not_an_object'],
        ['a missing component', [{ paymentId: p3, depositPrincipalCents: 100, tipCents: 0 }], {}, 'component_missing'],
        ['a component sent as text', [{ ...L(p3, 100, 0, 0), tipCents: '5' }], {}, 'component_missing'],
        ['a negative component', [L(p3, -1, 0, 100)], {}, 'component_negative'],
        ['a fractional component', [{ ...L(p3, 100, 0, 0), balancePrincipalCents: 0.5 }], {}, 'component_fractional'],
        ['an invalid payment id', [L('not-a-uuid', 100, 0, 0)], {}, 'payment_id_invalid'],
        ['the same payment twice', [L(p3, 100, 0, 0), L(p3, 0, 0, 100)], {}, 'duplicate_payment'],
        ['the same payment twice in different letter case', [L(p3, 100, 0, 0), L(p3.toUpperCase(), 0, 0, 100)], {}, 'duplicate_payment'],
        ['an unknown field', [{ ...L(p3, 100, 0, 0), note: 'x' }], {}, 'unknown_field'],
        ['a zero line', [L(p3, 0, 0, 0)], {}, 'zero_line'],
        ['more than the maximum number of lines', Array.from({ length: 21 }, () => L(p3, 1, 0, 0)), {}, 'allocations_required'],
        ['a declared amount that is not a number', [L(p3, 100, 0, 0)], { amountCents: '100' }, 'declared_total_invalid'],
      ];
      for (const [label, alloc, extra, detail] of bad) {
        const r = await allocCall(c3, newKey(), alloc, extra);
        eq(`validation: ${label} is refused before the database or Stripe is contacted`, [r.status, r.json?.code, r.json?.detail], [400, 'INVALID_ALLOCATION', detail]);
      }
      const mism = await allocCall(c3, newKey(), [L(p3, 100, 0, 100)], { amountCents: 150 });
      eq('validation: a declared total that disagrees with the allocations is refused', [mism.status, mism.json?.code], [400, 'ALLOCATION_TOTAL_MISMATCH']);
      eq('validation: ...none of them reached a reservation function or Stripe', [names(c3).filter((n) => n.startsWith('reserve_')).length, c3.w.stripe.calls.length, (await refundRows(c3.orderId)).length], [0, 0, 0]);
    }

    // ---- Stripe execution from the reserved rows
    {
      const kinds: Array<[string, { dep?: number; bal?: number; tip?: number }, [number, number, number]]> = [
        ['deposit principal only', { dep: 25661, bal: 10000, tip: 5132 }, [5000, 0, 0]],
        ['tip only', { dep: 25661, bal: 10000, tip: 5132 }, [0, 0, 3000]],
        ['deposit principal + tip', { dep: 25661, bal: 10000, tip: 5132 }, [7500, 0, 2500]],
        ['balance principal + tip', { dep: 25661, bal: 10000, tip: 5132 }, [0, 4000, 1500]],
      ];
      for (const [label, parts, [d, b, t]] of kinds) {
        const c = await newAllocCase([parts]);
        const key = newKey();
        const r = await allocCall(c, key, [L(c.payIds[0], d, b, t)]);
        const rows = await refundRows(c.orderId);
        eq(`stripe: ${label}: one Stripe refund for the reserved amount on the original PaymentIntent, with the row's idempotency key and metadata`, [r.status, r.json?.status, creates(c).map((x) => [x.params.amount, x.params.payment_intent, x.key, x.params.metadata.bpc_refund_id === rows[0].id])], [200, 'succeeded', [[d + b + t, c.pis[0], `refund:${key}:0`, true]]]);
        eq(`stripe: ${label}: the row carries exactly the allocation and it is settled`, [compsOf(rows), rows.map((x: any) => x.status), rows.map((x: any) => x.ledger_version)], [[[d, b, t, 0, 1]], ['succeeded'], [2]]);
      }
      // several original payments
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }, { bal: 10000 }, { tip: 3000 }]);
      const key = newKey();
      const [p1, p2, p3] = c.payIds;
      const r = await allocCall(c, key, [L(p3, 0, 0, 3000), L(p1, 7500, 0, 2500), L(p2, 0, 4000, 0)], { amountCents: 17000 });
      eq('stripe: three original payments: one Stripe refund per payment, each on its own PaymentIntent for its own amount', [r.status, r.json?.requestedCents, r.json?.succeededCents, [...creates(c).map((x) => [x.params.payment_intent, x.params.amount])].sort()], [200, 17000, 17000, [[c.pis[0], 10000], [c.pis[1], 4000], [c.pis[2], 3000]].sort()]);
      eq('stripe: ...with stable keys by operation index, and the response states each line', [creates(c).map((x) => x.key), r.json?.refunds?.map((x: any) => [x.paymentId, x.depositPrincipalCents, x.balancePrincipalCents, x.tipCents])], [[0, 1, 2].map((i) => `refund:${key}:${i}`), (await refundRows(c.orderId)).map((x: any) => [x.payment_id, x.deposit_principal_refunded_cents, x.balance_principal_refunded_cents, x.tip_refunded_cents])]);
      void p1; void p2; void p3;
    }
    {
      // a refused reservation contacts nobody
      const c = await newAllocCase([{ dep: 5000, tip: 1000 }]);
      const r = await allocCall(c, newKey(), [L(c.payIds[0], 5001, 0, 0)]);
      eq('stripe: a request over a payment\'s capacity is refused with the component named and zero Stripe calls', [r.status, r.json?.code, r.json?.remainingCents, c.w.stripe.calls.length, (await refundRows(c.orderId)).length], [400, 'DEPOSIT_CAPACITY_EXCEEDED', 5000, 0, 0]);
      const t = await allocCall(c, newKey(), [L(c.payIds[0], 0, 0, 1001)]);
      eq('stripe: ...a tip over the payment\'s tip', [t.status, t.json?.code, t.json?.remainingCents], [400, 'TIP_CAPACITY_EXCEEDED', 1000]);
      const b = await allocCall(c, newKey(), [L(c.payIds[0], 0, 1, 0)]);
      eq('stripe: ...balance principal the payment never had', [b.status, b.json?.code], [400, 'BALANCE_CAPACITY_EXCEEDED']);
      const tot = await allocCall(c, newKey(), [L(c.payIds[0], 5000, 0, 1001)]);
      eq('stripe: ...and a total over the payment', [tot.status, tot.json?.code, tot.json?.maxRefundableCents], [400, 'EXCEEDS_REFUNDABLE', 6000]);
      const other = await newAllocCase([{ dep: 5000 }]);
      const wrong = await allocCall(c, newKey(), [L(other.payIds[0], 100, 0, 0)]);
      eq('stripe: a payment of another order is refused', [wrong.status, wrong.json?.code], [400, 'PAYMENT_NOT_ON_ORDER']);
      const nf = await allocCall(c, newKey(), [L(nextId(), 100, 0, 0)]);
      eq('stripe: a payment that does not exist is refused', [nf.status, nf.json?.code], [404, 'PAYMENT_NOT_FOUND']);
      const pendPay = nextId();
      await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, stripe_payment_intent_id, payment_method, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents) VALUES ('${pendPay}', '${c.orderId}', 'deposit', 500, 'pending', 'pi_alloc_pend_${TAG}', 'card', 500, 0, 500, 0);`);
      ok('fixture: the pending payment row exists', (await pg.query(`SELECT 1 AS x FROM public.payments WHERE id = '${pendPay}'`)).length === 1);
      const pr = await allocCall(c, newKey(), [L(pendPay, 100, 0, 0)]);
      eq('stripe: a payment that has not succeeded is refused', [pr.status, pr.json?.code], [409, 'PAYMENT_NOT_SUCCEEDED']);
      const uncPay = nextId();
      await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, stripe_payment_intent_id, payment_method) VALUES ('${uncPay}', '${c.orderId}', 'deposit', 500, 'succeeded', 'pi_alloc_unc_${TAG}', 'card');`);
      ok('fixture: the unclassified payment row exists', (await pg.query(`SELECT 1 AS x FROM public.payments WHERE id = '${uncPay}'`)).length === 1);
      const ur = await allocCall(c, newKey(), [L(uncPay, 100, 0, 0)]);
      eq('stripe: a payment with no recorded split is refused', [ur.status, ur.json?.code], [409, 'PAYMENT_UNCLASSIFIED']);
      eq('stripe: none of those refusals contacted Stripe or left a row', [c.w.stripe.calls.length, (await refundRows(c.orderId)).length], [0, 0]);
      c.w.failRpc['reserve_refund_allocation'] = { error: { message: 'permission denied for function reserve_refund_allocation', code: '42501' }, times: 1 };
      const denied = await allocCall(c, newKey(), [L(c.payIds[0], 100, 0, 0)]);
      eq('stripe: a database permission failure on the reservation stops everything before Stripe', [denied.status, denied.json?.code, c.w.stripe.calls.length, (await refundRows(c.orderId)).length], [500, 'REFUND_RESERVATION_FAILED', 0, 0]);
      c.w.failRpc['reserve_refund_allocation'] = { error: null, times: 0 };
    }
    {
      // A reservation answer that is incomplete, or does not match EXACTLY what was asked for each payment, fails closed BEFORE any
      // provider request or attempt marker: the database is the authority, and this is a second barrier between it and Stripe.
      const key = newKey();
      const [p1, p2] = [nextId(), nextId()].sort();
      const oid = nextId();
      const row = (i: number, pid: string, d: number, b: number, t: number, over: Record<string, unknown> = {}) => ({
        id: nextId(), operation_index: i, payment_id: pid, stripe_payment_intent_id: `pi_direct_${i}`, amount_cents: d + b + t, status: 'pending', stripe_refund_id: null,
        provider_idempotency_key: `refund:${key}:${i}`, provider_attempted_at: null, allocation_version: 1,
        deposit_principal_refunded_cents: d, balance_principal_refunded_cents: b, tip_refunded_cents: t, unclassified_refunded_cents: 0, created_at: new Date().toISOString(), ...over,
      });
      // the canonical identity the database records: total, then the lines sorted by payment id
      const canon = (ls: Array<{ paymentId: string; depositPrincipalCents: number; balancePrincipalCents: number; tipCents: number }>) => {
        const sorted = [...ls].sort((x, y) => (x.paymentId < y.paymentId ? -1 : 1));
        return `v1|total=${sorted.reduce((acc, l) => acc + l.depositPrincipalCents + l.balancePrincipalCents + l.tipCents, 0)}|${sorted.map((l) => `${l.paymentId}:${l.depositPrincipalCents}:${l.balancePrincipalCents}:${l.tipCents}`).join('|')}`;
      };
      const lines = [L(p1, 100, 0, 50), L(p2, 0, 40, 0)];
      const SIG = canon(lines);
      const run = async (answer: any, sent: unknown = lines) => {
        const calls: string[] = [];
        const db = { rpc: async (name: string) => { calls.push(name); return { data: name === 'reserve_refund_allocation' ? answer : null, error: null }; } };
        const stripe = { refunds: { create: async () => { calls.push('stripe.create'); throw new Error('must not be called'); }, list: async () => { calls.push('stripe.list'); return { data: [], has_more: false }; }, retrieve: async () => { calls.push('stripe.retrieve'); return {}; } } };
        const res = await refundOps.runRefundOperation({ db, stripe }, { orderId: oid, operationKey: key, amountCents: undefined, reason: 'x', actorId: ADMIN, allocations: sent });
        return { res, calls };
      };
      const good = [row(0, p1, 100, 0, 50), row(1, p2, 0, 40, 0)];
      const reserved = (refunds: any[], request_allocation: unknown = SIG) => ({ outcome: 'reserved', request_allocation, refunds });
      const cases: Array<[string, any]> = [
        ['a row without a PaymentIntent', reserved([{ ...good[0], stripe_payment_intent_id: null }, good[1]])],
        ['a row with another idempotency key', reserved([{ ...good[0], provider_idempotency_key: 'refund:other:0' }, good[1]])],
        ['a row for a payment that was not requested', reserved([good[0], row(1, nextId(), 0, 40, 0)])],
        ['the same payment reserved twice', reserved([good[0], row(1, p1, 0, 40, 0)])],
        ['an extra row for a payment that already has one', reserved([good[0], good[1], row(2, p1, 0, 40, 0)])],
        ['a missing line', reserved([good[0]])],
        ['no rows at all', reserved([])],
        ['rows in another order than the database fixes', reserved([row(0, p2, 0, 40, 0), row(1, p1, 100, 0, 50)])],
        ['amounts moved between the rows while every component and the total look right', reserved([{ ...good[0], amount_cents: 155 }, { ...good[1], amount_cents: 35 }])],
        ['a row with no allocation recorded', reserved([good[0], { ...good[1], allocation_version: null }])],
        ['a row whose components disagree with its amount', reserved([good[0], { ...good[1], tip_refunded_cents: 5 }])],
        ['the right payment and total but a different deposit principal (and tip)', reserved([row(0, p1, 120, 0, 30), good[1]])],
        ['the right payment and total but a different balance principal (and deposit)', reserved([row(0, p1, 0, 100, 50), good[1]])],
        ['the right payment and total but a different tip (and deposit)', reserved([row(0, p1, 50, 0, 100), good[1]])],
        ['a different deposit principal alone', reserved([row(0, p1, 101, 0, 50), good[1]])],
        ['a different balance principal alone', reserved([good[0], row(1, p2, 0, 41, 0)])],
        ['a different tip alone', reserved([row(0, p1, 100, 0, 51), good[1]])],
        ['a nonzero unclassified component (amount includes it)', reserved([row(0, p1, 100, 0, 50, { unclassified_refunded_cents: 5, amount_cents: 155 }), good[1]])],
        ['a nonzero unclassified component taking the place of tip', reserved([row(0, p1, 100, 0, 45, { unclassified_refunded_cents: 5, amount_cents: 150 }), good[1]])],
        ['components swapped between the two payments', reserved([row(0, p1, 0, 40, 0), row(1, p2, 100, 0, 50)])],
        ['the right total overall but a wrong split on one payment', reserved([row(0, p1, 140, 0, 10), good[1]])],
        ['an identity that is not the canonical one', reserved(good, 'v1|total=190|x')],
        ['an identity of different lines with the same total', reserved(good, canon([L(p1, 150, 0, 0), L(p2, 0, 40, 0)]))],
        ['an identity for the lines in a non-canonical order', reserved(good, `v1|total=190|${p2}:0:40:0|${p1}:100:0:50`)],
        ['no request identity', { outcome: 'reserved', refunds: good }],
        ['an outcome the function does not know', { outcome: 'something_new', refunds: good }],
        ['an empty answer', null],
      ];
      for (const [label, answer] of cases) {
        const { res, calls } = await run(answer);
        eq(`fail closed: ${label}: refused, and neither the attempt marker nor Stripe was touched`, [res.status, res.body.code, calls], [500, 'REFUND_RESERVATION_FAILED', ['reserve_refund_allocation']]);
      }
      const sound = await run(reserved(good));
      ok('fail closed: an exact answer is accepted (the first provider step starts with the attempt marker)', sound.calls[0] === 'reserve_refund_allocation' && sound.calls[1] === 'mark_refund_provider_attempt');
      ok('fail closed: ...and the requested total is the reserved one (190)', sound.res.body.requestedCents === 190);
      const reordered = await run(reserved(good), [lines[1], lines[0]]);
      ok('fail closed: the same lines requested in another order are accepted (the rows are in the database order)', reordered.calls[1] === 'mark_refund_provider_attempt' && reordered.res.body.requestedCents === 190);
      const single = await run(reserved([row(0, p1, 75, 0, 25)], canon([L(p1, 75, 0, 25)])), [L(p1, 75, 0, 25)]);
      ok('fail closed: an exact single-payment deposit + tip answer is accepted', single.calls[1] === 'mark_refund_provider_attempt' && single.res.body.requestedCents === 100);
    }

    // ---- idempotency, conflicts and the operation identity
    {
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }, { bal: 10000 }]);
      const [pa, pb] = c.payIds;
      const key = newKey();
      c.w.stripe.refundBehaviors = ['pending', 'pending'];
      const lines = [L(pa, 7500, 0, 2500), L(pb, 0, 4000, 0)];
      const first = await allocCall(c, key, lines, { amountCents: 14000 });
      const rows0 = await refundRows(c.orderId);
      eq('identity: the first request reserves two rows and asks Stripe twice', [first.status, first.json?.status, rows0.length, creates(c).length], [200, 'pending', 2, 2]);
      const same = await allocCall(c, key, lines, { amountCents: 14000 });
      eq('identity: the identical request resumes the same operation and asks Stripe for nothing more', [same.status, same.json?.existing, creates(c).length, allCreateAttempts(c).length, (await refundRows(c.orderId)).length], [200, true, 2, 2, 2]);
      const rev = await allocCall(c, key, [lines[1], lines[0]]);
      eq('identity: the same lines in another order resume it too (no declared total needed)', [rev.status, rev.json?.existing, allCreateAttempts(c).length], [200, true, 2]);
      const changes: Array<[string, unknown[]]> = [
        ['a changed payment', [L(pa, 7500, 0, 2500), L(nextId(), 0, 4000, 0)]],
        ['a changed deposit amount', [L(pa, 7501, 0, 2500), lines[1]]],
        ['a changed balance amount', [lines[0], L(pb, 0, 3999, 0)]],
        ['a changed tip amount', [L(pa, 7500, 0, 2499), lines[1]]],
        ['a changed total', [L(pa, 7500, 0, 2500), L(pb, 0, 4000, 1)]],
        ['a dropped line', [lines[0]]],
      ];
      for (const [label, alloc] of changes) {
        const r = await allocCall(c, key, alloc);
        ok(`identity: ${label} under the same key is refused (${r.status} ${r.json?.code}${r.json?.detail ? ' ' + r.json.detail : ''})`, r.status === 409 && r.json?.code === 'OPERATION_KEY_REUSED' || (label === 'a changed payment' && r.status >= 400));
      }
      const rowsAfter = await refundRows(c.orderId);
      eq('identity: no conflicting request changed a row, the identity or the provider calls', [JSON.stringify(rowsAfter) === JSON.stringify(rows0), allCreateAttempts(c).length], [true, 2]);
      // an old (amount-only) client resumes an allocated operation only when it is the same refund
      const viaOld = await refundCall(c, { amountCents: 14000, operationKey: key });
      eq('identity: an amount-only request with the same key and total only resumes the same rows (nothing new, no new Stripe request)', [viaOld.status, viaOld.json?.existing, (await refundRows(c.orderId)).length, allCreateAttempts(c).length], [200, true, 2, 2]);
      const viaOldWrong = await refundCall(c, { amountCents: 13999, operationKey: key });
      eq('identity: an amount-only request with another total under that key is a conflict', [viaOldWrong.status, viaOldWrong.json?.code], [409, 'OPERATION_KEY_REUSED']);
      eq('identity: ...and the allocation of the operation was untouched by all of it', JSON.stringify(compsOf(await refundRows(c.orderId))), JSON.stringify(compsOf(rows0)));
    }
    {
      // an operation reserved by the amount-only path before: an allocation can never be attached to it
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }]);
      const key = newKey();
      c.w.stripe.refundBehaviors = ['connection_error_before'];
      const first = await refundCall(c, { amountCents: 3000, operationKey: key });
      eq('legacy operation: an amount-only refund with an unknown outcome stays unresolved', [first.status, first.json?.status], [202, 'unresolved']);
      const rows0 = await refundRows(c.orderId);
      const attach = await allocCall(c, key, [L(c.payIds[0], 3000, 0, 0)], { amountCents: 3000 });
      eq('legacy operation: supplying an allocation for its key is a conflict', [attach.status, attach.json?.code, attach.json?.detail], [409, 'OPERATION_KEY_REUSED', 'amount_only_operation']);
      eq('legacy operation: ...and nothing about it changed (allocation columns stay NULL, no new Stripe request)', [JSON.stringify(await refundRows(c.orderId)) === JSON.stringify(rows0), compsOf(rows0), allCreateAttempts(c).length], [true, [[null, null, null, null, null]], 1]);
      const resume = await refundCall(c, { amountCents: 3000, operationKey: key });
      eq('legacy operation: the amount-only retry still resumes through the same row and the same idempotency key', [resume.status, resume.json?.status, creates(c).length, creates(c)[creates(c).length - 1].key], [200, 'succeeded', 2, `refund:${key}:0`]);
      const nr = await allocCall(c, newKey(), [L(c.payIds[0], 25661, 0, 0)]);
      eq('legacy operation: its settled three thousand cents are unknown composition: a claim beyond what is certainly still there is ambiguous', [nr.status, nr.json?.code], [409, 'REFUND_HISTORY_AMBIGUOUS']);
      const certain = await allocCall(c, newKey(), [L(c.payIds[0], 22661, 0, 0)]);
      eq('legacy operation: ...and what is certainly there (deposit 25661 - the unknown 3000) can be refunded', [certain.status, certain.json?.status], [200, 'succeeded']);
    }

    // ---- unknown outcomes, attempt marker, lookup, expiry, cross-session recovery
    {
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }]);
      const key = newKey();
      c.w.failRpc['mark_refund_provider_attempt'] = { error: retryError, times: 1 };
      const r = await allocCall(c, key, [L(c.payIds[0], 7500, 0, 2500)]);
      const rows = await refundRows(c.orderId);
      eq('marker: when the attempt marker cannot be written nothing is sent to Stripe, and the reservation and allocation are kept', [r.status, r.json?.status, creates(c).length, rows.map((x: any) => x.status), compsOf(rows)], [202, 'unresolved', 0, ['pending'], [[7500, 0, 2500, 0, 1]]]);
      const retry = await allocCall(c, key, [L(c.payIds[0], 7500, 0, 2500)]);
      eq('marker: the retry writes the marker and then sends the one request', [retry.status, retry.json?.status, creates(c).length, creates(c)[0].key], [200, 'succeeded', 1, `refund:${key}:0`]);
    }
    {
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }]);
      const key = newKey();
      c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
      const r = await allocCall(c, key, [L(c.payIds[0], 7500, 0, 2500)]);
      const rows = await refundRows(c.orderId);
      eq('unknown outcome: a response lost after Stripe created the refund leaves the reservation, the marker and the allocation', [r.status, r.json?.status, rows.map((x: any) => [x.status, x.provider_attempted_at !== null, x.provider_idempotency_key]), compsOf(rows)], [202, 'unresolved', [['pending', true, `refund:${key}:0`]], [[7500, 0, 2500, 0, 1]]]);
      // many refunds on the PaymentIntent from elsewhere push ours onto a later listing page
      for (let i = 0; i < 120; i++) c.w.stripe.externalRefund(c.pis[0], 1);
      const retry = await allocCall(c, key, [L(c.payIds[0], 7500, 0, 2500)]);
      eq('recovery: the retry finds the refund Stripe already created, on a later listing page, and creates nothing', [retry.status, retry.json?.status, creates(c).length, c.w.stripe.calls.filter((x) => x.api === 'refunds.list').length >= 2], [200, 'succeeded', 1, true]);
      const done = await refundRows(c.orderId);
      eq('recovery: the row now carries the provider id and still the same allocation; the order total counted it once', [done[0].stripe_refund_id !== null, done.map((x: any) => x.status), compsOf(done), (await orderRow(c.orderId)).total_refunded_cents], [true, ['succeeded'], [[7500, 0, 2500, 0, 1]], 10000]);
    }
    {
      // incomplete lookup outside the replay window never authorises a blind request; a contacted operation never expires
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }]);
      const key = newKey();
      c.w.stripe.refundBehaviors = ['connection_error_before'];
      await allocCall(c, key, [L(c.payIds[0], 7500, 0, 2500)]);
      await pg.exec(`UPDATE public.order_refunds SET created_at = now() - interval '21 hours' WHERE order_id = '${c.orderId}';`);
      c.w.stripe.refundListMode = 'throw';
      const stuck = await allocCall(c, key, [L(c.payIds[0], 7500, 0, 2500)]);
      eq('lookup: an unreadable listing outside the replay window does not authorise a new request', [stuck.status, stuck.json?.status, allCreateAttempts(c).length], [202, 'unresolved', 1]);
      const other = await allocCall(c, newKey(), [L(c.payIds[0], 100, 0, 0)]);
      eq('expiry: a contacted operation is not released by age; a new request still has to resume it', [other.status, other.json?.code, other.json?.resumeOperationKey], [409, 'UNSETTLED_REFUND_EXISTS', key]);
      eq('expiry: ...the row is still pending with its marker', (await refundRows(c.orderId)).map((x: any) => [x.status, x.provider_attempted_at !== null]), [['pending', true]]);
      c.w.stripe.refundListMode = 'normal';
      // another session (a freshly loaded function) resumes with the same key and the same lines
      const session2 = await callHandler(loadHandler('stripe-refund', c.w, shared), { orderId: c.orderId, reason: 'x', operationKey: key, allocations: [L(c.payIds[0], 7500, 0, 2500)] }, 'jwt-master');
      eq('cross-session: another staff session resumes it with the same key, creating no second refund row', [session2.status, session2.json?.status, (await refundRows(c.orderId)).length, c.w.stripe.refundCreatedCount], [200, 'succeeded', 1, 1]);
    }

    // ---- partial results across two payments
    {
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }, { bal: 10000 }]);
      const key = newKey();
      const [pa, pb] = sortedIds(c);
      const lineFor = (id: string) => (id === c.payIds[0] ? L(id, 7500, 0, 2500) : L(id, 0, 4000, 0));
      const lines = [lineFor(pa), lineFor(pb)];
      c.w.stripe.refundBehaviors = ['succeed', 'pending'];
      const before = await opFields(c.orderId);
      const r = await allocCall(c, key, lines, { amountCents: 14000 });
      const total = lines.reduce((a, l) => a + l.depositPrincipalCents + l.balancePrincipalCents + l.tipCents, 0);
      eq('partial: one line succeeds and one stays pending: the operation is not final and says so', [r.status, r.json?.status, r.json?.final, r.json?.succeededCents, r.json?.pendingCents, r.json?.requestedCents], [200, 'pending', false, creates(c)[0].params.amount, creates(c)[1].params.amount, total]);
      const rows = await refundRows(c.orderId);
      eq('partial: the first payment\'s refund is recorded once; the second is reserved but not counted as returned', [rows.map((x: any) => x.status), (await orderRow(c.orderId)).total_refunded_cents, (await negativePayments(c.orderId)).length], [['succeeded', 'pending'], creates(c)[0].params.amount, 1]);
      const n1 = netOf(c.orderId);
      eq('partial: net figures reduce only for the succeeded line; the pending line is reserved', [n1.pending_refund_reservations_cents, n1.total_succeeded_refunds_cents], [creates(c)[1].params.amount, creates(c)[0].params.amount]);
      const retry = await allocCall(c, key, lines);
      eq('partial: retrying never repeats the successful line; the pending line is only looked at', [retry.status, retry.json?.status, creates(c).length, c.w.stripe.refundCreatedCount], [200, 'pending', 2, 2]);
      // the pending one settles by webhook, twice
      const second = Object.keys(c.w.stripe.refunds_)[1];
      c.w.stripe.setRefundStatus(second, 'succeeded');
      const w1 = wh(c);
      await w1.h.handleRefundEvent(refundEvent(c, second), w1.client);
      await w1.h.handleRefundEvent(refundEvent(c, second), w1.client);
      const n2 = netOf(c.orderId);
      eq('partial: both settled once: totals, one negative copy per refund, no double subtraction', [(await orderRow(c.orderId)).total_refunded_cents, (await negativePayments(c.orderId)).length, n2.total_succeeded_refunds_cents, n2.refund_copy_cents, n2.unbacked_refund_copy_cents, n2.missing_refund_copy_cents, n2.refund_copies_match_ledger], [total, 2, total, total, 0, 0, true]);
      eq('partial: net principal and tips follow the allocation exactly (deposit 25661-7500, balance 10000-4000, tips 5132-2500)', [n2.known_net_deposit_principal_cents, n2.known_net_balance_principal_cents, n2.known_net_tips_cents, n2.classification_complete, n2.recorded_net_cash_retained_cents], [18161, 6000, 2632, true, 26793]);
      eq('partial: the operational columns never moved', await opFields(c.orderId), before);
      eq('partial: the allocation is immutable through settlement', compsOf(await refundRows(c.orderId)), compsOf(rows));
      // a failure after success reverses by the existing rules; the allocation stays
      c.w.stripe.setRefundStatus(second, 'failed', 'declined');
      await w1.h.handleRefundEvent(refundEvent(c, second), w1.client);
      const n3 = netOf(c.orderId);
      eq('partial: a later failure of a succeeded line reverses only that line (existing reversal rules); the other is unchanged', [(await orderRow(c.orderId)).total_refunded_cents, n3.known_net_balance_principal_cents, n3.known_net_deposit_principal_cents, n3.known_net_tips_cents], [creates(c)[0].params.amount, 10000, 18161, 2632]);
      eq('partial: ...the allocation is still the one reserved', compsOf(await refundRows(c.orderId)), compsOf(rows));
    }
    {
      // one succeeds, one is rejected: partial (207); the rejected line releases its capacity; the successful one is not repeated
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }, { bal: 10000 }]);
      const key = newKey();
      const ord = sortedIds(c);
      const lineFor = (id: string) => (id === c.payIds[0] ? L(id, 7500, 0, 2500) : L(id, 0, 4000, 0));
      c.w.stripe.refundBehaviors = ['succeed', 'invalid_request'];
      const r = await allocCall(c, key, [lineFor(ord[0]), lineFor(ord[1])]);
      eq('partial failure: 207 with the successful and the rejected portion stated separately', [r.status, r.json?.status, r.json?.final, r.json?.succeededCents, r.json?.failedCents], [207, 'partial', true, creates(c)[0].params.amount, creates(c)[1].params.amount]);
      const retry = await allocCall(c, key, [lineFor(ord[0]), lineFor(ord[1])]);
      eq('partial failure: a retry neither repeats the success nor re-sends the rejected line', [retry.status, allCreateAttempts(c).length], [207, 2]);
      const again = await allocCall(c, newKey(), [lineFor(ord[1])]);
      eq('partial failure: the rejected line\'s capacity is free for a new request', [again.status, again.json?.status], [200, 'succeeded']);
    }

    {
      // every portion rejected: the whole request failed (422), nothing is counted, and the capacity is free again
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }]);
      c.w.stripe.refundBehaviors = ['invalid_request'];
      const r = await allocCall(c, newKey(), [L(c.payIds[0], 7500, 0, 2500)]);
      eq('rejected: a request Stripe rejects entirely is a failure (422) with nothing counted', [r.status, r.json?.code, r.json?.failedCents, r.json?.requestedCents, (await orderRow(c.orderId)).total_refunded_cents], [422, 'REFUND_FAILED', 10000, 10000, 0]);
      const again = await allocCall(c, newKey(), [L(c.payIds[0], 7500, 0, 2500)]);
      eq('rejected: ...and the same components can be requested again', [again.status, again.json?.status], [200, 'succeeded']);
    }

    // ---- security
    {
      const c = await newAllocCase([{ dep: 25661, tip: 5132 }]);
      const line = (suffix: number) => [L(c.payIds[0], suffix, 0, 0)];
      eq('security: Admin is allowed', (await allocCall(c, newKey(), line(100), {}, 'jwt-admin')).status, 200);
      eq('security: Master is allowed', (await allocCall(c, newKey(), line(100), {}, 'jwt-master')).status, 200);
      eq('security: Crew is denied', (await allocCall(c, newKey(), line(100), {}, 'jwt-crew')).status, 403);
      eq('security: a customer is denied', (await allocCall(c, newKey(), line(100), {}, 'jwt-cust')).status, 403);
      eq('security: an anonymous caller is denied', (await allocCall(c, newKey(), line(100), {}, null)).status, 401);
      eq('security: denied callers reserved nothing and contacted nobody (only the two allowed requests exist)', [(await refundRows(c.orderId)).length, creates(c).length], [2, 2]);
      const r = await allocCall(c, newKey(), line(100), { actorId: CUST, refunded_by: CUST, actor: CUST, p_actor: CUST }, 'jwt-admin');
      const last = (await refundRows(c.orderId)).slice(-1)[0];
      eq('security: an actor named in the request body is ignored; the verified caller is recorded and sent to Stripe', [r.status, last.refunded_by, creates(c).slice(-1)[0].params.metadata.refunded_by], [200, ADMIN, ADMIN]);
      ok('security: no response carries the service credentials', !JSON.stringify(r.json).includes(SERVICE_KEY));
      const read = (f: string) => require('fs').readFileSync(f, 'utf8');
      const src = read('supabase/functions/stripe-refund/index.ts');
      ok('security: the function reads the service key only on the server and never echoes it', !/SUPABASE_SERVICE_ROLE_KEY[^)]*\)[^;]*respond/.test(src) && !/respond\([^)]*SERVICE_ROLE/.test(src));
    }

    // ---- existing behaviour is intact
    {
      const c = await newAllocCase([{ dep: 25661, bal: 0, tip: 5132 }]);
      const before = await opFields(c.orderId);
      const key = newKey();
      const r = await allocCall(c, key, [L(c.payIds[0], 7500, 0, 2500)], { amountCents: 10000 });
      const done = await refundRows(c.orderId);
      const n = netOf(c.orderId);
      eq('end to end: the policy example (deposit 75.00 + tip 25.00 of a 307.93 payment) leaves net deposit 181.61, net tip 26.32, net recorded 207.93', [r.status, n.known_net_deposit_principal_cents, n.known_net_tips_cents, n.recorded_net_cash_retained_cents, n.classification_complete], [200, 18161, 2632, 20793, true]);
      eq('end to end: no charge or payment of any kind was created', [c.w.stripe.calls.filter((x) => /paymentIntents\.create|checkout\.sessions\.create|charges\.create/.test(x.api)).length, Number((await pg.query(`SELECT count(*) AS n FROM public.payments WHERE order_id = '${c.orderId}' AND amount_cents > 0`))[0].n)], [0, 1]);
      eq('end to end: the operational deposit / balance / tip / status fields are exactly as before', await opFields(c.orderId), before);
      eq('end to end: the row is a ledger-version-2 row with its allocation intact', [done.map((x: any) => x.ledger_version), compsOf(done)], [[2], [[7500, 0, 2500, 0, 1]]]);
    }
  }

  // =================================================================================================================
  // 14. The shared Admin refund screen driven end to end: its controller, the REAL refund function, and the REAL database overview
  // =================================================================================================================
  {
    const { spawnSync } = require('child_process');
    const NLC = String.fromCharCode(10);
    const overviewFor = (orderId: string): any => {
      const script = `BEGIN;${NLC}GRANT SELECT ON public.payments, public.order_refunds, public.orders TO service_role;${NLC}SET LOCAL ROLE service_role;${NLC}SELECT 'R|' || COALESCE(public.order_refund_overview('${orderId}')::text, 'NULL');${NLC}ROLLBACK;`;
      const pr = spawnSync(db.psql, [...psqlArgs(db.db)], { input: script, encoding: 'utf8' });
      const line = String(pr.stdout ?? '').split(NLC).find((l: string) => l.startsWith('R|'));
      try { return JSON.parse((line ?? '').slice(2).trim()); } catch { return null; }
    };
    const netNow = (orderId: string): any => {
      const script = `BEGIN;${NLC}GRANT SELECT ON public.payments, public.order_refunds, public.orders TO service_role;${NLC}SET LOCAL ROLE service_role;${NLC}SELECT 'R|' || public.order_net_financials('${orderId}')::text;${NLC}ROLLBACK;`;
      const pr = spawnSync(db.psql, [...psqlArgs(db.db)], { input: script, encoding: 'utf8' });
      const line = String(pr.stdout ?? '').split(NLC).find((l: string) => l.startsWith('R|'));
      try { return JSON.parse((line ?? '').slice(2).trim()); } catch { return null; }
    };
    async function mkCase(parts: Array<{ dep?: number; bal?: number; tip?: number }>): Promise<Case> {
      const w = makeWorld(pg);
      w.users = { 'jwt-admin': ADMIN, 'jwt-master': MASTER, 'jwt-crew': CREW, 'jwt-cust': CUST };
      w.tables.user_roles = [{ user_id: MASTER, role: 'master' }, { user_id: ADMIN, role: 'admin' }, { user_id: CREW, role: 'crew' }, { user_id: CUST, role: 'customer' }];
      const orderId = nextId();
      createdOrders.push(orderId);
      await pg.exec(`INSERT INTO public.orders (id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents, deposit_paid_cents, balance_paid_cents, tip_cents, stripe_payment_status) VALUES ('${orderId}', 'confirmed', 'residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 'next_day', 60000, 25661, 34339, 25661, 0, 5132, 'paid');`);
      const pis: string[] = [];
      const payIds: string[] = [];
      for (const part of parts) {
        const dep = part.dep ?? 0, bal = part.bal ?? 0, tip = part.tip ?? 0;
        const pi = w.stripe.addSucceededPaymentIntent(dep + bal + tip);
        const id = nextId();
        pis.push(pi.id); payIds.push(id);
        await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, stripe_payment_intent_id, paid_at, payment_method, payment_brand, payment_last4, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, order_financials_applied) VALUES ('${id}', '${orderId}', '${dep > 0 ? 'deposit' : 'balance'}', ${dep + bal + tip}, 'succeeded', '${pi.id}', now(), 'card', 'visa', '4242', ${dep + bal}, ${tip}, ${dep}, ${bal}, true);`);
      }
      return { w, orderId, pis, payIds };
    }
    // The screen's two server calls, wired to the real refund function and the real overview. 'lose' performs the request and then
    // drops the answer (a timeout after the server did its work); 'notjson' performs it and returns a body that is not JSON.
    const apiFor = (c: Case, bearer: string | null = 'jwt-admin', mode: { v: 'normal' | 'lose' | 'notjson' } = { v: 'normal' }): RefundApi => ({
      loadOverview: async (id: string) => { const o = overviewFor(id); if (!o) throw new Error('You do not have access to this order.'); return o; },
      submit: async (body: any) => {
        const r = await callHandler(loadHandler('stripe-refund', c.w, shared), body, bearer);
        if (mode.v === 'lose') throw new Error('network timeout');
        if (mode.v === 'notjson') return { status: 200, data: null };
        return { status: r.status, data: r.json };
      },
    });
    const compsOf = (rows: any[]) => rows.map((x: any) => [x.deposit_principal_refunded_cents, x.balance_principal_refunded_cents, x.tip_refunded_cents, x.unclassified_refunded_cents, x.allocation_version]);
    const fillIn = (ctl: RefundController, id: string, d: string, b: string, t: string) => { ctl.setInput(id, 'deposit', d); ctl.setInput(id, 'balance', b); ctl.setInput(id, 'tip', t); };
    const OP = ['deposit_due_cents', 'deposit_paid_cents', 'balance_due_cents', 'balance_paid_cents', 'tip_cents', 'stripe_payment_status', 'status'];
    const opNow = async (id: string) => { const o = await orderRow(id); return OP.map((k) => o[k]); };
    const paymentsCreated = async (id: string) => Number((await pg.query(`SELECT count(*) AS n FROM public.payments WHERE order_id = '${id}' AND amount_cents > 0`))[0].n);

    {
      // the policy example, through the screen
      const c = await mkCase([{ dep: 25661, tip: 5132 }]);
      const before = await opNow(c.orderId);
      const ctl = new RefundController(apiFor(c), c.orderId);
      await ctl.load();
      const p = ctl.state.overview!.payments[0];
      eq('screen e2e: the database overview shows the payment split and full availability', [p.deposit_cents, p.balance_cents, p.tip_cents, p.available.deposit_cents, p.available.tip_cents, p.remaining_total_cents, p.refundable, p.classified], [25661, 0, 5132, 25661, 5132, 30793, true, true]);
      eq('screen e2e: opening the screen made no Stripe call and no refund row', [c.w.stripe.calls.length, (await refundRows(c.orderId)).length], [0, 0]);
      fillIn(ctl, p.id, '75.00', '', '25.00');
      await ctl.review();
      eq('screen e2e: review shows 100.00 = 75.00 deposit + 25.00 tip, and still nothing was sent', [ctl.state.phase, ctl.state.review?.totalCents, ctl.state.review?.depositCents, ctl.state.review?.tipCents, c.w.stripe.calls.length], ['review', 10000, 7500, 2500, 0]);
      const sendsBefore = ctl.sentCount;
      await Promise.all([ctl.confirm(), ctl.confirm()]);
      eq('screen e2e: a double click on Confirm made exactly one request and one Stripe refund', [ctl.sentCount - sendsBefore, creates(c).length, creates(c)[0]?.params.amount, creates(c)[0]?.params.payment_intent === c.pis[0]], [1, 1, 10000, true]);
      eq('screen e2e: the result is a success and the form is open again', [ctl.state.result?.kind, ctl.state.phase], ['succeeded', 'ready']);
      const after = ctl.state.overview!.payments[0];
      eq('screen e2e: the overview now shows 100.00 refunded (75.00 deposit, 25.00 tip) and the remaining availability', [after.refunded.deposit_cents, after.refunded.tip_cents, after.pending.deposit_cents, after.available.deposit_cents, after.available.tip_cents], [7500, 2500, 0, 18161, 2632]);
      const n = netNow(c.orderId);
      eq('screen e2e: net deposit 181.61, net tip 26.32, net recorded 207.93, exact', [n.known_net_deposit_principal_cents, n.known_net_tips_cents, n.recorded_net_cash_retained_cents, n.classification_complete], [18161, 2632, 20793, true]);
      eq('screen e2e: the operational fields did not move and no payment was created', [await opNow(c.orderId), await paymentsCreated(c.orderId)], [before, 1]);
      const hist = ctl.state.overview!.refunds;
      eq('screen e2e: the history lists the refund with its split and status', [hist.length, hist[0].status, hist[0].deposit_cents, hist[0].tip_cents, hist[0].allocation_version], [1, 'succeeded', 7500, 2500, 1]);
      // a webhook delivered twice changes nothing on screen
      const w = wh(c);
      const id = Object.keys(c.w.stripe.refunds_)[0];
      await w.h.handleRefundEvent(refundEvent(c, id), w.client);
      await w.h.handleRefundEvent(refundEvent(c, id), w.client);
      await ctl.load();
      eq('screen e2e: duplicate webhook deliveries leave one refund, one copy, the same totals', [ctl.state.overview!.refunds.length, (await negativePayments(c.orderId)).length, (await orderRow(c.orderId)).total_refunded_cents], [1, 1, 10000]);
    }
    {
      // two payments, one operation
      const c = await mkCase([{ dep: 25661, tip: 5132 }, { bal: 10000 }]);
      const ctl = new RefundController(apiFor(c), c.orderId);
      await ctl.load();
      const [pa, pb] = ctl.state.overview!.payments;
      fillIn(ctl, pa.id, '75.00', '', '25.00'); ctl.setInput(pb.id, 'balance', '40.00');
      await ctl.review();
      await ctl.confirm();
      eq('screen e2e (two payments): 140.00 refunded as two Stripe refunds, each on its own payment', [ctl.state.result?.kind, ctl.state.result?.requestedCents, [...creates(c).map((x) => [x.params.payment_intent, x.params.amount])].sort()], ['succeeded', 14000, [[c.pis[0], 10000], [c.pis[1], 4000]].sort()]);
      const n = netNow(c.orderId);
      eq('screen e2e (two payments): net figures follow the allocation', [n.known_net_deposit_principal_cents, n.known_net_balance_principal_cents, n.known_net_tips_cents], [18161, 6000, 2632]);
      // a payment cannot give what it does not have
      fillIn(ctl, pb.id, '', '', '1.00');
      eq('screen e2e (two payments): the payment with no tip offers no tip entry', ctl.built()?.fieldErrors[`${pb.id}.tip`] !== undefined || ctl.built()?.totalCents === 0, true);
    }
    {
      // pending reduces availability and is not returned money; the webhook completes it
      const c = await mkCase([{ dep: 25661, tip: 5132 }]);
      c.w.stripe.refundBehaviors = ['pending'];
      const ctl = new RefundController(apiFor(c), c.orderId);
      await ctl.load();
      const p = ctl.state.overview!.payments[0];
      fillIn(ctl, p.id, '75.00', '', '25.00');
      await ctl.review();
      await ctl.confirm();
      const pend = ctl.state.overview!.payments[0];
      eq('screen e2e (pending): Stripe accepted it but has not finished: reported as pending, availability falls, nothing is shown as returned', [ctl.state.result?.kind, pend.pending.deposit_cents, pend.pending.tip_cents, pend.refunded.deposit_cents, pend.available.deposit_cents, netNow(c.orderId).recorded_net_cash_retained_cents], ['pending', 7500, 2500, 0, 18161, 30793]);
      eq('screen e2e (pending): the screen now offers only to resume it (a new refund cannot be started)', [ctl.state.phase, ctl.state.recoveries[0]?.kind, ctl.state.recoveries[0]?.progress?.pendingCents], ['recovery', 'allocated', 10000]);
      const id = Object.keys(c.w.stripe.refunds_)[0];
      c.w.stripe.setRefundStatus(id, 'succeeded');
      const w = wh(c);
      await w.h.handleRefundEvent(refundEvent(c, id), w.client);
      await ctl.load();
      eq('screen e2e (pending): after the webhook it is refunded and the form is open again', [ctl.state.phase, ctl.state.overview!.payments[0].refunded.deposit_cents, ctl.state.overview!.payments[0].pending.deposit_cents], ['ready', 7500, 0]);
    }
    {
      // a rejected refund releases availability and may be asked again as a NEW request
      const c = await mkCase([{ dep: 25661, tip: 5132 }]);
      c.w.stripe.refundBehaviors = ['invalid_request'];
      const ctl = new RefundController(apiFor(c), c.orderId);
      await ctl.load();
      const p = ctl.state.overview!.payments[0];
      fillIn(ctl, p.id, '75.00', '', '25.00');
      await ctl.review();
      await ctl.confirm();
      eq('screen e2e (failed): a rejected refund is a failure, nothing counted, availability restored, nothing frozen', [ctl.state.result?.kind, ctl.state.phase, ctl.state.frozen, ctl.state.overview!.payments[0].available.deposit_cents, (await orderRow(c.orderId)).total_refunded_cents], ['failed', 'ready', null, 25661, 0]);
      const key1 = (await refundRows(c.orderId))[0].operation_key;
      fillIn(ctl, p.id, '75.00', '', '25.00');
      await ctl.review();
      await ctl.confirm();
      const keys = new Set((await refundRows(c.orderId)).map((x: any) => x.operation_key));
      eq('screen e2e (failed): the next attempt is a genuinely new request under a new key and succeeds', [ctl.state.result?.kind, keys.size, keys.has(key1)], ['succeeded', 2, true]);
    }
    {
      // earlier refunds with no breakdown, and a payment with no recorded split
      const c = await mkCase([{ dep: 10000, tip: 2000 }]);
      const old = await refundCall(c, { amountCents: 5000, operationKey: newKey() });
      eq('screen e2e (history): an earlier amount-only refund succeeded', old.json?.status, 'succeeded');
      const ctl = new RefundController(apiFor(c), c.orderId);
      await ctl.load();
      const p = ctl.state.overview!.payments[0];
      eq('screen e2e (history): it is shown as a refund with no breakdown, and only what is certainly left is available', [p.has_unclassified_history, p.available.deposit_cents, p.available.tip_cents, ctl.state.overview!.refunds[0].allocation_version], [true, 5000, 0, null]);
      fillIn(ctl, p.id, '50.01', '', '');
      await ctl.review();
      eq('screen e2e (history): an entry beyond that is refused on screen and nothing is sent', [ctl.state.phase, ctl.state.fieldErrors[`${p.id}.deposit`]], ['ready', 'More than the $50.00 available.']);
      const un = await mkCase([{ dep: 100 }]);
      await pg.exec(`UPDATE public.payments SET principal_amount_cents = NULL, tip_amount_cents = NULL, deposit_principal_cents = NULL, balance_principal_cents = NULL WHERE order_id = '${un.orderId}';`);
      const ctl2 = new RefundController(apiFor(un), un.orderId);
      await ctl2.load();
      eq('screen e2e (history): a payment with no recorded split is listed as unavailable for component refunds', [ctl2.state.overview!.payments[0].reason_unavailable, ctl2.state.overview!.payments[0].available.deposit_cents], ['unclassified', 0]);
      const none = new RefundController(apiFor(await mkCase([])), (await mkCase([])).orderId);
      void none;
    }
    {
      // reload during an unresolved refund, another Admin, and a lost answer
      for (const mode of ['lose', 'notjson'] as const) {
        const c = await mkCase([{ dep: 25661, tip: 5132 }]);
        const m = { v: mode } as { v: 'normal' | 'lose' | 'notjson' };
        c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
        const ctlA = new RefundController(apiFor(c, 'jwt-admin', m), c.orderId);
        await ctlA.load();
        const p = ctlA.state.overview!.payments[0];
        fillIn(ctlA, p.id, '75.00', '', '25.00');
        await ctlA.review();
        await ctlA.confirm();
        const row0 = (await refundRows(c.orderId))[0];
        eq('screen e2e (' + mode + '): the server did the work but the answer was lost: the screen goes to "refund in progress" with the request frozen, and no second request was made', [ctlA.state.phase, ctlA.state.frozen?.attempt.key === row0.operation_key, creates(c).length, ctlA.sentCount], ['recovery', true, 1, 1]);
        // reload: a new screen instance finds it in the database
        m.v = 'normal';
        const ctlB = new RefundController(apiFor(c, 'jwt-admin', m), c.orderId);
        await ctlB.load();
        const rec = ctlB.state.recoveries[0];
        eq('screen e2e (' + mode + '): after a reload the refund is found in the database with its original allocation, and a new refund cannot be started', [ctlB.state.phase, rec.source, rec.kind, rec.lines.map((l) => [l.depositCents, l.balanceCents, l.tipCents]), ctlB.sentCount], ['recovery', 'stored', 'allocated', [[7500, 0, 2500]], 0]);
        fillIn(ctlB, p.id, '1.00', '', '');
        await ctlB.review();
        eq('screen e2e (' + mode + '): ...nothing can be entered or sent meanwhile', [ctlB.state.inputs, creates(c).length], [{}, 1]);
        // a DIFFERENT Admin session resumes it
        const ctlC = new RefundController(apiFor(c, 'jwt-master', m), c.orderId);
        await ctlC.load();
        await ctlC.resume(row0.operation_key);
        const rows = await refundRows(c.orderId);
        eq('screen e2e (' + mode + '): another Admin resumes it under the SAME key and allocation: the existing Stripe refund is found, none is created, and it ends succeeded', [ctlC.state.result?.kind, rows.length, rows[0].operation_key === row0.operation_key, creates(c).length, c.w.stripe.refundCreatedCount, rows[0].status, compsOf(rows)], ['succeeded', 1, true, 1, 1, 'succeeded', [[7500, 0, 2500, 0, 1]]]);
        eq('screen e2e (' + mode + '): the form is open again and the refund is counted once', [ctlC.state.phase, (await orderRow(c.orderId)).total_refunded_cents, (await negativePayments(c.orderId)).length], ['ready', 10000, 1]);
      }
    }
    {
      // the server finished everything but the answer was lost: after the refresh the database says it is finished
      const c0 = await mkCase([{ dep: 25661, tip: 5132 }]);
      const ctl0 = new RefundController(apiFor(c0, 'jwt-admin', { v: 'lose' }), c0.orderId);
      await ctl0.load();
      fillIn(ctl0, ctl0.state.overview!.payments[0].id, '10.00', '', '');
      await ctl0.review();
      await ctl0.confirm();
      eq('screen e2e (answer lost after a complete success): the database shows it finished, so the screen is open again, tells the Admin, and does not offer a second refund', [ctl0.state.phase, ctl0.state.frozen, /has finished/.test(ctl0.state.notice ?? ''), creates(c0).length, (await orderRow(c0.orderId)).total_refunded_cents], ['ready', null, true, 1, 1000]);
    }
    {
      // CROSS-ADMIN RECOVERY. Admin A's request reaches Stripe and its answer is lost; Admin B (another person, another session) resumes it
      // with the original key, allocation and total. The fake Stripe compares the WHOLE request (amount, reason and metadata) against the
      // first request made under an idempotency key, as Stripe does, so these runs prove what the real recovery path sends.
      const probe = await mkCase([{ dep: 100 }]);
      const sp = probe.w.stripe;
      await sp.refunds.create({ payment_intent: probe.pis[0], amount: 50, reason: 'requested_by_customer', metadata: { bpc_refund_id: 'r1', refunded_by: 'A' } }, { idempotencyKey: 'probe-key-1' });
      let probeErr: any = null;
      try { await sp.refunds.create({ payment_intent: probe.pis[0], amount: 50, reason: 'requested_by_customer', metadata: { bpc_refund_id: 'r1', refunded_by: 'B' } }, { idempotencyKey: 'probe-key-1' }); } catch (e: any) { probeErr = e; }
      eq('cross-admin: the fake provider rejects a replay whose metadata differs (so the runs below are a real test of the request that is sent)', [probeErr?.type, sp.refundCreatedCount], ['StripeIdempotencyError', 1]);

      const start = async (listing: 'normal' | 'throw') => {
        const c = await mkCase([{ dep: 25661, tip: 5132 }]);
        c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
        const a = new RefundController(apiFor(c, 'jwt-admin', { v: 'lose' }), c.orderId);
        await a.load();
        const pid = a.state.overview!.payments[0].id;
        fillIn(a, pid, '75.00', '', '25.00');
        await a.review();
        await a.confirm();
        const row = (await refundRows(c.orderId))[0];
        c.w.stripe.refundListMode = listing;
        return { c, a, row, pid };
      };

      {
        const { c, row } = await start('normal');
        const first = creates(c)[0];
        eq('cross-admin: Admin A\'s attempt reached Stripe once, with the marker on record and A named in the metadata; the answer was lost', [creates(c).length, row.provider_attempted_at !== null, row.status, first.params.metadata.refunded_by, row.refunded_by], [1, true, 'pending', ADMIN, ADMIN]);
        const b = new RefundController(apiFor(c, 'jwt-master'), c.orderId);
        await b.load();
        const rec = b.state.recoveries[0];
        eq('cross-admin: Admin B opening the order sees the existing operation with its original allocation and total', [b.state.phase, rec.source, rec.operationKey === row.operation_key, rec.lines.map((l) => [l.depositCents, l.balanceCents, l.tipCents]), rec.totalCents], ['recovery', 'stored', true, [[7500, 0, 2500]], 10000]);
        await b.resume(rec.operationKey);
        const rows = await refundRows(c.orderId);
        eq('cross-admin: B resumes with the original key, allocation and total; Stripe\'s existing refund is FOUND, so no second request of any kind is made', [b.state.result?.kind, allCreateAttempts(c).length, c.w.stripe.refundCreatedCount, rows.length, rows[0].status], ['succeeded', 1, 1, 1, 'succeeded']);
        eq('cross-admin: the refund is recorded exactly once: one total, one negative copy, the same provider id', [(await orderRow(c.orderId)).total_refunded_cents, (await negativePayments(c.orderId)).length, rows[0].stripe_refund_id === Object.keys(c.w.stripe.refunds_)[0]], [10000, 1, true]);
        eq('cross-admin: the original initiator stays on record and the allocation and idempotency key are unchanged', [rows[0].refunded_by, rows[0].provider_idempotency_key === row.provider_idempotency_key, compsOf(rows)], [ADMIN, true, [[7500, 0, 2500, 0, 1]]]);
        eq('cross-admin: B\'s own authority was checked (a Crew member cannot resume the same operation)', (await callHandler(loadHandler('stripe-refund', c.w, shared), { orderId: c.orderId, operationKey: row.operation_key, reason: row.reason, amountCents: 10000, allocations: [{ paymentId: row.payment_id, depositPrincipalCents: 7500, balancePrincipalCents: 0, tipCents: 2500 }] }, 'jwt-crew')).status, 403);
      }
      {
        // Stripe cannot be listed when B resumes: the recovery has to fall back to the idempotent re-send, whose parameters differ by the actor
        const { c, row } = await start('throw');
        const b = new RefundController(apiFor(c, 'jwt-master'), c.orderId);
        await b.load();
        await b.resume(b.state.recoveries[0].operationKey);
        const attempts = allCreateAttempts(c);
        const rows = await refundRows(c.orderId);
        eq('cross-admin (listing down): B\'s re-send carries B as the actor, so the provider refuses the changed request; that is an UNKNOWN outcome, not a failure', [attempts.length, attempts[0].params.metadata.refunded_by, attempts[1]?.params.metadata.refunded_by, attempts[1]?.key === attempts[0].key], [2, ADMIN, MASTER, true]);
        eq('cross-admin (listing down): the operation stays unresolved: reservation kept, no duplicate refund, nothing counted twice, no new idempotency key', [b.state.result?.kind, b.state.phase, rows[0].status, rows[0].stripe_refund_id, c.w.stripe.refundCreatedCount, (await orderRow(c.orderId)).total_refunded_cents, rows[0].provider_idempotency_key === row.provider_idempotency_key], ['unresolved', 'recovery', 'pending', null, 1, 0, true]);
        eq('cross-admin (listing down): the capacity stays reserved while it is unresolved', b.state.overview!.payments[0].pending.deposit_cents + b.state.overview!.payments[0].pending.tip_cents, 10000);
        c.w.stripe.refundListMode = 'normal';
        await b.resume(b.state.recoveries[0].operationKey);
        const done = await refundRows(c.orderId);
        eq('cross-admin (listing down): once the provider can be read again, the same resume finds the existing refund and settles it exactly once', [b.state.result?.kind, c.w.stripe.refundCreatedCount, allCreateAttempts(c).length, done[0].status, (await orderRow(c.orderId)).total_refunded_cents, (await negativePayments(c.orderId)).length], ['succeeded', 1, 2, 'succeeded', 10000, 1]);
      }
      {
        // the same Admin resuming gets an identical request, which Stripe simply replays
        const { c } = await start('throw');
        const a2 = new RefundController(apiFor(c, 'jwt-admin'), c.orderId);
        await a2.load();
        await a2.resume(a2.state.recoveries[0].operationKey);
        eq('cross-admin (same Admin, listing down): the re-send is identical, Stripe replays the original, and the refund is recorded once with no second refund', [a2.state.result?.kind, c.w.stripe.refundCreatedCount, (await orderRow(c.orderId)).total_refunded_cents, c.w.stripe.calls.filter((x) => x.api === 'refunds.create(replay)').length], ['succeeded', 1, 10000, 1]);
      }
    }
    {
      // an earlier amount-only refund with an unknown result stays recoverable the old way
      const c = await mkCase([{ dep: 25661, tip: 5132 }]);
      c.w.stripe.refundBehaviors = ['succeed_then_connection_error'];
      const key = newKey();
      const first = await refundCall(c, { amountCents: 3000, operationKey: key });
      eq('screen e2e (legacy): an amount-only refund with a lost answer is unresolved', first.status, 202);
      const ctl = new RefundController(apiFor(c), c.orderId);
      await ctl.load();
      const rec = ctl.state.recoveries[0];
      eq('screen e2e (legacy): the screen offers to resume it as an amount-only refund (no allocation is invented)', [ctl.state.phase, rec.kind, rec.canResume, rec.totalCents, rec.lines.length], ['recovery', 'amount_only', true, 3000, 0]);
      await ctl.resume(key);
      const rows = await refundRows(c.orderId);
      eq('screen e2e (legacy): it settles through the old path: same key, same row, no allocation, one Stripe refund', [ctl.state.result?.kind, rows.length, rows[0].operation_key === key, compsOf(rows), c.w.stripe.refundCreatedCount], ['succeeded', 1, true, [[null, null, null, null, null]], 1]);
    }
    {
      // data that does not add up: nothing can be sent
      const c = await mkCase([{ dep: 25661, tip: 5132 }]);
      c.w.stripe.refundBehaviors = ['connection_error_before'];
      const ctl0 = new RefundController(apiFor(c), c.orderId);
      await ctl0.load();
      const p = ctl0.state.overview!.payments[0];
      fillIn(ctl0, p.id, '75.00', '', '25.00');
      await ctl0.review();
      await ctl0.confirm();
      await pg.exec(`UPDATE public.order_refunds SET request_allocation = 'v1|total=1|tampered' WHERE order_id = '${c.orderId}';`);
      const ctl = new RefundController(apiFor(c), c.orderId);
      await ctl.load();
      const before = allCreateAttempts(c).length;
      await ctl.resume(ctl.state.recoveries[0].operationKey);
      eq('screen e2e (incomplete data): a stored refund whose identity no longer matches is for manual review and nothing is sent', [ctl.state.recoveries[0].kind, ctl.state.recoveries[0].canResume, ctl.sentCount, allCreateAttempts(c).length - before], ['manual_review', false, 0, 0]);
    }
    {
      // availability changes between the entry and the review: the Admin must look again, nothing is reduced for them
      const c = await mkCase([{ dep: 10000, tip: 2000 }]);
      const ctl = new RefundController(apiFor(c), c.orderId);
      await ctl.load();
      const p = ctl.state.overview!.payments[0];
      fillIn(ctl, p.id, '80.00', '', '');
      const other = new RefundController(apiFor(c, 'jwt-master'), c.orderId);
      await other.load();
      fillIn(other, p.id, '50.00', '', '');
      await other.review();
      await other.confirm();
      await ctl.review();
      eq('screen e2e (changed): another refund was made meanwhile: this screen shows the change, keeps the entry, and sends nothing', [ctl.state.phase, ctl.state.notice, ctl.state.inputs[p.id].deposit, ctl.sentCount], ['ready', 'The amounts available to refund have changed. Please review them before continuing.', '80.00', 0]);
      await ctl.review();
      eq('screen e2e (changed): on the next review the entry is checked against the new availability and refused', ctl.state.fieldErrors[`${p.id}.deposit`], 'More than the $50.00 available.');
    }
    {
      // who may refund
      const c = await mkCase([{ dep: 25661, tip: 5132 }]);
      const run = async (bearer: string | null) => {
        const ctl = new RefundController(apiFor(c, bearer), c.orderId);
        await ctl.load();
        const p = ctl.state.overview!.payments[0];
        fillIn(ctl, p.id, '1.00', '', '');
        await ctl.review();
        await ctl.confirm();
        return ctl.state.result?.kind;
      };
      eq('screen e2e (roles): Admin and Master can refund', [await run('jwt-admin'), await run('jwt-master')], ['succeeded', 'succeeded']);
      const before = creates(c).length;
      eq('screen e2e (roles): Crew, a customer and an anonymous caller are refused and nothing reaches Stripe', [await run('jwt-crew'), await run('jwt-cust'), await run(null), creates(c).length - before], ['rejected', 'rejected', 'rejected', 0]);
      const none = await mkCase([]);
      const ctl = new RefundController(apiFor(none), none.orderId);
      await ctl.load();
      eq('screen e2e (empty): an order with no payments has nothing to refund', [ctl.state.phase, ctl.state.overview!.payments.length], ['ready', 0]);
      const noAccess: RefundApi = { loadOverview: async () => { throw new Error('You do not have access to this order.'); }, submit: async () => ({ status: 403, data: null }) };
      const ctl2 = new RefundController(noAccess, c.orderId);
      await ctl2.load();
      eq('screen e2e (no read access): a refused read is shown as an error and nothing can be sent', [ctl2.state.phase, ctl2.state.loadError], ['load_error', 'You do not have access to this order.']);
    }
  }

  // cleanup
  const ids = createdOrders.map((i) => `'${i}'`).join(',') || "'00000000-0000-0000-0000-000000000000'";
  await pg.exec(`UPDATE public.payments SET refunded_payment_id = NULL WHERE order_id IN (${ids});
    DELETE FROM public.order_refunds WHERE order_id IN (${ids});
    DELETE FROM public.order_changelog WHERE order_id IN (${ids});
    DELETE FROM public.payments WHERE order_id IN (${ids});
    DELETE FROM public.orders WHERE id IN (${ids});
    DELETE FROM auth.users WHERE id IN ('${ADMIN}', '${MASTER}', '${CREW}', '${CUST}');`);
  pg.close();
  finish();
})().catch((e) => {
  console.error(e);
  throw e;
});

function finish() {
  console.log(`Refund safety tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} refund safety test(s) failed`);
}
