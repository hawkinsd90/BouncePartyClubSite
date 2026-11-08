// D1 / WP-P1-16 (F-18, DEC-09, B-25): a known inventory conflict, or an availability check that cannot be completed, BLOCKS a new
// confirmation made by order-lifecycle; a confirmation whose status was already written elsewhere, or that follows money just
// collected, is only recorded and alerted (never refused, no payment touched).
// D4 / WP-P1-23: completed orders keep their reservations (TypeScript lists and the forward-only SQL migration).
//
// Behavioural: the shared helper with fake ports, and order-lifecycle's CURRENT source run in the in-memory portal harness
// (real shared helpers, fake database; no network). Source-level scans are labelled as such. The SQL function itself is NOT executed
// here (no scratch database rebuild): its change is asserted at source level only.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');

import '../support/portalTestWindow';
import { SERVICE_KEY, ANON_KEY, addOrder, callFunction, loadFunction, makeClient, makeHarness, newDb, tokenFor, type Harness } from '../support/portalTestHarness';
import { checkOrderAvailabilityForConfirm, confirmAvailabilityBlocks, blockedConfirmationMessage, AVAILABILITY_CONFLICT_CHANGE_TYPE, AVAILABILITY_UNVERIFIED_CHANGE_TYPE } from '../../../../supabase/functions/_shared/booking/orderConfirmAvailability';
import { BLOCKING_ORDER_STATUSES, unitsWithConflicts, supabaseAvailabilityPort } from '../../../../supabase/functions/_shared/booking/bookingAvailability';

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
const read = (p: string): string => fs.readFileSync(p, 'utf8');

const PROD = '11111111-1111-4111-8111-111111111111';
const range = (unit_id: string, status: string, d = '2026-11-10', e = '2026-11-10') => ({ unit_id, event_date: d, event_end_date: e, status });
const okPort = (over: Record<string, any> = {}): any => ({
  blackout: async () => ({ is_full_blocked: false, is_same_day_pickup_blocked: false }),
  bookedRanges: async () => [],
  productAvailability: async (items: any[]) => ({ data: items.map((i) => ({ product_id: i.product_id, is_allowed: true })), error: null }),
  ...over,
});
const ORDER = { id: 'ZZ-TEST-own', event_date: '2026-11-10', event_end_date: '2026-11-10' };

