// WP-29 / WP-30 (B4): payment correctness and recovery.
//   NI-01  a failed approval notifies the customer of a decline ONLY on an explicit card refusal
//   NI-02  a partly paid deposit that the Admin raised is collected before the customer's approval confirms the order
//   NI-03  an abandoned / expired / unreadable online (Checkout) payment never blocks a cash or check entry, and never lets one duplicate a
//          payment that Stripe says was made; the resolver cancels an operation only once Stripe confirms its session is expired
//   S1     charge-deposit re-checks Event Essentials stock on the server (excluding the order itself) before charging
// Pure checks run anywhere; the handler checks run the CURRENT Edge Function source against a fake Stripe and a REAL scratch PostgreSQL
// database (skipped, not passed, when none is reachable; ROLE_DB_REQUIRE=1 makes that a failure).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit(code: number): never };
const fs = require('fs');

import * as authHelpers from '../../../../supabase/functions/_shared/auth';
import * as payOps from '../../../../supabase/functions/_shared/payments/payment-operations';
import * as outcomeHelpers from '../../../../supabase/functions/_shared/orders/lifecycle-outcome';
import * as bookingProofHelpers from '../../../../supabase/functions/_shared/booking/bookingProof';
import * as returnOriginHelpers from '../../../../supabase/functions/_shared/booking/returnOrigin';
import { classifyApprovalFailure, CARD_REFUSAL_CODES } from '../../orders/approvalFailure';
import { isDepositFullyCollected, hasDepositShortfall } from '../../orders/depositCollected';
import { PgPool, ANON_KEY, ensurePayDatabase, makeWorld, makeClient, loadHandler, loadModule, callHandler, lit, type World } from '../support/paymentHarness';

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
const read = (p: string) => fs.readFileSync(p, 'utf8');

// ---------------------------------------------------------------------------------------------------------------------------------
// NI-01: what a failed approval means
// ---------------------------------------------------------------------------------------------------------------------------------
eq('explicit decline code => card refused', classifyApprovalFailure({ code: 'CARD_DECLINED' }), 'card_refused');
eq('unusable card => card refused (the customer must act)', classifyApprovalFailure({ code: 'PAYMENT_METHOD_INVALID' }), 'card_refused');
eq('the refusal codes are exactly these two', [...CARD_REFUSAL_CODES].sort(), ['CARD_DECLINED', 'PAYMENT_METHOD_INVALID']);
eq('charge went through but is being recorded => charged_pending', classifyApprovalFailure({ code: 'FINALIZATION_PENDING', chargeSucceeded: true }), 'charged_pending');
eq('chargeSucceeded alone => charged_pending', classifyApprovalFailure({ chargeSucceeded: true }), 'charged_pending');
for (const code of [
  'PAYMENT_IN_PROGRESS', 'ORDER_STATUS_NOT_PAYABLE', 'DEPOSIT_CATCH_UP_REVIEW_REQUIRED', 'PAYMENT_RECORDS_CONFLICT', 'PAYMENT_STATUS_UNKNOWN', 'PAYMENT_PROCESSING',
  'PAYMENT_REQUEST_INVALID', 'ORDER_NOT_FOUND', 'NO_DEPOSIT_DUE', 'ORDER_CHANGED', 'BALANCE_CHANGED', 'PAYMENT_SELECTION_INVALID', 'INVALID_AMOUNT', 'INVALID_REQUEST',
  'PAYMENT_UNAVAILABLE', 'ITEMS_UNAVAILABLE', 'AVAILABILITY_UNVERIFIABLE', 'SOMETHING_NEW', '', 'card_declined',
]) {
  eq(`${code || '(empty)'} is not a decline`, classifyApprovalFailure({ code }), 'not_confirmed');
}
eq('no code at all (a 500 with only a message) is not a decline', classifyApprovalFailure({}), 'not_confirmed');
eq('no body is not a decline', classifyApprovalFailure(null), 'not_confirmed');
eq('a non-string code is not a decline', classifyApprovalFailure({ code: 402 }), 'not_confirmed');

