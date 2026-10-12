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

import * as authHelpers from '../../supabase/functions/_shared/auth';
import * as refundOps from '../../supabase/functions/_shared/refund-operations';
import { PgPool, ensurePayDatabase, makeWorld, makeClient, loadHandler, loadModule, callHandler, type World } from './paymentHarness';
import { classifyRefundResponse, refundAttemptFor } from './refundOperationKey';

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
    for (const [file, label] of [['src/components/order-detail/PaymentsTab.tsx', 'Payments tab'], ['src/components/pending-order/PaymentManagementSection.tsx', 'pending-order payment section'], ['src/components/admin/TaskDetailModal.tsx', 'task modal']] as const) {
      const src = read(file);
      ok(`wiring: the ${label} sends a stable operation key with every refund and reuses the previous attempt for a retry`, /operationKey: attempt\.key/.test(src) && /refundAttemptFor\(refundAttempt\.current, /.test(src));
    }
    const mig4 = read('supabase/migrations/20261022120000_refund_safety_and_financial_write_authority.sql');
    const reserveFn = /FUNCTION public\.reserve_refund_operation[\s\S]*?\n\$\$;/.exec(mig4)?.[0] ?? '';
    ok('wiring: the refund reservation takes the order row lock before it reads what is refundable', /FROM public\.orders WHERE id = p_order_id FOR UPDATE;[\s\S]*?FROM public\.order_refunds WHERE order_id = p_order_id AND status IN/.test(reserveFn));
    for (const fn of ['_apply_refund_transition(uuid, text, text)', 'reserve_refund_operation(uuid, text, integer, text, uuid)', 'mark_refund_provider_attempt(uuid)', 'record_refund_provider_result(uuid, text, text, text)', 'apply_provider_refund_event(text, text, integer, text, text, text, text)', 'cancel_unattempted_payments_on_order_close()', 'note_payment_applied_to_closed_order()', 'guard_order_pricing_authority()']) {
      ok(`wiring: ${fn.split('(')[0]} is revoked from PUBLIC, anon and authenticated by the migration itself`, mig4.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`));
    }
    for (const [file, label, adoptRe] of [['src/components/order-detail/PaymentsTab.tsx', 'Payments tab', /if \(outcome\.adopt\) \{[\s\S]*?refundAttempt\.current = \{ key: outcome\.adopt\.key/], ['src/components/pending-order/PaymentManagementSection.tsx', 'pending-order payment section', /if \(outcome\.adopt\) \{[\s\S]*?refundAttempt\.current = \{ key: outcome\.adopt\.key/], ['src/components/admin/TaskDetailModal.tsx', 'task modal', /if \(e\?\.code === 'UNSETTLED_REFUND_EXISTS' && e\.data\) \{[\s\S]*?unsettled\.adopt/]] as const) {
      ok(`wiring: the ${label} takes over an unsettled request named by the server instead of starting another refund`, adoptRe.test(read(file)));
    }
    const opsSrc = read('supabase/functions/_shared/refund-operations.ts');
    ok('wiring: a provider request needs the marker (or an earlier one on record), and only an explicit true counts as written', /marked = res\?\.data === true;/.test(opsSrc) && /if \(!\(marked \|\| \(markerFailed && alreadyMarked\)\)\) return/.test(opsSrc));
    ok('wiring: outside the replay window only a COMPLETE lookup allows a new request', /if \(!look\.complete && age > IDEMPOTENCY_SAFE_MS\) return/.test(opsSrc));
    ok('wiring: the lookup follows every page and needs an explicit has_more=false', /starting_after: startingAfter/.test(opsSrc) && /list\.has_more === false\) return \{ found: null, complete: true \}/.test(opsSrc));
    ok('wiring: the reservation blocks a new request while another is unsettled, and refuses an ambiguous history', /'outcome', 'unsettled_operation'/.test(reserveFn) && /'outcome', 'allocation_ambiguous'/.test(reserveFn));
    const refundFn = read('supabase/functions/stripe-refund/index.ts');
    ok('wiring: the refund function passes the operation key and writes nothing itself (the database functions do)', /operationKey: body\.operationKey/.test(refundFn) && !/\.insert\(|\.update\(|\.delete\(/.test(refundFn));
    const ops = read('supabase/functions/_shared/refund-operations.ts');
    ok('wiring: every Stripe refund request carries the row\'s stable idempotency key', /\{ idempotencyKey: row\.provider_idempotency_key \}/.test(ops));
    ok('wiring: a refund names its row in its metadata', /bpc_refund_id: row\.id/.test(ops));
    const approval = read('src/lib/orderApprovalService.ts').replace(/\/\/.*$/gm, '');
    ok('wiring: order approval and rejection no longer write payment rows or payment-state flags from the browser', !/from\('payments'\)\s*\.(update|insert|upsert|delete)/.test(approval) && !/stripe_payment_status\s*:/.test(approval));
    const lifecycle = read('supabase/functions/order-lifecycle/index.ts');
    ok('wiring: the waived-deposit marker is written by the lifecycle function for a trusted admin approval only', /trustedCaller && requestedOutcome === "waived" && source === "admin_approve_zero_deposit" && depositDue === 0/.test(lifecycle));
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