(async () => {
  // ---- WP-P1-23 (ii) TypeScript side: completed keeps blocking, cancelled / void / draft do not ----
  {
    for (const st of ['pending_review', 'awaiting_customer_approval', 'confirmed', 'in_progress', 'completed']) {
      ok(`blocking set includes ${st}`, (BLOCKING_ORDER_STATUSES as readonly string[]).includes(st));
      eq(`a ${st} order blocks the same unit and dates`, unitsWithConflicts([range('u1', st)], ['u1'], '2026-11-10', '2026-11-10'), ['u1']);
    }
    for (const st of ['cancelled', 'void', 'draft']) {
      eq(`a ${st} order does not block`, unitsWithConflicts([range('u1', st)], ['u1'], '2026-11-10', '2026-11-10'), []);
    }
    eq('a completed order blocks only its ORIGINAL dates (overlap at either edge)', [
      unitsWithConflicts([range('u1', 'completed', '2026-11-10', '2026-11-11')], ['u1'], '2026-11-11', '2026-11-12'),
      unitsWithConflicts([range('u1', 'completed', '2026-11-10', '2026-11-11')], ['u1'], '2026-11-12', '2026-11-12'),
    ], [['u1'], []]);
    // src/lib/booking/availability.ts (browser) lists the same statuses (source-level)
    const browser = read('src/lib/booking/availability.ts');
    const m = /const BLOCKED_STATUSES = \[([^\]]*)\]/.exec(browser)?.[1] ?? '';
    ok('source-level: browser availability.ts includes completed and awaiting_customer_approval', /COMPLETED/.test(m) && /AWAITING_CUSTOMER_APPROVAL/.test(m));
    // D4: the SQL function used for Event Essentials stock. The ORIGINAL migration is untouched; a new forward-only one redefines it.
    const sql = read('supabase/migrations/20260716231832_fix_check_product_availability_visibility.sql');
    ok('source-level: the original definition is unchanged (two lists, no completed)', [...sql.matchAll(/o\.status IN \(([^)]*)\)/g)].every((x) => !x[1].includes("'completed'")));
    const newSql = read('supabase/migrations/20261028120000_check_product_availability_count_completed_orders.sql');
    const newLists = [...newSql.matchAll(/o\.status IN \(([^)]*)\)/g)].map((x) => x[1]);
    ok('source-level: the new migration has both reservation lists, each now including completed and awaiting_customer_approval', newLists.length === 2 && newLists.every((l) => l.includes("'completed'") && l.includes("'awaiting_customer_approval'")));
    ok('source-level: cancelled, void and draft are still not in either list', newLists.every((l) => !/cancelled|void|draft/.test(l)));
    ok('source-level: the new migration is a CREATE OR REPLACE of the same signature (grants and owner kept), with the visibility rules intact', /CREATE OR REPLACE FUNCTION public\.check_product_availability\(\s*p_requested_items jsonb,\s*p_start_date date,\s*p_end_date date,\s*p_exclude_order_id uuid DEFAULT NULL::uuid\s*\)/.test(newSql) && /v_is_privileged/.test(newSql) && /public_visible = true/.test(newSql));
    ok('source-level: the date-overlap predicates are unchanged (a completed order holds only its original dates)', (newSql.match(/o\.event_date <= p_end_date/g) ?? []).length === 2 && (newSql.match(/COALESCE\(o\.event_end_date, o\.event_date\) >= p_start_date/g) ?? []).length === 2);
    ok('source-level: the new migration is the only definition of the function newer than the original', fs.readdirSync('supabase/migrations').filter((f: string) => f.slice(0, 14) > '20260716231832' && /CREATE OR REPLACE FUNCTION public\.check_product_availability\b/.test(read(`supabase/migrations/${f}`))).join(',') === '20261028120000_check_product_availability_count_completed_orders.sql');
  }

  // ---- helper: pure verdicts ----
  {
    eq('blocking applies only when lifecycle writes the status and no money was just collected', [
      confirmAvailabilityBlocks('waived', 'awaiting_customer_approval'), confirmAvailabilityBlocks('zero_due_with_card', 'draft'), confirmAvailabilityBlocks('already_paid', 'awaiting_customer_approval'),
      confirmAvailabilityBlocks('charged_now', 'awaiting_customer_approval'), confirmAvailabilityBlocks('cash', 'draft'),
      confirmAvailabilityBlocks('waived', 'confirmed'), confirmAvailabilityBlocks('already_paid', 'confirmed'),
    ], [true, true, true, false, false, false, false]);
    const items = [{ unit_id: 'u1', product_id: null, bundle_id: null, qty: 1 }];
    eq('no other booking: ok', (await checkOrderAvailabilityForConfirm(okPort(), ORDER, items)).kind, 'ok');
    const conflict = await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async () => [range('u1', 'confirmed')] }), ORDER, items);
    eq('inflatable overlap: conflict that names the equipment (no name lookup: generic)', [conflict.kind, (conflict as any).unavailable], ['conflict', ['an inflatable on this order']]);
    const named = await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async () => [range('u1', 'confirmed')] }), ORDER, items, { units: async () => ({ u1: 'ZZ TEST Castle' }) });
    eq('...with a unit name it names the unit', [named.kind, (named as any).unavailable, (named as any).note.includes('ZZ TEST Castle')], ['conflict', ['ZZ TEST Castle'], true]);
    const namesThrow = await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async () => [range('u1', 'confirmed')] }), ORDER, items, { units: async () => { throw new Error('names down'); } });
    eq('...a failing name lookup never changes the verdict', namesThrow.kind, 'conflict');
    eq('a completed booking on the same dates conflicts', (await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async () => [range('u1', 'completed')] }), ORDER, items)).kind, 'conflict');
    eq('a cancelled booking does not', (await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async () => [range('u1', 'cancelled')] }), ORDER, items)).kind, 'ok');
    eq('a different date does not', (await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async () => [range('u1', 'confirmed', '2026-11-20', '2026-11-20')] }), ORDER, items)).kind, 'ok');
    let excluded: unknown = 'not called';
    await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async (_ids: string[], ex: unknown) => ((excluded = ex), []) }), ORDER, items);
    eq('the order excludes ITSELF from the booked list', excluded, 'ZZ-TEST-own');
    eq('unreadable booked list: unverifiable, never a conflict and never ok', (await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async () => null }), ORDER, items)).kind, 'unverifiable');
    eq('a port that throws: unverifiable, never throws', (await checkOrderAvailabilityForConfirm(okPort({ bookedRanges: async () => { throw new Error('boom'); } }), ORDER, items)).kind, 'unverifiable');
    eq('items could not be loaded: unverifiable', (await checkOrderAvailabilityForConfirm(okPort(), ORDER, null)).kind, 'unverifiable');
    const ee = [{ unit_id: null, product_id: PROD, bundle_id: null, qty: 3 }];
    eq('Event Essentials short: conflict', (await checkOrderAvailabilityForConfirm(okPort({ productAvailability: async () => ({ data: [{ product_id: PROD, is_allowed: false }], error: null }) }), ORDER, ee)).kind, 'conflict');
    const eeNamed = await checkOrderAvailabilityForConfirm(okPort({ productAvailability: async () => ({ data: [{ product_id: PROD, product_name: 'ZZ TEST Tables', is_allowed: false, quantity_requested: 5, available_before_request: 2 }], error: null }) }), ORDER, ee);
    eq('Event Essentials short: names the item with the quantities', (eeNamed as any).unavailable, ['ZZ TEST Tables (need 5, 2 available)']);
    eq('blocked messages: conflict names the equipment and says no payment changed; unverifiable asks for review', [blockedConfirmationMessage(eeNamed as any).includes('ZZ TEST Tables'), /did not change any payment/.test(blockedConfirmationMessage(eeNamed as any)), /needs a review/.test(blockedConfirmationMessage({ kind: 'unverifiable', note: 'x' }))], [true, true, true]);
    eq('Event Essentials query error: unverifiable', (await checkOrderAvailabilityForConfirm(okPort({ productAvailability: async () => ({ data: null, error: 'x' }) }), ORDER, ee)).kind, 'unverifiable');
    let eeExclude: unknown = null;
    await checkOrderAvailabilityForConfirm(okPort({ productAvailability: async (it: any[], _s: string, _e: string, ex: unknown) => ((eeExclude = ex), { data: it.map((i) => ({ product_id: i.product_id, is_allowed: true })), error: null }) }), ORDER, ee);
    eq('Event Essentials check excludes the order itself', eeExclude, 'ZZ-TEST-own');
    eq('an order with no items: ok', (await checkOrderAvailabilityForConfirm(okPort(), ORDER, [])).kind, 'ok');
  }

  // ---- the Supabase port honours excludeOrderId (fake database) ----
  {
    const db = newDb();
    db.tables.orders.push({ id: 'o-self', event_date: '2026-11-10', event_end_date: '2026-11-10', status: 'awaiting_customer_approval' }, { id: 'o-other', event_date: '2026-11-10', event_end_date: '2026-11-10', status: 'confirmed' });
    db.tables.order_items.push({ id: 'i1', order_id: 'o-self', unit_id: 'u1' }, { id: 'i2', order_id: 'o-other', unit_id: 'u1' });
    const port = supabaseAvailabilityPort(makeClient(db, { key: SERVICE_KEY }));
    eq('port without exclusion sees both orders (previous behaviour kept)', ((await port.bookedRanges(['u1'])) ?? []).length, 2);
    eq('port with exclusion drops only that order', ((await port.bookedRanges(['u1'], 'o-self')) ?? []).map((r: any) => r.status), ['confirmed']);
  }

  // ---- order-lifecycle, run from its current source ----
  function fixture(): Harness {
    const db = newDb();
    db.tables.admin_settings.push({ key: 'admin_notification_phone', value: '+15555550999' });
    db.rpcResults.check_product_availability = null;
    // the order under test: a $0-deposit Admin invoice waiting for approval, one inflatable
    addOrder(db, { id: 'ZZ-TEST-appr', customer: 'cust-A', status: 'awaiting_customer_approval', deposit_due_cents: 0, balance_due_cents: 20000 });
    db.tables.order_items.push({ id: 'zi-1', order_id: 'ZZ-TEST-appr', unit_id: 'unit-X', product_id: null, bundle_id: null, qty: 1, wet_or_dry: 'dry', unit_price_cents: 20000 });
    return makeHarness(db);
  }
  const addOther = (h: Harness, status: string, over: Record<string, any> = {}) => {
    addOrder(h.db, { id: `ZZ-TEST-other-${status}`, customer: 'cust-B', status, ...over });
    h.db.tables.order_items.push({ id: `zo-${status}`, order_id: `ZZ-TEST-other-${status}`, unit_id: 'unit-X', product_id: null, bundle_id: null, qty: 1, wet_or_dry: 'dry', unit_price_cents: 20000 });
  };
  const life = (h: Harness, bearer: string | null, source: string, outcome: string, extra: Record<string, unknown> = {}) =>
    callFunction(loadFunction('order-lifecycle', h), bearer, { action: 'enter_confirmed', orderId: 'ZZ-TEST-appr', source, paymentOutcome: outcome, ...extra });
  const order = (h: Harness) => h.db.tables.orders.find((o) => o.id === 'ZZ-TEST-appr')!;
  const conflictRows = (h: Harness) => h.db.tables.order_changelog.filter((c) => c.order_id === 'ZZ-TEST-appr' && c.change_type === AVAILABILITY_CONFLICT_CHANGE_TYPE);
  const adminSms = (h: Harness) => h.db.invokes.filter((i) => i.name === 'send-sms-notification').map((i) => String(i.opts?.body?.message));
  const adminEmail = (h: Harness) => h.db.invokes.filter((i) => i.name === 'send-email').map((i) => String(i.opts?.body?.html));

  const Q = (h: Harness) => h.db.tables.order_changelog.filter((c) => c.order_id === 'ZZ-TEST-appr' && c.new_value === 'blocked');
  const nothingWritten = (h: Harness) => order(h).status === 'awaiting_customer_approval' && !order(h).customer_approved_at && order(h).stripe_payment_status !== 'paid';
  const withUnitName = (h: Harness) => { h.db.tables.units = [{ id: 'unit-X', name: 'ZZ TEST Castle' }]; return h; };
  const noCustomerOrPaymentCalls = (h: Harness) => h.db.invokes.every((i) => i.name === 'send-sms-notification' || i.name === 'send-email') && h.db.tables.payments.length === 0;

  // 1. a conflicting inflatable (any blocking status) BLOCKS a confirmation that lifecycle itself would write
  for (const status of ['confirmed', 'completed', 'in_progress', 'pending_review', 'awaiting_customer_approval']) {
    const h = withUnitName(fixture());
    addOther(h, status);
    const r = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok(`admin waived approval with an overlapping ${status} order: NOT confirmed (400, AVAILABILITY_CONFLICT)`, r.status === 400 && r.json.code === 'AVAILABILITY_CONFLICT' && r.json.success === false);
    ok(`...the explanation names the unavailable equipment (${status})`, /ZZ TEST Castle/.test(String(r.json.error)) && Array.isArray(r.json.unavailable) && r.json.unavailable[0] === 'ZZ TEST Castle');
    ok(`...nothing was written to the order: status, approval stamp and waived-deposit marker untouched (${status})`, nothingWritten(h));
    eq(`...conflict history row recorded once, as blocked (${status})`, [conflictRows(h).length, Q(h).length], [1, 1]);
    ok(`...Admin notified (blocked SMS + email), and NO "BOOKING CONFIRMED" alert (${status})`, adminSms(h).some((m) => /CONFIRMATION BLOCKED/.test(m)) && !adminSms(h).some((m) => /BOOKING CONFIRMED/.test(m)) && adminEmail(h).some((m) => /Confirmation blocked for Order/.test(m)));
    ok(`...no customer notification and no payment record (${status})`, noCustomerOrPaymentCalls(h));
  }
  // 2. non-blocking neighbours confirm normally
  for (const status of ['cancelled', 'void', 'draft']) {
    const h = fixture();
    addOther(h, status);
    const r = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok(`an overlapping ${status} order does not block or warn`, r.status === 200 && order(h).status === 'confirmed' && conflictRows(h).length === 0 && !adminSms(h).some((m) => /CHECK STOCK/.test(m)));
  }
  {
    const h = fixture();
    addOther(h, 'confirmed', { event_date: '2026-12-01', event_end_date: '2026-12-01' });
    const r = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok('AVAILABLE: a booking on other dates confirms normally', r.status === 200 && order(h).status === 'confirmed' && conflictRows(h).length === 0);
  }
  {
    const h = fixture();
    const r = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok('AVAILABLE: no other booking confirms; waived marker written; Admin gets the normal BOOKING CONFIRMED alert; the order never conflicts with itself', r.status === 200 && order(h).status === 'confirmed' && order(h).stripe_payment_status === 'paid' && conflictRows(h).length === 0 && adminSms(h).some((m) => /BOOKING CONFIRMED/.test(m)));
  }
  // 3. every pre-payment / no-new-money outcome blocks, for the backend and for an admin
  for (const [bearer, label] of [[SERVICE_KEY, 'backend'], ['jwt-admin', 'admin']] as const) {
    for (const outcome of ['zero_due_with_card', 'already_paid', 'waived']) {
      const h = fixture();
      if (outcome === 'already_paid') Object.assign(order(h), { deposit_due_cents: 5000, deposit_paid_cents: 5000 });
      addOther(h, 'confirmed');
      const r = await life(h, bearer, 'admin_approve', outcome);
      ok(`${label} ${outcome} with an overlap: blocked, order left awaiting approval`, r.status === 400 && r.json.code === 'AVAILABILITY_CONFLICT' && order(h).status === 'awaiting_customer_approval' && !order(h).customer_approved_at);
    }
  }
  // 3b. a QUOTE-status Admin Invoice saved a card (stripe-webhook setup events hand the confirmation to lifecycle as already_paid / zero_due_with_card):
  // lifecycle accepts the status and applies the same gate. The webhook is a backend (service-role) caller.
  for (const outcome of ['zero_due_with_card', 'already_paid']) {
    const quoteFixture = () => {
      const h = fixture();
      order(h).status = 'quote';
      if (outcome === 'already_paid') Object.assign(order(h), { deposit_due_cents: 5000, deposit_paid_cents: 5000 });
      return h;
    };
    const h = withUnitName(quoteFixture());
    addOther(h, 'confirmed');
    const r = await life(h, SERVICE_KEY, 'webhook_setup_session_admin_invoice', outcome, { oldStatusHint: 'quote' });
    ok(`quote-status invoice (${outcome}) with an overlap: refused with AVAILABILITY_CONFLICT naming the unit, order stays quote`, r.status === 400 && r.json.code === 'AVAILABILITY_CONFLICT' && /ZZ TEST Castle/.test(String(r.json.error)) && order(h).status === 'quote' && !order(h).customer_approved_at);
    ok(`...no payment record, no customer notification, Admin told once (${outcome})`, noCustomerOrPaymentCalls(h) && adminSms(h).some((m) => /CONFIRMATION BLOCKED/.test(m)));
    const again = await life(h, SERVICE_KEY, 'webhook_setup_session_admin_invoice', outcome, { oldStatusHint: 'quote' });
    ok(`...a redelivered webhook is refused the same way and adds no second history row or alert (${outcome})`, again.status === 400 && order(h).status === 'quote' && conflictRows(h).length === 1 && adminSms(h).filter((m) => /CONFIRMATION BLOCKED/.test(m)).length === 1);
    const ok2 = quoteFixture();
    const r2 = await life(ok2, SERVICE_KEY, 'webhook_setup_session_admin_invoice', outcome, { oldStatusHint: 'quote' });
    ok(`quote-status invoice (${outcome}) with no overlap: confirms`, r2.status === 200 && order(ok2).status === 'confirmed' && conflictRows(ok2).length === 0);
    const cancelled = await life(ok2, SERVICE_KEY, 'webhook_setup_session_admin_invoice', outcome);
    ok(`...and a repeat on the now-confirmed order is idempotent (${outcome})`, cancelled.status === 200 && order(ok2).status === 'confirmed');
  }
  // 4. PAYMENT SAFEGUARD: money just collected is never refused or lost; the conflict is only recorded and alerted
  for (const outcome of ['charged_now', 'cash']) {
    const h = fixture();
    Object.assign(order(h), { deposit_due_cents: 5000, deposit_paid_cents: 5000 });
    h.db.tables.payments.push({ id: 'pay-1', order_id: 'ZZ-TEST-appr', status: 'succeeded', amount_cents: 5000 });
    addOther(h, 'confirmed');
    const before = JSON.stringify(h.db.tables.payments);
    const r = await life(h, SERVICE_KEY, 'post_payment_completion', outcome);
    ok(`${outcome} (money collected) with an overlap: NOT refused, order confirmed, payment ledger and deposit untouched`, r.status === 200 && order(h).status === 'confirmed' && JSON.stringify(h.db.tables.payments) === before && order(h).deposit_paid_cents === 5000);
    ok(`...the conflict is recorded in history and added to the Admin alert (${outcome})`, conflictRows(h).length === 1 && Q(h).length === 0 && adminSms(h).some((m) => /CHECK STOCK: an item may be double-booked/.test(m)) && adminEmail(h).some((m) => /Check the equipment/.test(m)));
  }
  {
    // the status was already written by someone else (Admin browser approval, payment RPC): cannot be undone here, so warn only
    const h = fixture();
    order(h).status = 'confirmed';
    addOther(h, 'confirmed');
    const r = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived', { oldStatusHint: 'awaiting_customer_approval' });
    ok('status already confirmed by the caller + conflict: stays confirmed, conflict recorded and alerted (warn side)', r.status === 200 && order(h).status === 'confirmed' && conflictRows(h).length === 1 && Q(h).length === 0 && adminSms(h).some((m) => /CHECK STOCK/.test(m)));
    const sms = adminSms(h).length;
    await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    eq('a repeat of an already confirmed and alerted order adds no second row and no second alert (no duplicate operation)', [conflictRows(h).length, adminSms(h).length], [1, sms]);
  }
  // 5. customer pathway (portal token, $0 deposit, saved card): blocked with an explanation, nothing stamped
  {
    const h = withUnitName(fixture());
    addOther(h, 'confirmed');
    const r = await life(h, ANON_KEY, 'customer_approval_zero_deposit', 'zero_due_with_card', { invoiceToken: tokenFor('p-ZZ-TEST-appr') });
    ok('customer zero-deposit approval with an overlap: refused with the equipment named, nothing written, approval not stamped', r.status === 400 && r.json.code === 'AVAILABILITY_CONFLICT' && /ZZ TEST Castle/.test(String(r.json.error)) && nothingWritten(h));
  }
  {
    // an approval of an edited order whose deposit was collected earlier: lifecycle would write the status, so it is blocked; the money stays
    const h = withUnitName(fixture());
    Object.assign(order(h), { deposit_due_cents: 5000, deposit_paid_cents: 5000, stripe_payment_status: 'paid' });
    h.db.tables.payments.push({ id: 'pay-0', order_id: 'ZZ-TEST-appr', status: 'succeeded', amount_cents: 5000 });
    addOther(h, 'confirmed');
    const r = await life(h, ANON_KEY, 'customer_approval_already_paid', 'already_paid', { invoiceToken: tokenFor('p-ZZ-TEST-appr') });
    ok('customer approval of an edited, already-paid order with an overlap: refused; deposit and ledger untouched', r.status === 400 && r.json.code === 'AVAILABILITY_CONFLICT' && order(h).status === 'awaiting_customer_approval' && order(h).deposit_paid_cents === 5000 && h.db.tables.payments.length === 1 && !order(h).customer_approved_at);
  }
  // 6. Event Essentials
  {
    const h = fixture();
    h.db.tables.order_items.push({ id: 'zi-ee', order_id: 'ZZ-TEST-appr', unit_id: null, product_id: PROD, bundle_id: null, qty: 5 });
    h.db.rpcResults.check_product_availability = [{ product_id: PROD, product_name: 'ZZ TEST Tables', is_allowed: false, quantity_requested: 5, available_before_request: 2 }];
    const r = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok('Event Essentials quantities insufficient: NOT confirmed, message names the item with need/available', r.status === 400 && r.json.code === 'AVAILABILITY_CONFLICT' && /ZZ TEST Tables \(need 5, 2 available\)/.test(String(r.json.error)) && nothingWritten(h));
    const h1 = fixture();
    h1.db.tables.order_items.push({ id: 'zi-ee', order_id: 'ZZ-TEST-appr', unit_id: null, product_id: PROD, bundle_id: null, qty: 2 });
    h1.db.rpcResults.check_product_availability = [{ product_id: PROD, product_name: 'ZZ TEST Tables', is_allowed: true, quantity_requested: 2, available_before_request: 9 }];
    const r1 = await life(h1, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok('Event Essentials sufficient: confirms', r1.status === 200 && order(h1).status === 'confirmed' && conflictRows(h1).length === 0);
  }
  // 7. availability cannot be verified: fail safely, require review, never silently approve
  {
    const h = fixture();
    h.db.tables.order_items.push({ id: 'zi-ee', order_id: 'ZZ-TEST-appr', unit_id: null, product_id: PROD, bundle_id: null, qty: 2 });
    const r = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok('availability check unanswered (EE): NOT confirmed, AVAILABILITY_UNVERIFIABLE, asks for review, nothing written', r.status === 400 && r.json.code === 'AVAILABILITY_UNVERIFIABLE' && /review/.test(String(r.json.error)) && nothingWritten(h));
    ok('...recorded as an unverified history row and the Admin is told', h.db.tables.order_changelog.filter((c) => c.change_type === AVAILABILITY_UNVERIFIED_CHANGE_TYPE && c.new_value === 'blocked').length === 1 && adminSms(h).some((m) => /availability could not be verified/.test(m)));
    const smsBefore = adminSms(h).length;
    await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    eq('a retry of the same blocked situation adds no second history row and no second Admin alert', [h.db.tables.order_changelog.filter((c) => c.change_type === AVAILABILITY_UNVERIFIED_CHANGE_TYPE).length, adminSms(h).length], [1, smsBefore]);
    // once the check can be answered the same order confirms (the block is not sticky)
    h.db.rpcResults.check_product_availability = [{ product_id: PROD, product_name: 'ZZ TEST Tables', is_allowed: true, quantity_requested: 2, available_before_request: 9 }];
    const r2 = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok('...and once availability is verifiable the same order confirms', r2.status === 200 && order(h).status === 'confirmed');
    // unverifiable on an order whose status someone else already wrote: warn, never undone
    const h2 = fixture();
    order(h2).status = 'confirmed';
    h2.db.tables.order_items.push({ id: 'zi-ee', order_id: 'ZZ-TEST-appr', unit_id: null, product_id: PROD, bundle_id: null, qty: 2 });
    const r3 = await life(h2, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok('unverifiable on an already-confirmed order: stays confirmed, an unverified row and a CHECK STOCK note reach the Admin', r3.status === 200 && order(h2).status === 'confirmed' && h2.db.tables.order_changelog.some((c) => c.change_type === AVAILABILITY_UNVERIFIED_CHANGE_TYPE) && adminSms(h2).some((m) => /availability could not be verified/.test(m)));
  }
  {
    // a conflict is not sticky either: the other order is cancelled, the same confirmation then succeeds
    const h = fixture();
    addOther(h, 'confirmed');
    const first = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    h.db.tables.orders.find((o) => o.id === 'ZZ-TEST-other-confirmed')!.status = 'cancelled';
    const second = await life(h, 'jwt-admin', 'admin_approve_zero_deposit', 'waived');
    ok('after the conflicting order is cancelled the same confirmation succeeds', first.status === 400 && second.status === 200 && order(h).status === 'confirmed');
  }
  {
    // refusals are unchanged: a deposit still owed is refused before any availability work
    const h = fixture();
    Object.assign(order(h), { deposit_due_cents: 5000, deposit_paid_cents: 0 });
    addOther(h, 'confirmed');
    const r = await life(h, ANON_KEY, 'customer_approval_already_paid', 'already_paid', { invoiceToken: tokenFor('p-ZZ-TEST-appr') });
    ok('refusal unchanged: uncollected deposit still refused before availability, no history row', r.status === 400 && !r.json.code && order(h).status === 'awaiting_customer_approval' && conflictRows(h).length === 0);
  }

  // ---- source-level scans (labelled: not UI/integration tests) ----
  {
    const src = read('supabase/functions/order-lifecycle/index.ts');
    const gate = src.indexOf('confirmAvailabilityBlocks(paymentOutcome, order.status)');
    ok('source-level: the blocking check runs after the deposit guard and BEFORE the waived marker, the status write and the changelog', gate > src.indexOf('Safety guard: never confirm an order that still has an uncollected deposit') && gate < src.indexOf('A waived deposit: when a signed-in admin approves') && gate < src.indexOf('.update({ status: "confirmed", ...approvedAtPatch })'));
    ok('source-level: a refusal returns before any write (it precedes the waived marker update)', src.indexOf('return await refuseConfirmationForAvailability(') < src.indexOf('stripe_payment_status: "paid" })'));
    ok('source-level: order-lifecycle holds no Stripe charge code (payment code untouched)', !/stripe\.(paymentIntents|charges)/.test(src));
    const helper = read('supabase/functions/_shared/booking/orderConfirmAvailability.ts');
    ok('source-level: the helper makes no writes and imports no payment code', !/\.(insert|update|delete|upsert)\(/.test(helper) && !/stripe/i.test(helper.replace(/\/\/.*$/gm, '')));
    const hook = read('supabase/functions/stripe-webhook/handlers.ts');
    const hookCode = hook.replace(/\/\/.*$/gm, '');
    ok('source-level: both setup webhooks leave the Admin Invoice "confirmed" write to order-lifecycle (card still stored), report the already-paid / zero-due outcome and never charged_now', hookCode.split('...(plan.writeStatus ? { status: plan.writeStatus } : {})').length === 3 && hookCode.split('planSetupConfirmation({ isAdminInvoice, principalOutstanding, currentStatus, depositDue })').length === 3 && hookCode.split('_admin_invoice", plan.outcome, currentStatus)').length === 3 && !/charged_now/.test(hookCode) && /stripe_payment_method_id: actualPaymentMethodId/.test(hook) && /stripe_payment_method_id: paymentMethodId/.test(hook));
    ok('source-level: the webhook still calls enter_confirmed for the invoice and enter_pending_review otherwise', /"enter_confirmed", orderId, "webhook_setup_session_admin_invoice"/.test(hook) && /"enter_pending_review", orderId, "webhook_setup_session_checkout"/.test(hook));
    const charge = read('supabase/functions/charge-deposit/index.ts');
    ok('source-level: charge-deposit availability validation still present (ITEMS_UNAVAILABLE, AVAILABILITY_UNVERIFIABLE, inflatable loop, 503 on error)', /ITEMS_UNAVAILABLE/.test(charge) && /AVAILABILITY_UNVERIFIABLE/.test(charge) && /Availability check error/.test(charge) && /BLOCKED_STATUSES/.test(charge));
  }

  console.log(`Order confirm availability tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} order confirm availability test(s) failed`);
})().catch((e) => { console.error(e); process.exit(1); });