const approval = read('src/lib/orders/orderApprovalService.ts');
ok('the approval service uses the classifier and has no allow-list of non-decline codes', approval.includes("classifyApprovalFailure(data)") && !approval.includes('NOT_A_DECLINE_CODES'));
ok('only a card refusal reaches the customer decline notification (the other outcomes throw first)', approval.indexOf("failure === 'charged_pending'") > 0 && approval.indexOf("failure === 'not_confirmed'") > approval.indexOf("failure === 'charged_pending'") && approval.indexOf('await sendCardDeclinedNotifications(') > approval.indexOf("failure === 'not_confirmed'"));
ok('the approval no longer does the post-charge work in the browser (receipts, invoice insert, confirmation, lifecycle)', !/logGroupedTransactions|from\('invoices'\)\.insert|generate_invoice_number/.test(approval.slice(approval.indexOf('// Proceed with charging deposit'), approval.indexOf('export async function forceApproveOrder'))));
ok('the zero-deposit approval (no payment exists) still confirms and notifies from the browser', /admin_approve_zero_deposit/.test(approval) && /sendApprovalConfirmationNotifications\(\s*orderWithRelationsNoDeposit/.test(approval));
const modal = read('src/components/customer-portal/CustomerApprovalModal.tsx');
ok('the customer modal shows the decline screen only for an explicit card refusal', modal.includes("classifyApprovalFailure(chargeData) !== 'card_refused'") && !modal.includes('const NOT_A_DECLINE'));

// ---------------------------------------------------------------------------------------------------------------------------------
// NI-02: what "already paid" means
// ---------------------------------------------------------------------------------------------------------------------------------
eq('deposit exactly paid', isDepositFullyCollected({ deposit_due_cents: 5000, deposit_paid_cents: 5000 }), true);
eq('deposit overpaid', isDepositFullyCollected({ deposit_due_cents: 5000, deposit_paid_cents: 6000 }), true);
eq('partly paid', isDepositFullyCollected({ deposit_due_cents: 5000, deposit_paid_cents: 3000 }), false);
eq('paid in full, then the Admin raised the deposit', isDepositFullyCollected({ deposit_due_cents: 8000, deposit_paid_cents: 5000, stripe_payment_status: 'paid' }), false);
eq('nothing due and the waived marker set', isDepositFullyCollected({ deposit_due_cents: 0, deposit_paid_cents: 0, stripe_payment_status: 'paid' }), true);
eq('nothing due, nothing paid, no marker', isDepositFullyCollected({ deposit_due_cents: 0, deposit_paid_cents: 0, stripe_payment_status: 'unpaid' }), false);
eq('missing fields are zero', isDepositFullyCollected({}), false);
eq('shortfall: paid something, less than due', hasDepositShortfall({ deposit_due_cents: 8000, deposit_paid_cents: 5000 }), true);
eq('no shortfall when covered', hasDepositShortfall({ deposit_due_cents: 5000, deposit_paid_cents: 5000 }), false);
eq('no shortfall when nothing was paid (that is the normal charge)', hasDepositShortfall({ deposit_due_cents: 5000, deposit_paid_cents: 0 }), false);
ok('the lifecycle rule and the helper agree (customer_approval_already_paid)', /paid >= due && \(paid > 0 \|\| order\.stripe_payment_status === "paid"\)/.test(read('supabase/functions/_shared/orders/lifecycle-outcome.ts')));
ok('the approval modal and view use the helper, not "any payment"', read('src/components/customer-portal/CustomerApprovalModal.tsx').includes('const alreadyPaidDeposit = isDepositFullyCollected(order)') && read('src/components/customer-portal/OrderApprovalView.tsx').includes('const alreadyPaidDeposit = isDepositFullyCollected(order)'));
ok('...and no screen still treats deposit_paid_cents > 0 as already paid', !/stripe_payment_status === 'paid' \|\|\s*\(order\.deposit_paid_cents \|\| 0\) > 0/.test(read('src/components/customer-portal/CustomerApprovalModal.tsx') + read('src/components/customer-portal/OrderApprovalView.tsx')));

// ---------------------------------------------------------------------------------------------------------------------------------
// Handler checks
// ---------------------------------------------------------------------------------------------------------------------------------
const TAG = String((Date.now() % 1e6) * 1000 + (process as any).pid % 1000).padStart(9, '0');
let counter = 0;
const nextId = () => `ddddddd2-0000-4000-8000-${TAG}${String(++counter).padStart(3, '0')}`;
const tok = (orderId: string) => `tok-${orderId}-link`;
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

(async () => {
  const db = ensurePayDatabase();
  if (!db) {
    if (process.env.ROLE_DB_REQUIRE) ok('executed: the scratch payment database is available (ROLE_DB_REQUIRE is set)', false);
    else console.log('Payment recovery handler tests SKIPPED: the scratch database was not reachable.');
    finish();
    return;
  }
  const pg = new PgPool(db.psql, db.db, 8);
  const shared = { ...authHelpers, ...outcomeHelpers, ...bookingProofHelpers, ...returnOriginHelpers, ...payOps };
  const ADMIN_UUID = '00000000-0000-4000-8000-0000000000aa';
  // The offline-payment functions record who acted (a foreign key to the auth user), so the acting admin must exist in the scratch auth table.
  await pg.exec(`INSERT INTO auth.users (id, email) VALUES (${lit(ADMIN_UUID)}, 'admin@payment-recovery.test') ON CONFLICT (id) DO NOTHING;`);
  const newWorld = (): World => {
    const w = makeWorld(pg);
    w.users['jwt-admin-uuid'] = ADMIN_UUID;
    (w.tables.user_roles as any[]).push({ user_id: ADMIN_UUID, role: 'admin' });
    return w;
  };

  async function confirmedOrder(w: World, opts: { card?: boolean } = {}): Promise<string> {
    const id = nextId();
    const cols: Record<string, unknown> = {
      id, status: 'confirmed', location_type: 'residential', event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '12:00',
      subtotal_cents: 15000, deposit_due_cents: 5000, deposit_paid_cents: 5000, balance_due_cents: 10000, balance_paid_cents: 0, tip_cents: 0, pickup_preference: 'same_day',
      stripe_customer_id: opts.card === false ? null : 'cus_1', stripe_payment_method_id: opts.card === false ? null : 'pm_card',
    };
    const keys = Object.keys(cols);
    await pg.exec(`INSERT INTO public.orders (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((k) => lit(cols[k])).join(', ')});`);
    await pg.exec(`INSERT INTO public.invoice_links (order_id, link_type, link_token, expires_at) VALUES (${lit(id)}, 'portal', ${lit(tok(id))}, ${lit(FUTURE)});`);
    w.embeds.orders = {
      customers: { email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      addresses: { line1: '1 Main', city: 'Town', state: 'MI', zip: '48000' },
      order_items: [],
      order_custom_fees: [],
    };
    return id;
  }
  const snapshot = async (id: string) => {
    const o = (await pg.query(`SELECT to_jsonb(t) AS j FROM public.orders t WHERE id = '${id}'`))[0].j;
    return { status: o.status, bd: o.balance_due_cents, bp: o.balance_paid_cents };
  };
  const payRows = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.payments t WHERE order_id = '${id}' ORDER BY created_at, ledger_sequence`)).map((r: any) => r.j);
  const statuses = async (id: string) => (await payRows(id)).map((p: any) => `${p.type}:${p.status}`);
  const openCheckout = async (w: World, id: string) => {
    const r = await callHandler(loadHandler('customer-balance-payment', w, shared), { orderId: id, amountCents: 10000, tipCents: 0, invoiceToken: tok(id) }, ANON_KEY);
    return { r, session: Object.values(w.stripe.sessions_)[0] as any };
  };
  const cash = (w: World, id: string) => callHandler(loadHandler('record-cash-payment', w, shared), { orderId: id, amountCents: 10000 }, 'jwt-admin-uuid');
  const check = (w: World, id: string) => callHandler(loadHandler('record-check-payment', w, shared), { orderId: id, amountCents: 10000, checkNumber: '1001' }, 'jwt-admin-uuid');

  // =================================================================================================================
  // NI-03: abandoned Checkout, then a cash entry
  // =================================================================================================================
  {
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const { r, session } = await openCheckout(w, id);
    ok('setup: the customer was offered a Checkout session and the operation is open', r.status === 200 && session?.status === 'open' && (await statuses(id)).join() === 'balance:pending');
    const res = await cash(w, id);
    eq('abandoned Checkout: the cash entry succeeds', [res.status, (await snapshot(id)).bp, (await snapshot(id)).bd], [200, 10000, 0]);
    eq('... the open session was expired at Stripe, once', [session.status, w.stripe.count('checkout.sessions.expire')], ['expired', 1]);
    eq('... the Checkout operation is cancelled and the cash payment is the only success', (await statuses(id)).sort(), ['balance:cancelled', 'balance:succeeded']);
  }
  {
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const { session } = await openCheckout(w, id);
    const res = await check(w, id);
    eq('abandoned Checkout: a CHECK entry works the same way', [res.status, (await snapshot(id)).bp, session.status], [200, 10000, 'expired']);
  }
  {
    // the customer actually paid the session; nobody has processed it yet
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const { session } = await openCheckout(w, id);
    w.stripe.paySession(session.id);
    const res = await cash(w, id);
    ok('paid Checkout: the cash entry is refused (409, "paid online")', res.status === 409 && /paid online/i.test(res.json?.error ?? ''));
    eq('... the online payment was applied once, and no cash payment was added', [(await snapshot(id)).bp, (await snapshot(id)).bd, (await statuses(id)).join()], [10000, 0, 'balance:succeeded']);
  }
  {
    // Stripe cannot expire the session (it may still be payable): the operation must stay open and the cash entry refused
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const { session } = await openCheckout(w, id);
    const realExpire = w.stripe.checkout.sessions.expire;
    w.stripe.checkout.sessions.expire = async () => { throw new Error('Stripe is unreachable'); };
    const res = await cash(w, id);
    ok('expire fails while the session is still open: refused (409, still open)', res.status === 409 && /still open|can still pay/i.test(res.json?.error ?? ''));
    eq('... the operation is NOT cancelled and nothing was recorded', [(await statuses(id)).join(), (await snapshot(id)).bp, session.status], ['balance:pending', 0, 'open']);
    w.stripe.checkout.sessions.expire = realExpire;
    const retry = await cash(w, id);
    eq('... once Stripe works again the entry goes through', [retry.status, (await snapshot(id)).bp, session.status], [200, 10000, 'expired']);
  }
  {
    // expire fails because the session expired on its own meanwhile: cancel is allowed because Stripe says so
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    await openCheckout(w, id);
    const realExpire = w.stripe.checkout.sessions.expire;
    w.stripe.checkout.sessions.expire = async (sid: string) => { w.stripe.sessions_[sid].status = 'expired'; return realExpire(sid); };
    const res = await cash(w, id);
    eq('expire loses a race with the session expiring by itself: confirmed expired, so the entry proceeds', [res.status, (await snapshot(id)).bp], [200, 10000]);
  }
  {
    // the session cannot be read at all
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    await openCheckout(w, id);
    const realRetrieve = w.stripe.checkout.sessions.retrieve;
    w.stripe.checkout.sessions.retrieve = async () => { throw new Error('Stripe is unreachable'); };
    const res = await cash(w, id);
    ok('unreadable session: the entry is refused (fail closed)', res.status === 409);
    eq('... and nothing changed', [(await statuses(id)).join(), (await snapshot(id)).bp], ['balance:pending', 0]);
    w.stripe.checkout.sessions.retrieve = realRetrieve;
  }
  {
    // already expired at Stripe before anyone looked
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const { session } = await openCheckout(w, id);
    session.status = 'expired';
    const res = await cash(w, id);
    eq('already-expired session: cancelled and the entry proceeds, without another expire call', [res.status, (await statuses(id)).sort().join(), w.stripe.count('checkout.sessions.expire')], [200, 'balance:cancelled,balance:succeeded', 0]);
  }
  {
    // no online payment at all: the new code does not touch Stripe
    const w = newWorld();
    const id = await confirmedOrder(w);
    const res = await cash(w, id);
    eq('no open Checkout: a plain cash entry never calls Stripe', [res.status, w.stripe.calls.length], [200, 0]);
  }

  // =================================================================================================================
  // NI-03: the webhook's checkout.session.expired
  // =================================================================================================================
  {
    const w = newWorld();
    const id = await confirmedOrder(w, { card: false });
    const { session } = await openCheckout(w, id);
    const handlers = loadModule('supabase/functions/stripe-webhook/handlers.ts', w, shared);
    const client = makeClient(w);
    // an expired event for a session that is really still open is ignored (events are hints, Stripe is the authority)
    await handlers.handleCheckoutSessionExpired({ id: session.id }, client, w.stripe);
    eq('expired event for a still-open session: ignored, nothing expired or cancelled', [(await statuses(id)).join(), session.status, w.stripe.count('checkout.sessions.expire')], ['balance:pending', 'open', 0]);
    session.status = 'expired';
    await handlers.handleCheckoutSessionExpired({ id: session.id }, client, w.stripe);
    eq('expired event for an expired session: the operation is cancelled', (await statuses(id)).join(), 'balance:cancelled');
    await handlers.handleCheckoutSessionExpired({ id: session.id }, client, w.stripe);
    eq('... a repeated event changes nothing', (await statuses(id)).join(), 'balance:cancelled');
    await handlers.handleCheckoutSessionExpired({ id: 'cs_unknown' }, client, w.stripe);
    ok('... an event for a session we do not know is ignored', true);
    ok('the webhook routes the event', read('supabase/functions/stripe-webhook/index.ts').includes('case "checkout.session.expired":'));
  }

  // =================================================================================================================
  // S1: Event Essentials stock is re-checked on the server before the deposit is charged
  // =================================================================================================================
  {
    const approve = (w: World, id: string) => callHandler(loadHandler('charge-deposit', w, shared), { orderId: id }, 'jwt-admin');
    const seedEe = async (w: World) => {
      const id = nextId();
      await pg.exec(`INSERT INTO public.orders (id, status, location_type, event_date, event_end_date, start_window, end_window, subtotal_cents, deposit_due_cents, deposit_paid_cents, balance_due_cents, balance_paid_cents, tip_cents, pickup_preference, stripe_customer_id, stripe_payment_method_id) VALUES (${lit(id)}, 'pending_review', 'residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 15000, 5000, 0, 10000, 0, 0, 'same_day', 'cus_1', 'pm_card');`);
      await pg.exec(`INSERT INTO public.invoice_links (order_id, link_type, link_token, expires_at) VALUES (${lit(id)}, 'portal', ${lit(tok(id))}, ${lit(FUTURE)});`);
      w.embeds.orders = { customers: { email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' }, addresses: { line1: '1 Main', city: 'Town', state: 'MI', zip: '48000' }, order_items: [], order_custom_fees: [] };
      w.tables.order_items.push({ order_id: id, unit_id: null, product_id: '11111111-1111-4111-8111-111111111111', bundle_id: null, qty: 4, item_name: 'Round Tables', pricing_context: 'standalone', component_snapshot: null });
      return id;
    };
    {
      const w = newWorld();
      const id = await seedEe(w);
      let seen: Record<string, any> | null = null;
      w.rpcStubs = { check_product_availability: (args) => { seen = args; return { data: [{ product_id: '11111111-1111-4111-8111-111111111111', is_allowed: true }], error: null }; } };
      const res = await approve(w, id);
      ok('EE in stock: the approval charges', res.status === 200 && res.json?.success === true && w.stripe.succeededCount === 1);
      ok('... the check excluded the order itself and asked for its quantity', (seen as any)?.p_exclude_order_id === id && (seen as any)?.p_requested_items?.[0]?.quantity === 4);
    }
    {
      const w = newWorld();
      const id = await seedEe(w);
      w.rpcStubs = { check_product_availability: () => ({ data: [{ product_id: '11111111-1111-4111-8111-111111111111', is_allowed: false }], error: null }) };
      const res = await approve(w, id);
      ok('EE oversold: refused (409 ITEMS_UNAVAILABLE) and nothing is charged', res.status === 409 && res.json?.code === 'ITEMS_UNAVAILABLE' && w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
    }
    {
      const w = newWorld();
      const id = await seedEe(w);
      w.rpcStubs = { check_product_availability: () => ({ data: null, error: { message: 'db down' } }) };
      const res = await approve(w, id);
      ok('EE availability unverifiable: refused (503) and nothing is charged', res.status === 503 && w.stripe.calls.length === 0 && (await payRows(id)).length === 0);
    }
    ok('inflatable-only orders still go through the unit loop and never call the product check', (() => { const t = read('supabase/functions/charge-deposit/index.ts'); return t.includes('const inflatableRows') && t.includes('for (const item of inflatableRows'); })());
  }

  // =================================================================================================================
  // Source wiring
  // =================================================================================================================
  {
    const ops = read('supabase/functions/_shared/payments/payment-operations.ts');
    ok('the resolver cancels an open session only when Stripe says it is expired', /again\?\.status !== "expired"/.test(ops));
    for (const f of ['supabase/functions/record-cash-payment/index.ts', 'supabase/functions/record-check-payment/index.ts']) {
      const t = read(f);
      ok(`${f}: settles open Checkout operations before recording`, t.includes('settleOpenCheckoutOperations(supabaseAdmin, stripe, orderId)') && t.indexOf('settleOpenCheckoutOperations(') < t.search(/rpc\(\s*"record_/));
    }
  }

  await pg.exec(`DELETE FROM public.payments WHERE order_id::text LIKE 'ddddddd2-0000-4000-8000-${TAG}%'; DELETE FROM public.invoice_links WHERE order_id::text LIKE 'ddddddd2-0000-4000-8000-${TAG}%'; DELETE FROM public.order_changelog WHERE order_id::text LIKE 'ddddddd2-0000-4000-8000-${TAG}%'; DELETE FROM public.orders WHERE id::text LIKE 'ddddddd2-0000-4000-8000-${TAG}%'; DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000000aa' AND email = 'admin@payment-recovery.test';`);
  pg.close();
  finish();
})().catch((e) => {
  console.error(e);
  failed++;
  finish();
});

function finish() {
  console.log(`Payment recovery tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
