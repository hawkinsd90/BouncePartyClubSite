// Allocation-aware refund reservation: reserve_refund_allocation against the scratch PostgreSQL database (see paymentHarness.ts).
// The real function, real tables, real locks; no Stripe and no Edge Function is involved (the provider side is simulated by
// setting the provider fields the way the existing result recorder does).
//
//   - an allocation is accepted only within what each ORIGINAL payment can still return, component by component;
//   - pending and succeeded refunds use capacity, failed ones release it; refunds of unknown composition are never ignored;
//   - the same operation key resumes the same rows; any other request under a used key is refused;
//   - a refused request leaves nothing behind; concurrent requests cannot oversubscribe a payment (real concurrent sessions);
//   - the amount-only reservation the deployed refund function calls keeps working, and an operation it made stays recoverable;
//   - nothing here changes an order's operational money columns or starts a charge.
//
// With no reachable scratch database the file is SKIPPED (ROLE_DB_REQUIRE=1 makes that a failure).
// Run: node node_modules/jiti/bin/jiti.js src/lib/refundAllocation.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const process: { env: Record<string, string | undefined>; pid: number };
declare const require: (id: string) => any;

import { PgPool, ensurePayDatabase, psqlArgs, PAY_MIGRATION_6, PAY_MIGRATION_7 } from '../support/paymentHarness';

const { spawnSync } = require('child_process');
const fs = require('fs');

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
const nextId = () => `dddddddd-0000-4000-8000-${TAG}${String(++counter).padStart(3, '0')}`;
const CREW = `cccccccc-0000-4000-8000-${TAG}c13`;
const CUST = `cccccccc-0000-4000-8000-${TAG}c14`;
const ADMIN = `cccccccc-0000-4000-8000-${TAG}c11`;
let piCounter = 0;
let reCounter = 0;
let keyCounter = 0;
const newKey = (l = 'alloc') => `${l}-${TAG}-${String(++keyCounter).padStart(4, '0')}`;
const LOCK = 616161;

(async () => {
  const db = ensurePayDatabase();
  if (!db) {
    if (process.env.ROLE_DB_REQUIRE) ok('executed: the scratch database is available (ROLE_DB_REQUIRE is set)', false);
    else console.log('Refund allocation tests SKIPPED: the scratch database was not reachable.');
    finish();
    return;
  }
  const pg = new PgPool(db.psql, db.db, 10);
  const createdOrders: string[] = [];
  const NL = String.fromCharCode(10);
  const asRole = (role: string, uid: string | null, sql: string): string => {
    const script = `BEGIN;
GRANT SELECT ON public.payments, public.order_refunds, public.orders TO service_role;
SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', true);
SELECT set_config('request.jwt.claim.role', '${role}', true);
SET LOCAL ROLE ${role};
SELECT 'R|' || COALESCE((${sql})::text, 'NULL');
ROLLBACK;`;
    const p = spawnSync(db.psql, [...psqlArgs(db.db)], { input: script, encoding: 'utf8' });
    const line = String(p.stdout ?? '').split(NL).find((l: string) => l.startsWith('R|'));
    if (line) return line.slice(2).trim();
    return /permission denied/i.test(String(p.stderr)) ? 'DENIED' : `ERR:${String(p.stderr).trim().split(NL)[0]}`;
  };
  const net = (orderId: string): any => {
    try { return JSON.parse(asRole('service_role', null, `public.order_net_financials('${orderId}')`)); } catch { return null; }
  };

  for (const [id, k, role] of [[ADMIN, 'c11', 'admin'], [CREW, 'c13', 'crew'], [CUST, 'c14', 'customer']] as const) {
    await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${id}', 'alloc-${TAG}-${k}@example.test') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_roles (user_id, role) VALUES ('${id}', '${role}');`);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------------------------------------------
  async function newOrder(): Promise<string> {
    const id = nextId();
    createdOrders.push(id);
    await pg.exec(`INSERT INTO public.orders (id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents)
      VALUES ('${id}', 'confirmed', 'residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 'next_day', 60000, 25661, 34339);`);
    return id;
  }
  interface PayOpts { method?: 'card' | 'cash' | 'check'; dep?: number; bal?: number; tip?: number; classified?: boolean; status?: string; amount?: number }
  async function addPay(orderId: string, o: PayOpts): Promise<{ id: string; pi: string | null }> {
    const id = nextId();
    const method = o.method ?? 'card';
    const pi = method === 'card' ? `pi_alloc_${TAG}_${++piCounter}` : null;
    const classified = o.classified !== false;
    const dep = o.dep ?? 0, bal = o.bal ?? 0, tip = o.tip ?? 0;
    const amount = classified ? dep + bal + tip : (o.amount as number);
    const comps = classified ? `${dep + bal}, ${tip}, ${dep}, ${bal}` : 'NULL, NULL, NULL, NULL';
    await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, stripe_payment_intent_id, paid_at, payment_method,
        principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, order_financials_applied)
      VALUES ('${id}', '${orderId}', '${dep > 0 ? 'deposit' : 'balance'}', ${amount}, '${o.status ?? 'succeeded'}', ${pi ? `'${pi}'` : 'NULL'}, now(), '${method}', ${comps}, true);`);
    ok(`fixture: the ${method} payment row was accepted`, (await pg.query(`SELECT 1 AS x FROM public.payments WHERE id = '${id}'`)).length === 1);
    return { id, pi };
  }
  // A refund row as the amount-only functions leave it (no allocation columns).
  async function addLegacyRefund(orderId: string, o: { amount: number; status?: string; payId?: string | null; pi?: string | null; ledger?: 2 | null }): Promise<{ id: string; re: string | null }> {
    const id = nextId();
    const re = o.ledger === null ? null : `re_alloc_${TAG}_${++reCounter}`;
    await pg.exec(`INSERT INTO public.order_refunds (id, order_id, amount_cents, reason, status, ledger_version, stripe_refund_id, payment_id, stripe_payment_intent_id, source, updated_at)
      VALUES ('${id}', '${orderId}', ${o.amount}, 'legacy', '${o.status ?? 'succeeded'}', ${o.ledger === null ? 'NULL' : '2'}, ${re ? `'${re}'` : 'NULL'}, ${o.payId ? `'${o.payId}'` : 'NULL'}, ${o.pi ? `'${o.pi}'` : 'NULL'}, 'admin', now());`);
    ok('fixture: the legacy refund row was accepted', (await pg.query(`SELECT 1 AS x FROM public.order_refunds WHERE id = '${id}'`)).length === 1);
    return { id, re };
  }
  type Line = { paymentId: string; depositPrincipalCents: number; balancePrincipalCents: number; tipCents: number };
  const line = (paymentId: string, d: number, b: number, t: number): Line => ({ paymentId, depositPrincipalCents: d, balancePrincipalCents: b, tipCents: t });
  const callSql = (order: string, key: string, lines: unknown, expected: number | null = null, actor: string | null = null) =>
    `SELECT public.reserve_refund_allocation('${order}', '${key}', $j$${JSON.stringify(lines)}$j$::jsonb, 'test', ${actor ? `'${actor}'` : 'NULL'}, ${expected === null ? 'NULL' : expected}) AS j`;
  const reserve = async (order: string, key: string, lines: unknown, expected: number | null = null): Promise<any> => {
    const r = await pg.query(callSql(order, key, lines, expected), true);
    return r[0]?.j ?? r;
  };
  const oldReserve = async (order: string, key: string, amount: number): Promise<any> =>
    (await pg.query(`SELECT public.reserve_refund_operation('${order}', '${key}', ${amount}, 'test', NULL) AS j`, true))[0]?.j;
  const rowsOf = async (key: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.order_refunds t WHERE operation_key = '${key}' ORDER BY operation_index`)).map((r: any) => r.j);
  const rowCount = async (orderId: string) => Number((await pg.query(`SELECT count(*) AS n FROM public.order_refunds WHERE order_id = '${orderId}'`))[0].n);
  const orderRow = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.orders t WHERE id = '${id}'`))[0].j;
  // The provider side of a reservation: the existing recorder gives the row its provider id.
  const markSent = async (key: string) => { await pg.exec(`UPDATE public.order_refunds SET stripe_refund_id = 're_sent_' || id::text WHERE operation_key = '${key}' AND stripe_refund_id IS NULL;`); };
  const event = async (re: string, pi: string | null, amount: number, status: string, rowId: string | null) =>
    (await pg.query(`SELECT public.apply_provider_refund_event('${re}', ${pi ? `'${pi}'` : 'NULL'}, ${amount}, '${status}', NULL, NULL, ${rowId ? `'${rowId}'` : 'NULL'}) AS j`, true))[0].j;
  const comps = (rows: any[]) => rows.map((r) => [r.deposit_principal_refunded_cents, r.balance_principal_refunded_cents, r.tip_refunded_cents, r.amount_cents]);

  // A payment shaped like the policy example: deposit principal 256.61, tip 51.32 (total 307.93), plus balance principal.
  const standard = async (order: string) => addPay(order, { dep: 25661, bal: 10000, tip: 5132 });

  // =================================================================================================================
  // 1. Valid allocations
  // =================================================================================================================
  {
    const order = await newOrder();
    const p = await standard(order);
    const before = await orderRow(order);
    const key = newKey();
    const r = await reserve(order, key, [line(p.id, 7500, 0, 2500)], 10000);
    eq('valid: the policy example (deposit 75.00 + tip 25.00) is reserved', [r.outcome, r.refunds?.length], ['reserved', 1]);
    const rows = await rowsOf(key);
    eq('valid: one pending row for $100 carrying the allocation, linked to the original payment and its PaymentIntent', rows.map((x: any) => [x.status, x.amount_cents, x.payment_id, x.stripe_payment_intent_id, x.allocation_version, x.deposit_principal_refunded_cents, x.balance_principal_refunded_cents, x.tip_refunded_cents, x.unclassified_refunded_cents, x.request_amount_cents, x.ledger_version]), [['pending', 10000, p.id, p.pi, 1, 7500, 0, 2500, 0, 10000, 2]]);
    ok('valid: the row has the stable idempotency key and the canonical request identity', rows[0].provider_idempotency_key === `refund:${key}:0` && rows[0].request_allocation === `v1|total=10000|${p.id}:7500:0:2500` && r.request_allocation === rows[0].request_allocation);
    ok('valid: the result carries the refund rows with their components for the provider step', r.refunds?.[0]?.deposit_principal_refunded_cents === 7500 && r.refunds?.[0]?.tip_refunded_cents === 2500 && r.refunds?.[0]?.payment_id === p.id);
    const pend = net(order);
    eq('valid: pending does NOT reduce the net figures but reserves', [pend.known_net_deposit_principal_cents, pend.known_net_tips_cents, pend.recorded_net_cash_retained_cents, pend.pending_refund_reservations_cents], [25661, 5132, 40793, 10000]);
    ok('valid: the order\'s money columns were not touched', JSON.stringify(await orderRow(order)) === JSON.stringify(before));
    // the existing webhook function settles it; repeating it changes nothing
    const re = `re_set_${TAG}_1`;
    const done = await event(re, p.pi, 10000, 'succeeded', rows[0].id);
    eq('valid: settlement through the existing webhook function succeeds and applies once', [done.outcome, done.applied_now], ['succeeded', true]);
    const again = await event(re, p.pi, 10000, 'succeeded', rows[0].id);
    eq('valid: a repeated webhook applies nothing again', [again.outcome, again.applied_now], ['unchanged', false]);
    const n = net(order);
    eq('valid: after success the example gives net deposit 181.61, net tip 26.32, net recorded 307.93 (this payment also holds 100.00 of balance principal, so the payment is 407.93 before the refund)', [n.known_net_deposit_principal_cents, n.known_net_tips_cents, n.recorded_net_cash_retained_cents], [18161, 2632, 30793]);
    ok('valid: exact figures are available and the single negative copy is backed (never subtracted twice)', n.classification_complete === true && n.unbacked_refund_copy_cents === 0 && n.refund_copy_cents === 10000 && n.total_succeeded_refunds_cents === 10000);
    const afterRow = await orderRow(order);
    eq('valid: the operational order columns are still untouched after settlement (only the existing refund total moved, once)', [['deposit_due_cents', 'deposit_paid_cents', 'balance_due_cents', 'balance_paid_cents', 'tip_cents', 'stripe_payment_status', 'status'].map((k: string) => afterRow[k]), afterRow.total_refunded_cents], [['deposit_due_cents', 'deposit_paid_cents', 'balance_due_cents', 'balance_paid_cents', 'tip_cents', 'stripe_payment_status', 'status'].map((k: string) => (before as any)[k]), 10000]);
  }
  {
    // single components and combinations
    const cases: Array<[string, [number, number, number]]> = [
      ['deposit principal only', [5000, 0, 0]],
      ['balance principal only', [0, 4000, 0]],
      ['tip only', [0, 0, 3000]],
      ['deposit + tip', [7500, 0, 2500]],
      ['balance + tip', [0, 4000, 1500]],
      ['deposit + balance + tip', [1000, 2000, 3000]],
    ];
    for (const [label, [d, b, t]] of cases) {
      const order = await newOrder();
      const p = await standard(order);
      const key = newKey();
      const r = await reserve(order, key, [line(p.id, d, b, t)]);
      const rows = await rowsOf(key);
      eq(`valid: ${label}`, [r.outcome, comps(rows)], ['reserved', [[d, b, t, d + b + t]]]);
    }
    // the whole payment
    const order = await newOrder();
    const p = await standard(order);
    const full = await reserve(order, newKey(), [line(p.id, 25661, 10000, 5132)]);
    eq('valid: the full original payment can be refunded in one allocation', [full.outcome, full.refunds?.[0]?.amount_cents], ['reserved', 40793]);
    await pg.exec(`UPDATE public.order_refunds SET stripe_refund_id = 're_full_${TAG}' WHERE order_id = '${order}';`);
    const more = await reserve(order, newKey(), [line(p.id, 1, 0, 0)]);
    eq('valid: once everything is reserved, one more cent is refused', more.outcome, 'total_capacity_exceeded');
  }
  {
    // several partial refunds from one payment; capacity falls by exactly what each takes; exact exhaustion; one cent over
    const order = await newOrder();
    const p = await addPay(order, { dep: 10000, tip: 2000 });
    const k1 = newKey(); const k2 = newKey(); const k3 = newKey();
    eq('partials: first (dep 4000 + tip 500)', (await reserve(order, k1, [line(p.id, 4000, 0, 500)])).outcome, 'reserved');
    await markSent(k1);
    eq('partials: second (dep 3000 + tip 1000)', (await reserve(order, k2, [line(p.id, 3000, 0, 1000)])).outcome, 'reserved');
    await markSent(k2);
    const over = await reserve(order, k3, [line(p.id, 3001, 0, 0)]);
    eq('partials: one cent over the remaining deposit principal is refused, naming the deposit component and what is left', [over.outcome, over.remaining_cents], ['deposit_capacity_exceeded', 3000]);
    const overTip = await reserve(order, k3, [line(p.id, 0, 0, 501)]);
    eq('partials: one cent over the remaining tip is refused', [overTip.outcome, overTip.remaining_cents], ['tip_capacity_exceeded', 500]);
    const exact = await reserve(order, k3, [line(p.id, 3000, 0, 500)]);
    eq('partials: asking for exactly what is left is accepted (capacity exactly exhausted)', exact.outcome, 'reserved');
    await markSent(k3);
    const none = await reserve(order, newKey(), [line(p.id, 1, 0, 0)]);
    eq('partials: nothing is left after that', none.outcome, 'total_capacity_exceeded');
    const balOnly = await reserve(order, newKey(), [line(p.id, 0, 1, 0)]);
    eq('partials: a payment with no balance principal cannot refund balance principal', balOnly.outcome, 'total_capacity_exceeded');
  }
  {
    // balance capacity specifically (total capacity not the limiting factor)
    const order = await newOrder();
    const p = await addPay(order, { dep: 5000, bal: 3000, tip: 2000 });
    const r = await reserve(order, newKey(), [line(p.id, 0, 3001, 0)]);
    eq('capacity: balance principal above the payment\'s balance principal is refused even though total capacity remains', [r.outcome, r.remaining_cents], ['balance_capacity_exceeded', 3000]);
    const t = await reserve(order, newKey(), [line(p.id, 0, 0, 2001)]);
    eq('capacity: tip above the payment\'s tip is refused even though principal remains', [t.outcome, t.remaining_cents], ['tip_capacity_exceeded', 2000]);
    const d = await reserve(order, newKey(), [line(p.id, 5001, 0, 0)]);
    eq('capacity: deposit principal above the payment\'s deposit principal is refused', [d.outcome, d.remaining_cents], ['deposit_capacity_exceeded', 5000]);
    const tot = await reserve(order, newKey(), [line(p.id, 5000, 3000, 2001)]);
    eq('capacity: a total above the payment is refused', tot.outcome, 'total_capacity_exceeded');
  }

  // =================================================================================================================
  // 2. Several original payments
  // =================================================================================================================
  {
    const order = await newOrder();
    const p1 = await addPay(order, { dep: 25661, tip: 5132 });
    const p2 = await addPay(order, { bal: 10000 });
    const p3 = await addPay(order, { tip: 3000 });
    const key = newKey();
    const r = await reserve(order, key, [line(p1.id, 7500, 0, 2500), line(p2.id, 0, 4000, 0), line(p3.id, 0, 0, 3000)], 17000);
    const rows = await rowsOf(key);
    eq('payments: one operation spanning three original payments reserves one row per payment, in a fixed order', [r.outcome, rows.length], ['reserved', 3]);
    eq('payments: every row stays tied to its own payment and carries its own components', rows.map((x: any) => [x.payment_id, x.deposit_principal_refunded_cents, x.balance_principal_refunded_cents, x.tip_refunded_cents]).sort(), [[p1.id, 7500, 0, 2500], [p2.id, 0, 4000, 0], [p3.id, 0, 0, 3000]].sort());
    eq('payments: operation indexes are 0..2, every row has the same request total and identity', [rows.map((x: any) => x.operation_index), new Set(rows.map((x: any) => x.request_amount_cents)).size, new Set(rows.map((x: any) => x.request_allocation)).size], [[0, 1, 2], 1, 1]);
    eq('payments: the idempotency keys follow the operation key and index', rows.map((x: any) => x.provider_idempotency_key), [0, 1, 2].map((i) => `refund:${key}:${i}`));
    await markSent(key);
    // tip of payment 3 cannot be used to refund payment 2's tip
    const cross = await reserve(order, newKey(), [line(p2.id, 0, 0, 1)]);
    eq('payments: a payment with no tip cannot borrow another payment\'s tip', cross.outcome, 'tip_capacity_exceeded');
    const cross2 = await reserve(order, newKey(), [line(p3.id, 0, 1, 0)]);
    eq('payments: a tip-only payment cannot refund balance principal', cross2.outcome, 'total_capacity_exceeded');
    // each payment is enforced independently
    const ok2 = await reserve(order, newKey(), [line(p1.id, 0, 0, 2632), line(p2.id, 0, 6000, 0)]);
    eq('payments: remaining capacity of each payment is used independently', ok2.outcome, 'reserved');
  }

  // =================================================================================================================
  // 3. Invalid requests (and nothing is left behind)
  // =================================================================================================================
  {
    const order = await newOrder();
    const other = await newOrder();
    const p = await standard(order);
    const po = await standard(other);
    const pend = await addPay(order, { dep: 1000, status: 'pending' });
    const fail = await addPay(order, { dep: 1000, status: 'failed' });
    const unc = await addPay(order, { classified: false, amount: 5000 });
    const cash = await addPay(order, { method: 'cash', bal: 5000 });
    const n0 = await rowCount(order);
    const bad = async (label: string, lines: unknown, outcome: string, detail?: string, expected: number | null = null) => {
      const r = await reserve(order, newKey(), lines, expected);
      eq(`invalid: ${label}`, detail === undefined ? r.outcome : [r.outcome, r.detail], detail === undefined ? outcome : [outcome, detail]);
    };
    await bad('a negative component', [line(p.id, -1, 0, 100)], 'invalid_allocation', 'component_negative');
    await bad('a fractional component', [{ ...line(p.id, 100, 0, 0), depositPrincipalCents: 100.5 }], 'invalid_allocation', 'component_fractional');
    await bad('a component sent as text', [{ ...line(p.id, 100, 0, 0), tipCents: '100' }], 'invalid_allocation', 'component_missing');
    await bad('a missing component', [{ paymentId: p.id, depositPrincipalCents: 100, tipCents: 0 }], 'invalid_allocation', 'component_missing');
    await bad('a null component', [{ ...line(p.id, 100, 0, 0), balancePrincipalCents: null }], 'invalid_allocation', 'component_missing');
    await bad('an absurdly large component', [line(p.id, 100000000, 0, 0)], 'invalid_allocation', 'component_too_large');
    await bad('a missing payment id', [{ depositPrincipalCents: 100, balancePrincipalCents: 0, tipCents: 0 }], 'invalid_allocation', 'payment_id_invalid');
    await bad('a payment id that is not a UUID', [line('not-a-uuid', 100, 0, 0)], 'invalid_allocation', 'payment_id_invalid');
    await bad('an unknown field', [{ ...line(p.id, 100, 0, 0), note: 'x' }], 'invalid_allocation', 'unknown_field');
    await bad('a zero-total request', [line(p.id, 0, 0, 0)], 'invalid_allocation', 'zero_line');
    await bad('an empty list', [], 'invalid_allocation', 'allocations_required');
    await bad('something that is not a list', { paymentId: p.id }, 'invalid_allocation', 'allocations_required');
    await bad('a line that is not an object', [5], 'invalid_allocation', 'line_not_an_object');
    await bad('the same payment twice (refused, never silently merged)', [line(p.id, 100, 0, 0), line(p.id, 0, 0, 100)], 'invalid_allocation', 'duplicate_payment');
    await bad('the same payment twice in different letter case', [line(p.id, 100, 0, 0), line(p.id.toUpperCase(), 0, 0, 100)], 'invalid_allocation', 'duplicate_payment');
    await bad('a browser total that disagrees with the lines', [line(p.id, 100, 0, 100)], 'invalid_allocation', 'total_mismatch', 150);
    await bad('a payment that does not exist', [line(nextId(), 100, 0, 0)], 'payment_not_found');
    await bad('a payment of another order', [line(po.id, 100, 0, 0)], 'payment_wrong_order');
    await bad('a pending original payment', [line(pend.id, 100, 0, 0)], 'payment_not_succeeded');
    await bad('a failed original payment', [line(fail.id, 100, 0, 0)], 'payment_not_succeeded');
    await bad('a cash payment (not refundable here)', [line(cash.id, 0, 100, 0)], 'payment_not_refundable');
    await bad('an unclassified original payment', [line(unc.id, 100, 0, 0)], 'unclassified_payment');
    ok('invalid: an error about another order\'s payment says nothing else about it', JSON.stringify(await reserve(order, newKey(), [line(po.id, 100, 0, 0)])) === JSON.stringify({ outcome: 'payment_wrong_order' }));
    // midway: line one is fine, line two is not; nothing may remain
    const midKey = newKey();
    const mid = await reserve(order, midKey, [line(p.id, 100, 0, 0), line(unc.id, 100, 0, 0)]);
    eq('midway: a request whose second line is refused is refused as a whole', mid.outcome, 'unclassified_payment');
    eq('midway: ...and left no reservation row behind (also none under that key)', [await rowCount(order), (await rowsOf(midKey)).length], [n0, 0]);
    const mid2 = await reserve(order, midKey, [line(p.id, 100, 0, 0), line(p.id === unc.id ? p.id : (await addPay(order, { dep: 500 })).id, 99999, 0, 0)]);
    eq('midway: a second line over its capacity also leaves nothing, and the key is still free', [mid2.outcome, await rowCount(order), (await rowsOf(midKey)).length], ['total_capacity_exceeded', n0, 0]);
    const free = await reserve(order, midKey, [line(p.id, 100, 0, 0)]);
    eq('midway: the same key can then be used for a valid request', free.outcome, 'reserved');
  }

  // =================================================================================================================
  // 4. Historical refunds of unknown composition
  // =================================================================================================================
  {
    const order = await newOrder();
    const p = await addPay(order, { dep: 10000, tip: 2000 });
    await addLegacyRefund(order, { amount: 5000, status: 'succeeded', payId: p.id, pi: p.pi });
    const fits = await reserve(order, newKey(), [line(p.id, 5000, 0, 0)]);
    eq('history: what is CERTAINLY still there (deposit 10000 - the unknown 5000) can be refunded', fits.outcome, 'reserved');
    await pg.exec(`UPDATE public.order_refunds SET stripe_refund_id = 're_h1_${TAG}' WHERE order_id = '${order}' AND operation_key IS NOT NULL;`);
    const amb = await reserve(order, newKey(), [line(p.id, 1, 0, 0)]);
    eq('history: more than that is ambiguous (the unknown refund may have taken it), not silently allowed', [amb.outcome, amb.unclassified_refunded_cents], ['ambiguous_historical_refund', 5000]);
    const ambTip = await reserve(order, newKey(), [line(p.id, 0, 0, 1)]);
    eq('history: the tip is just as unprovable', ambTip.outcome, 'ambiguous_historical_refund');
    const rows = await pg.query(`SELECT allocation_version, deposit_principal_refunded_cents FROM public.order_refunds WHERE order_id = '${order}' AND operation_key IS NULL`);
    ok('history: the historical refund row was not rewritten or classified', rows.length === 1 && rows[0].allocation_version === null && rows[0].deposit_principal_refunded_cents === null);
    const n = net(order);
    ok('history: it stays unclassified in the net figures (no exact net principal)', n.unclassified_succeeded_refunds_cents === 5000 && n.net_principal_exact_cents === null);

    const o2 = await newOrder();
    const p2 = await addPay(o2, { dep: 10000, tip: 2000 });
    await addLegacyRefund(o2, { amount: 11000, status: 'pending', payId: p2.id, pi: p2.pi });
    const t = await reserve(o2, newKey(), [line(p2.id, 1001, 0, 0)]);
    eq('history: a pending unclassified refund uses capacity too (total 12000 - 11000 = 1000 left)', t.outcome, 'total_capacity_exceeded');
    const amb2 = await reserve(o2, newKey(), [line(p2.id, 1000, 0, 0)]);
    eq('history: and within the total, the unknown 11000 still blocks a component claim', amb2.outcome, 'ambiguous_historical_refund');

    const o3 = await newOrder();
    const p3 = await addPay(o3, { dep: 10000, tip: 2000 });
    await addLegacyRefund(o3, { amount: 3000, status: 'failed', payId: p3.id, pi: p3.pi });
    eq('history: a failed historical refund releases its capacity', (await reserve(o3, newKey(), [line(p3.id, 10000, 0, 2000)])).outcome, 'reserved');

    // the balance principal is just as unprovable
    const o6 = await newOrder();
    const p6 = await addPay(o6, { bal: 4000, tip: 1000 });
    await addLegacyRefund(o6, { amount: 3000, status: 'succeeded', payId: p6.id, pi: p6.pi });
    eq('history: balance principal beyond what is certainly there (4000 - unknown 3000) is ambiguous', (await reserve(o6, newKey(), [line(p6.id, 0, 1001, 0)])).outcome, 'ambiguous_historical_refund');
    eq('history: ...and 1000 of it is certain', (await reserve(o6, newKey(), [line(p6.id, 0, 1000, 0)])).outcome, 'reserved');

    // refunds never linked to a payment
    const o4 = await newOrder();
    const p4 = await addPay(o4, { dep: 10000, tip: 2000 });
    await addLegacyRefund(o4, { amount: 4000, status: 'succeeded', ledger: null });
    const u1 = await reserve(o4, newKey(), [line(p4.id, 6000, 0, 0)]);
    eq('history: with ONE refundable payment, an unlinked older refund belongs to it: the certain part can be refunded', u1.outcome, 'reserved');
    const o5 = await newOrder();
    const p5a = await addPay(o5, { dep: 10000 });
    await addPay(o5, { dep: 5000 });
    await addLegacyRefund(o5, { amount: 4000, status: 'succeeded', ledger: null });
    const u2 = await reserve(o5, newKey(), [line(p5a.id, 100, 0, 0)]);
    eq('history: with SEVERAL refundable payments an unlinked older refund cannot be attributed: refused', [u2.outcome, u2.detail], ['ambiguous_historical_refund', 'unlinked_refunds']);
  }

  // =================================================================================================================
  // 5. Operation identity: retries and conflicts
  // =================================================================================================================
  {
    const order = await newOrder();
    const p1 = await addPay(order, { dep: 25661, tip: 5132 });
    const p2 = await addPay(order, { bal: 10000 });
    const key = newKey();
    const a = await reserve(order, key, [line(p1.id, 7500, 0, 2500), line(p2.id, 0, 4000, 0)]);
    const before = await rowsOf(key);
    eq('identity: first request reserves', a.outcome, 'reserved');
    const same = await reserve(order, key, [line(p1.id, 7500, 0, 2500), line(p2.id, 0, 4000, 0)]);
    eq('identity: the identical request resumes the same operation', [same.outcome, same.refunds?.map((x: any) => x.id)], ['existing', before.map((x: any) => x.id)]);
    const reordered = await reserve(order, key, [line(p2.id, 0, 4000, 0), line(p1.id, 7500, 0, 2500)]);
    eq('identity: the same lines in another order resume the same operation', [reordered.outcome, reordered.request_allocation], ['existing', same.request_allocation]);
    const upper = await reserve(order, key, [{ ...line(p2.id.toUpperCase(), 0, 4000, 0) }, line(p1.id, 7500, 0, 2500)]);
    eq('identity: the same ids in another letter case are the same request', upper.outcome, 'existing');
    eq('identity: retries created no rows and rewrote nothing', JSON.stringify(await rowsOf(key)), JSON.stringify(before));
    const conflicts: Array<[string, Line[]]> = [
      ['a changed payment id', [line(p1.id, 7500, 0, 2500), line((await addPay(order, { bal: 4000 })).id, 0, 4000, 0)]],
      ['a changed deposit amount', [line(p1.id, 7501, 0, 2500), line(p2.id, 0, 4000, 0)]],
      ['a changed balance amount', [line(p1.id, 7500, 0, 2500), line(p2.id, 0, 3999, 0)]],
      ['a changed tip amount', [line(p1.id, 7500, 0, 2499), line(p2.id, 0, 4000, 0)]],
      ['a changed total (an extra line)', [line(p1.id, 7500, 0, 2500), line(p2.id, 0, 4000, 0), line((await addPay(order, { tip: 100 })).id, 0, 0, 100)]],
      ['a moved amount (same total, other component)', [line(p1.id, 7500, 2500, 0), line(p2.id, 0, 4000, 0)]],
      ['a dropped line', [line(p1.id, 7500, 0, 2500)]],
    ];
    for (const [label, lines] of conflicts) {
      const r = await reserve(order, key, lines);
      eq(`identity: ${label} under the same key is refused`, [r.outcome, r.detail], ['key_conflict', 'allocation_changed']);
    }
    eq('identity: no conflict attempt changed the reserved rows', JSON.stringify(await rowsOf(key)), JSON.stringify(before));
    const other = await newOrder();
    const po = await addPay(other, { dep: 5000 });
    eq('identity: the key cannot be used on another order', (await reserve(other, key, [line(po.id, 100, 0, 0)])).outcome, 'key_conflict');
    // a new key while this one is unresolved
    const k2 = newKey();
    const blocked = await reserve(order, k2, [line(p1.id, 100, 0, 0)]);
    eq('identity: a new key while an earlier operation is unresolved is refused, naming the earlier one', [blocked.outcome, blocked.operation_key, blocked.request_amount_cents], ['unsettled_operation', key, 14000]);
    eq('identity: ...and reserved nothing', (await rowsOf(k2)).length, 0);
    // after the provider attempt marker the operation still resumes and keeps its attempt time
    const row0 = before[0];
    const marked = (await pg.query(`SELECT public.mark_refund_provider_attempt('${row0.id}') AS j`, true))[0].j;
    const stamp = (await rowsOf(key))[0].provider_attempted_at;
    const afterMark = await reserve(order, key, [line(p2.id, 0, 4000, 0), line(p1.id, 7500, 0, 2500)]);
    eq('identity: after the provider-attempt marker the same request still resumes, with the marker intact', [marked, afterMark.outcome, afterMark.refunds?.[0]?.provider_attempted_at === stamp, stamp !== null], [true, 'existing', true, true]);
    // the old amount-only function resumes an operation made here (same total), so a not-yet-updated caller can still recover it
    const viaOld = await oldReserve(order, key, 14000);
    eq('identity: the amount-only reservation function resumes an allocation-aware operation of the same total', [viaOld.outcome, viaOld.refunds?.length], ['existing', 2]);
    const viaOldWrong = await oldReserve(order, key, 13999);
    eq('identity: ...and refuses a different total under that key', viaOldWrong.outcome, 'key_conflict');
  }
  {
    // an operation made by the amount-only reservation (as before this change)
    const order = await newOrder();
    const p = await standard(order);
    const key = newKey();
    const first = await oldReserve(order, key, 3000);
    eq('compat: the amount-only reservation still reserves', first.outcome, 'reserved');
    const oldRow = (await rowsOf(key))[0];
    eq('compat: ...with no allocation recorded (it stays unclassified, nothing is invented)', [oldRow.allocation_version, oldRow.deposit_principal_refunded_cents, oldRow.request_allocation], [null, null, null]);
    const resumed = await oldReserve(order, key, 3000);
    eq('compat: an amount-only operation is resumed by its key exactly as before', [resumed.outcome, resumed.refunds?.map((x: any) => x.id)], ['existing', [oldRow.id]]);
    const conflict = await reserve(order, key, [line(p.id, 3000, 0, 0)]);
    eq('compat: an allocation can never be attached to an amount-only operation', [conflict.outcome, conflict.detail], ['key_conflict', 'amount_only_operation']);
    eq('compat: ...and the row is untouched', JSON.stringify((await rowsOf(key))[0]), JSON.stringify(oldRow));
    const blocked = await reserve(order, newKey(), [line(p.id, 100, 0, 0)]);
    eq('compat: an unresolved amount-only operation also blocks a new allocation request', [blocked.outcome, blocked.operation_key], ['unsettled_operation', key]);
    // provider attempt + lost response: the existing recovery path (mark, result) is unchanged for it
    const marked = (await pg.query(`SELECT public.mark_refund_provider_attempt('${oldRow.id}') AS j`, true))[0].j;
    const res = (await pg.query(`SELECT public.record_refund_provider_result('${oldRow.id}', 're_old_${TAG}', 'succeeded', NULL) AS j`, true))[0].j;
    eq('compat: the existing marker and result recorder still work on an amount-only row', [marked, res.outcome], [true, 'succeeded']);
    // its three thousand cents are unclassified: a later allocation sees them
    const amb = await reserve(order, newKey(), [line(p.id, 25661, 0, 0)]);
    eq('compat: the amount-only refund is counted by a later allocation as unknown (it cannot be ignored)', amb.outcome, 'ambiguous_historical_refund');
    eq('compat: ...while the certain part is available', (await reserve(order, newKey(), [line(p.id, 22661, 0, 0)])).outcome, 'reserved');
  }

  // =================================================================================================================
  // 6. Expiry and recovery
  // =================================================================================================================
  {
    // an unsent amount-only reservation left for a quarter of an hour is released (as before)
    const order = await newOrder();
    const p = await standard(order);
    const oldKey = newKey();
    await oldReserve(order, oldKey, 2000);
    await pg.exec(`UPDATE public.order_refunds SET created_at = now() - interval '20 minutes' WHERE operation_key = '${oldKey}';`);
    const r = await reserve(order, newKey(), [line(p.id, 1000, 0, 0)]);
    eq('expiry: an unsent amount-only reservation older than 15 minutes is released and the new request goes through', r.outcome, 'reserved');
    eq('expiry: ...the old row is failed with the abandonment reason', (await rowsOf(oldKey)).map((x: any) => [x.status, x.failure_reason]), [['failed', 'abandoned before any provider request was made']]);

    // a reservation whose provider request may have started is NEVER released by age
    const o2 = await newOrder();
    const p2 = await standard(o2);
    const k = newKey();
    const res = await reserve(o2, k, [line(p2.id, 1000, 0, 500)]);
    const rid = res.refunds?.[0]?.id;
    await pg.query(`SELECT public.mark_refund_provider_attempt('${rid}') AS j`, true);
    await pg.exec(`UPDATE public.order_refunds SET created_at = now() - interval '2 hours' WHERE operation_key = '${k}';`);
    const blocked = await reserve(o2, newKey(), [line(p2.id, 100, 0, 0)]);
    eq('expiry: a reservation with a provider-attempt marker is not released by age; a new request is blocked by it', [blocked.outcome, blocked.operation_key], ['unsettled_operation', k]);
    eq('expiry: ...and it is still pending', (await rowsOf(k)).map((x: any) => x.status), ['pending']);
    // an unsent allocation reservation that is old is released too
    const o3 = await newOrder();
    const p3 = await standard(o3);
    const k3 = newKey();
    await reserve(o3, k3, [line(p3.id, 500, 0, 0)]);
    await pg.exec(`UPDATE public.order_refunds SET created_at = now() - interval '20 minutes' WHERE operation_key = '${k3}';`);
    eq('expiry: an old unsent allocation reservation is released for a new request', (await reserve(o3, newKey(), [line(p3.id, 500, 0, 0)])).outcome, 'reserved');
    eq('expiry: ...and its capacity is free again', (await rowsOf(k3)).map((x: any) => x.status), ['failed']);
  }
  {
    // a partly settled multi-payment operation
    const order = await newOrder();
    const p1 = await addPay(order, { dep: 10000, tip: 2000 });
    const p2 = await addPay(order, { bal: 8000 });
    const key = newKey();
    const lines = [line(p1.id, 3000, 0, 500), line(p2.id, 0, 2000, 0)];
    const r = await reserve(order, key, lines);
    const rows = await rowsOf(key);
    const forP1 = rows.find((x: any) => x.payment_id === p1.id);
    const forP2 = rows.find((x: any) => x.payment_id === p2.id);
    eq('partial operation: reserved', r.outcome, 'reserved');
    const s1 = await event(`re_pa1_${TAG}`, p1.pi, forP1.amount_cents, 'succeeded', forP1.id);
    const s2 = await event(`re_pa2_${TAG}`, p2.pi, forP2.amount_cents, 'failed', forP2.id);
    eq('partial operation: one line succeeds and the other fails through the existing webhook function', [s1.outcome, s2.outcome], ['succeeded', 'failed']);
    const retry = await reserve(order, key, lines);
    eq('partial operation: the same request still resumes the same rows, with their own statuses', [retry.outcome, retry.refunds?.map((x: any) => [x.payment_id === p1.id ? 'p1' : 'p2', x.status])], ['existing', rows.map((x: any) => [x.payment_id === p1.id ? 'p1' : 'p2', x.payment_id === p1.id ? 'succeeded' : 'failed'])]);
    const n = net(order);
    eq('partial operation: only the succeeded line reduced the net figures (deposit 3000, tip 500)', [n.known_net_deposit_principal_cents, n.known_net_tips_cents, n.known_net_balance_principal_cents, n.total_succeeded_refunds_cents], [7000, 1500, 8000, 3500]);
    const free = await reserve(order, newKey(), [line(p2.id, 0, 8000, 0)]);
    eq('partial operation: the failed line released its capacity, the other payment is unaffected', free.outcome, 'reserved');
    const used = await reserve(order, newKey(), [line(p1.id, 7001, 0, 0)]);
    eq('partial operation: the succeeded line keeps its capacity used', used.outcome === 'unsettled_operation' || used.outcome === 'deposit_capacity_exceeded', true);
    // failed refund releases, then a webhook for a failed row cannot revive it
    const late = await event(`re_pa2_${TAG}`, p2.pi, forP2.amount_cents, 'succeeded', forP2.id);
    eq('partial operation: a late success for the failed line is refused without changing it', late.outcome, 'invalid_transition');
    // repeated webhook for the succeeded line
    const rep = await event(`re_pa1_${TAG}`, p1.pi, forP1.amount_cents, 'succeeded', forP1.id);
    eq('partial operation: a repeated webhook for the succeeded line applies nothing twice', [rep.outcome, net(order).total_succeeded_refunds_cents], ['unchanged', 3500]);
  }

  // =================================================================================================================
  // 7. Real concurrency: simultaneous sessions released together
  // =================================================================================================================
  {
    const race = async (calls: string[]): Promise<any[]> => {
      const holder = new PgPool(db.psql, db.db, 1);
      await holder.exec(`SELECT pg_advisory_lock(${LOCK});`);
      const runs = calls.map((c) => pg.query(c + ` FROM (SELECT pg_advisory_xact_lock_shared(${LOCK})) g`, true));
      await new Promise((r) => setTimeout(r, 1500));
      await holder.exec(`SELECT pg_advisory_unlock(${LOCK});`);
      const res = await Promise.all(runs);
      holder.close();
      return res.map((r: any) => r[0]?.j ?? r);
    };
    for (let round = 0; round < 3; round++) {
      const order = await newOrder();
      const p = await addPay(order, { dep: 6000, tip: 5000 });
      const out = await race([1, 2, 3, 4].map(() => callSql(order, newKey(), [line(p.id, 0, 0, 3000)])));
      const reserved = out.filter((o) => o.outcome === 'reserved').length;
      const tipTotal = Number((await pg.query(`SELECT COALESCE(SUM(tip_refunded_cents), 0) AS s FROM public.order_refunds WHERE order_id = '${order}' AND status IN ('pending', 'succeeded')`))[0].s);
      eq(`concurrency (round ${round + 1}): four simultaneous requests for 3000 of a 5000 tip: exactly one is reserved, the rest are refused`, [reserved, out.filter((o) => o.outcome === 'unsettled_operation' || o.outcome === 'tip_capacity_exceeded').length], [1, 3]);
      ok(`concurrency (round ${round + 1}): the tip reserved never exceeds the payment's tip`, tipTotal <= 5000);
    }
    {
      const order = await newOrder();
      const p1 = await addPay(order, { dep: 5000 });
      const p2 = await addPay(order, { dep: 5000 });
      const out = await race([callSql(order, newKey(), [line(p1.id, 5000, 0, 0)]), callSql(order, newKey(), [line(p2.id, 5000, 0, 0)])]);
      const n = Number((await pg.query(`SELECT count(DISTINCT operation_key) AS n FROM public.order_refunds WHERE order_id = '${order}'`))[0].n);
      eq('concurrency: simultaneous requests against two payments of one order are serialized: one operation is created, the other sees it unsettled', [out.filter((o) => o.outcome === 'reserved').length, n], [1, 1]);
    }
    {
      // an earlier refund is pending while another is requested concurrently
      const order = await newOrder();
      const p = await addPay(order, { dep: 9000, tip: 1000 });
      const first = newKey();
      await reserve(order, first, [line(p.id, 1000, 0, 0)]);
      const out = await race([callSql(order, newKey(), [line(p.id, 1000, 0, 0)]), callSql(order, first, [line(p.id, 1000, 0, 0)])]);
      eq('concurrency: with an earlier refund pending, a new request is refused while the earlier key still resumes', [out.map((o) => o.outcome).sort()], [['existing', 'unsettled_operation']]);
      eq('concurrency: ...and exactly one operation exists', Number((await pg.query(`SELECT count(DISTINCT operation_key) AS n FROM public.order_refunds WHERE order_id = '${order}'`))[0].n), 1);
    }
    {
      // identical retries racing: one reservation, everyone gets the same rows
      const order = await newOrder();
      const p = await addPay(order, { dep: 9000, tip: 1000 });
      const key = newKey();
      const out = await race([1, 2, 3, 4].map(() => callSql(order, key, [line(p.id, 2000, 0, 500)])));
      eq('concurrency: four simultaneous identical requests reserve once and all return the same rows', [out.map((o) => o.outcome).sort(), (await rowsOf(key)).length], [['existing', 'existing', 'existing', 'reserved'], 1]);
    }
    {
      // capacity (not just the unsettled rule) across sequential operations whose provider ids are recorded
      const order = await newOrder();
      const p = await addPay(order, { dep: 4000, tip: 0 });
      let reservedTotal = 0;
      for (let i = 0; i < 6; i++) {
        const k = newKey();
        const r = await reserve(order, k, [line(p.id, 1000, 0, 0)]);
        if (r.outcome === 'reserved') { reservedTotal += 1000; await markSent(k); }
      }
      eq('concurrency: six sequential requests of 1000 against 4000 deposit principal reserve exactly four', reservedTotal, 4000);
    }
  }

  // =================================================================================================================
  // 8. Accounting compatibility and the order's money columns
  // =================================================================================================================
  {
    const order = await newOrder();
    const p = await standard(order);
    await pg.exec(`UPDATE public.orders SET deposit_paid_cents = 25661, balance_paid_cents = 10000, tip_cents = 5132, stripe_payment_status = 'paid' WHERE id = '${order}';`);
    const snap = async () => { const o = await orderRow(order); return ['deposit_due_cents', 'deposit_paid_cents', 'balance_due_cents', 'balance_paid_cents', 'tip_cents', 'stripe_payment_status', 'status'].map((k) => o[k]); };
    const before = await snap();
    const positiveBefore = Number((await pg.query(`SELECT count(*) AS n FROM public.payments WHERE order_id = '${order}' AND amount_cents > 0`))[0].n);
    const k1 = newKey(); const k2 = newKey(); const k3 = newKey();
    const r1 = await reserve(order, k1, [line(p.id, 6000, 0, 0)]);
    const row1 = (await rowsOf(k1))[0];
    eq('accounting: a pending deposit refund does not reduce net deposit principal', [net(order).known_net_deposit_principal_cents, net(order).pending_refund_reservations_cents], [25661, 6000]);
    await event(`re_ac1_${TAG}`, p.pi, 6000, 'succeeded', row1.id);
    eq('accounting: a succeeded deposit refund reduces net deposit principal only', [net(order).known_net_deposit_principal_cents, net(order).known_net_balance_principal_cents, net(order).known_net_tips_cents], [19661, 10000, 5132]);
    const r2 = await reserve(order, k2, [line(p.id, 0, 4000, 0)]);
    await event(`re_ac2_${TAG}`, p.pi, 4000, 'succeeded', (await rowsOf(k2))[0].id);
    eq('accounting: a succeeded balance refund reduces net balance principal only', [net(order).known_net_deposit_principal_cents, net(order).known_net_balance_principal_cents, net(order).known_net_tips_cents], [19661, 6000, 5132]);
    const r3 = await reserve(order, k3, [line(p.id, 0, 0, 1000)]);
    await event(`re_ac3_${TAG}`, p.pi, 1000, 'succeeded', (await rowsOf(k3))[0].id);
    const n = net(order);
    eq('accounting: a succeeded tip refund reduces net tips only', [n.known_net_deposit_principal_cents, n.known_net_balance_principal_cents, n.known_net_tips_cents, n.recorded_net_cash_retained_cents], [19661, 6000, 4132, 29793]);
    ok('accounting: exact figures are available and the three negative copies are backed, not subtracted again', n.classification_complete === true && n.unbacked_refund_copy_cents === 0 && n.refund_copy_cents === 11000 && n.total_succeeded_refunds_cents === 11000 && n.net_principal_exact_cents === 25661 && n.net_tips_exact_cents === 4132);
    eq('accounting: the reservations all succeeded', [r1.outcome, r2.outcome, r3.outcome], ['reserved', 'reserved', 'reserved']);
    eq('accounting: the operational money columns are exactly as before', await snap(), before);
    eq('accounting: no payment was created or charged (the number of positive payments is unchanged, none is pending)', [Number((await pg.query(`SELECT count(*) AS n FROM public.payments WHERE order_id = '${order}' AND amount_cents > 0`))[0].n), Number((await pg.query(`SELECT count(*) AS n FROM public.payments WHERE order_id = '${order}' AND status = 'pending'`))[0].n)], [positiveBefore, 0]);
    // failed refund releases capacity and never reduced anything
    const kf = newKey();
    const rf = await reserve(order, kf, [line(p.id, 0, 6000, 0)]);
    const rowF = (await rowsOf(kf))[0];
    const blocked = await reserve(order, newKey(), [line(p.id, 0, 1, 0)]);
    eq('accounting: while pending, the balance principal is reserved (unsettled blocks, nothing double-booked)', [rf.outcome, blocked.outcome], ['reserved', 'unsettled_operation']);
    await event(`re_acf_${TAG}`, p.pi, 6000, 'failed', rowF.id);
    const nf = net(order);
    eq('accounting: a failed refund reduced nothing', [nf.known_net_balance_principal_cents, nf.total_succeeded_refunds_cents], [6000, 11000]);
    eq('accounting: ...and released its capacity: the full remaining balance principal can be requested again', (await reserve(order, newKey(), [line(p.id, 0, 6000, 0)])).outcome, 'reserved');
    eq('accounting: the operational columns are still exactly as before', await snap(), before);
  }

  // =================================================================================================================
  // 9. Who may run it
  // =================================================================================================================
  {
    const order = await newOrder();
    const p = await addPay(order, { dep: 5000 });
    const call = `public.reserve_refund_allocation('${order}', '${newKey()}', '[{"paymentId":"${p.id}","depositPrincipalCents":100,"balancePrincipalCents":0,"tipCents":0}]'::jsonb, 'x')->>'outcome'`;
    eq('permissions: the trusted server role can reserve', asRole('service_role', null, call), 'reserved');
    eq('permissions: an authenticated browser session cannot call it', asRole('authenticated', ADMIN, call), 'DENIED');
    eq('permissions: a customer session cannot call it', asRole('authenticated', CUST, call), 'DENIED');
    eq('permissions: a crew session cannot call it', asRole('authenticated', CREW, call), 'DENIED');
    eq('permissions: an anonymous caller cannot call it', asRole('anon', null, call), 'DENIED');
    const g = (await pg.query(`SELECT has_function_privilege('anon','public.reserve_refund_allocation(uuid,text,jsonb,text,uuid,integer)','execute') AS anon, has_function_privilege('authenticated','public.reserve_refund_allocation(uuid,text,jsonb,text,uuid,integer)','execute') AS auth, has_function_privilege('service_role','public.reserve_refund_allocation(uuid,text,jsonb,text,uuid,integer)','execute') AS svc, (SELECT prosecdef FROM pg_proc WHERE proname = 'reserve_refund_allocation' AND pronamespace = 'public'::regnamespace) AS definer, (SELECT proconfig::text FROM pg_proc WHERE proname = 'reserve_refund_allocation' AND pronamespace = 'public'::regnamespace) AS cfg`))[0];
    eq('permissions: execute is granted to the service role only; the function is SECURITY DEFINER with a fixed search_path', [g.anon, g.auth, g.svc, g.definer, /search_path=public/.test(g.cfg ?? '')], [false, false, true, true, true]);
    eq('permissions: no browser role can write the refund table or its allocation columns', ['authenticated', 'anon'].flatMap((r) => ['INSERT', 'UPDATE', 'DELETE'].map((k) => asRole(r, null, `has_table_privilege('${r}', 'public.order_refunds', '${k}')`))), Array(6).fill('false'));
    eq('permissions: no browser role holds column-level UPDATE on the allocation columns', ['allocation_version', 'deposit_principal_refunded_cents', 'balance_principal_refunded_cents', 'tip_refunded_cents', 'unclassified_refunded_cents', 'request_allocation'].flatMap((c) => ['authenticated', 'anon'].map((r) => asRole(r, null, `has_column_privilege('${r}', 'public.order_refunds', '${c}', 'UPDATE')`))), Array(12).fill('false'));
    const src = fs.readFileSync(PAY_MIGRATION_6, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
    ok('static: the migration replaces no existing function and drops nothing', !/DROP\s/i.test(src) && (src.match(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/gi) ?? []).length === 1 && /reserve_refund_allocation/.test(src));
    ok('static: the migration does not touch the amount-only reservation', !/reserve_refund_operation/.test(src));
    ok('static: the order row is locked before any refund row is read or written', src.indexOf('FROM public.orders WHERE id = p_order_id FOR UPDATE') > 0 && src.indexOf('FROM public.orders WHERE id = p_order_id FOR UPDATE') < src.indexOf('FROM public.order_refunds'));
    ok('static: nothing here writes the orders or payments tables', !/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(orders|payments)\b/i.test(src));
  }

  // =================================================================================================================
  // 10. The refund overview the Admin screen reads: the same capacity rules as the reservation, and complete operations
  // =================================================================================================================
  {
    const ovw = (orderId: string): any => { try { return JSON.parse(asRole('service_role', null, `public.order_refund_overview('${orderId}')`)); } catch { return null; } };
    // Reserve exactly the stated amount of ONE component of one payment, in a transaction that is rolled back; returns the outcome.
    const probe = (orderId: string, payId: string, d: number, b: number, t: number): string => {
      const lines = JSON.stringify([{ paymentId: payId, depositPrincipalCents: d, balancePrincipalCents: b, tipCents: t }]);
      const script = `BEGIN;${NL}SELECT 'R|' || COALESCE((public.reserve_refund_allocation('${orderId}', 'probe-${TAG}-${++keyCounter}', $j$${lines}$j$::jsonb, 'probe'))->>'outcome', 'NULL');${NL}ROLLBACK;`;
      const pr = spawnSync(db.psql, [...psqlArgs(db.db)], { input: script, encoding: 'utf8' });
      const line = String(pr.stdout ?? '').split(NL).find((l: string) => l.startsWith('R|'));
      return line ? line.slice(2).trim() : 'ERR';
    };
    // For every payment and component: asking for exactly what the overview says is available is accepted, one cent more is not.
    const checkAgainstReservation = (label: string, orderId: string) => {
      const o = ovw(orderId);
      if (!o) { ok(`overview: ${label}: readable`, false); return; }
      let allFit = true, allOver = true, any = false;
      for (const p of o.payments) {
        for (const [c, idx] of [['deposit', 0], ['balance', 1], ['tip', 2]] as const) {
          const avail = p.available[c + '_cents'];
          const amounts = [0, 0, 0];
          if (avail > 0) {
            any = true;
            amounts[idx] = avail;
            if (probe(orderId, p.id, amounts[0], amounts[1], amounts[2]) !== 'reserved') { allFit = false; console.error('  fit failed', label, p.id, c, avail); }
          }
          const over = [0, 0, 0];
          over[idx] = avail + 1;
          if (probe(orderId, p.id, over[0], over[1], over[2]) === 'reserved') { allOver = false; console.error('  over accepted', label, p.id, c, avail + 1); }
        }
      }
      ok(`overview: ${label}: what is shown as available is accepted by the reservation, one cent more is refused`, allFit && allOver && (any || o.payments.every((p: any) => p.reason_unavailable !== null || p.remaining_total_cents === 0)));
    };

    {
      const order = await newOrder();
      const p = await addPay(order, { dep: 10000, bal: 3000, tip: 2000 });
      const o = ovw(order);
      eq('overview: a clean payment shows its components, nothing refunded or pending, and everything available', [o.payments.length, o.payments[0].refundable, o.payments[0].classified, o.payments[0].deposit_cents, o.payments[0].balance_cents, o.payments[0].tip_cents, [o.payments[0].available.deposit_cents, o.payments[0].available.balance_cents, o.payments[0].available.tip_cents], o.payments[0].remaining_total_cents, o.payments[0].reason_unavailable], [1, true, true, 10000, 3000, 2000, [10000, 3000, 2000], 15000, null]);
      checkAgainstReservation('a clean payment', order);

      const k1 = newKey();
      await reserve(order, k1, [line(p.id, 4000, 0, 500)]);
      await markSent(k1);
      const o2 = ovw(order);
      eq('overview: a pending allocated refund reduces availability but is shown as pending, not as refunded', [o2.payments[0].pending.deposit_cents, o2.payments[0].pending.tip_cents, o2.payments[0].refunded.deposit_cents, o2.payments[0].available.deposit_cents, o2.payments[0].available.tip_cents, o2.payments[0].remaining_total_cents], [4000, 500, 0, 6000, 1500, 10500]);
      checkAgainstReservation('a pending refund', order);
      const rid = (await rowsOf(k1))[0].id;
      await event((await rowsOf(k1))[0].stripe_refund_id, p.pi, 4500, 'succeeded', rid);
      const o3 = ovw(order);
      eq('overview: once it succeeds it is refunded, no longer pending, and availability is unchanged', [o3.payments[0].refunded.deposit_cents, o3.payments[0].refunded.tip_cents, o3.payments[0].pending.deposit_cents, o3.payments[0].available.deposit_cents, o3.payments[0].available.tip_cents], [4000, 500, 0, 6000, 1500]);
      checkAgainstReservation('a succeeded refund', order);
      const k2 = newKey();
      await reserve(order, k2, [line(p.id, 0, 3000, 0)]);
      await markSent(k2);
      await event((await rowsOf(k2))[0].stripe_refund_id, p.pi, 3000, 'failed', (await rowsOf(k2))[0].id);
      const o4 = ovw(order);
      eq('overview: a failed refund releases its availability', [o4.payments[0].available.balance_cents, o4.payments[0].pending.balance_cents, o4.payments[0].refunded.balance_cents], [3000, 0, 0]);
      checkAgainstReservation('a failed refund', order);
      eq('overview: the history lists every refund, newest first, with its split and status', [o4.refunds.length, o4.refunds[0].status, o4.refunds[0].balance_cents, o4.refunds[1].status, o4.refunds[1].deposit_cents], [2, 'failed', 3000, 'succeeded', 4000]);
    }
    {
      const order = await newOrder();
      const p = await addPay(order, { dep: 10000, tip: 2000 });
      await addLegacyRefund(order, { amount: 5000, status: 'succeeded', payId: p.id, pi: p.pi });
      const o = ovw(order);
      eq('overview: an earlier refund with no breakdown is unknown history: only what is certainly still there is available', [o.payments[0].has_unclassified_history, [o.payments[0].available.deposit_cents, o.payments[0].available.balance_cents, o.payments[0].available.tip_cents], o.payments[0].remaining_total_cents, o.payments[0].refunded.unclassified_cents], [true, [5000, 0, 0], 7000, 5000]);
      checkAgainstReservation('an unknown historical refund', order);
      const hist = o.refunds[0];
      eq('overview: ...and that refund is shown with no allocation', [hist.allocation_version, hist.deposit_cents, hist.tip_cents], [null, null, null]);
    }
    {
      // the balance principal obeys the same unknown-history rule
      const order = await newOrder();
      const pb = await addPay(order, { bal: 4000, tip: 1000 });
      await addLegacyRefund(order, { amount: 3000, status: 'succeeded', payId: pb.id, pi: pb.pi });
      eq('overview: with an earlier refund of unknown composition, only the balance principal that is certainly left is available', ovw(order).payments[0].available.balance_cents, 1000);
      checkAgainstReservation('an unknown historical refund on a balance payment', order);
    }
    {
      const order = await newOrder();
      const p1 = await addPay(order, { dep: 10000 });
      await addPay(order, { tip: 3000 });
      await addLegacyRefund(order, { amount: 1000, status: 'succeeded', ledger: null });
      const o = ovw(order);
      eq('overview: older unlinked refunds beside several refundable payments make every payment unavailable, with the reason', [o.payments.map((x: any) => x.reason_unavailable), o.payments.map((x: any) => x.available.deposit_cents + x.available.tip_cents)], [['history_ambiguous', 'history_ambiguous'], [0, 0]]);
      checkAgainstReservation('unlinked history beside two payments', order);
      void p1;
      const single = await newOrder();
      await addPay(single, { dep: 10000, tip: 2000 });
      await addLegacyRefund(single, { amount: 4000, status: 'succeeded', ledger: null });
      checkAgainstReservation('unlinked history beside one payment', single);
      eq('overview: ...beside ONE payment it counts against that payment', ovw(single).payments[0].available.deposit_cents, 6000);
    }
    {
      const order = await newOrder();
      await addPay(order, { classified: false, amount: 5000 });
      await addPay(order, { method: 'cash', bal: 5000 });
      const o = ovw(order);
      eq('overview: an unclassified card payment and a cash payment are listed with the reason, and nothing is available', [o.payments.map((x: any) => [x.refundable, x.classified, x.reason_unavailable, x.available.deposit_cents + x.available.balance_cents + x.available.tip_cents]).sort()], [[[false, true, 'not_refundable', 0], [true, false, 'unclassified', 0]].sort()]);
      eq('overview: an order with no payments has an empty overview', ovw(await newOrder()).payments, []);
    }
    {
      // two payments with different component distributions
      const order = await newOrder();
      const a = await addPay(order, { dep: 7000, tip: 1000 });
      await addPay(order, { bal: 4000 });
      await addPay(order, { tip: 500 });
      checkAgainstReservation('three payments with different splits', order);
      const k = newKey();
      await reserve(order, k, [line(a.id, 1000, 0, 1000)]);
      await markSent(k);
      checkAgainstReservation('three payments, one partly refunded', order);
    }
    {
      // operations: complete and verified, or not
      const order = await newOrder();
      const p1 = await addPay(order, { dep: 10000, tip: 2000 });
      const p2 = await addPay(order, { bal: 4000 });
      const key = newKey();
      await reserve(order, key, [line(p1.id, 3000, 0, 500), line(p2.id, 0, 1000, 0)]);
      const o = ovw(order);
      const op = o.operations[0];
      eq('overview: an allocated operation is one entry with all its rows, unfinished and verified', [o.operations.length, op.operation_key, op.kind, op.unfinished, op.verified, op.request_amount_cents, op.rows.length, op.rows.map((r: any) => r.operation_index)], [1, key, 'allocated', true, true, 4500, 2, [0, 1]]);
      eq('overview: ...its rows carry the stored components and statuses', op.rows.map((r: any) => [r.deposit_cents, r.balance_cents, r.tip_cents, r.unclassified_cents, r.status, r.stripe_refund_id, r.provider_attempted]), (await rowsOf(key)).map((r: any) => [r.deposit_principal_refunded_cents, r.balance_principal_refunded_cents, r.tip_refunded_cents, 0, 'pending', null, false]));
      // tampering is detected, never repaired
      const tamper = async (sql: string, label: string) => {
        const before = JSON.stringify(await rowsOf(key));
        await pg.exec(sql);
        const v = ovw(order).operations[0].verified;
        await pg.exec(`UPDATE public.order_refunds SET status = 'pending' WHERE operation_key = '${key}';`);
        return [label, v, before !== JSON.stringify(await rowsOf(key))];
      };
      const t1 = await tamper(`UPDATE public.order_refunds SET deposit_principal_refunded_cents = deposit_principal_refunded_cents + 1, unclassified_refunded_cents = 0, amount_cents = amount_cents + 1 WHERE operation_key = '${key}' AND operation_index = 0;`, 'a changed component');
      eq('overview: an operation whose stored components no longer match its recorded identity is not verified', [t1[1]], [false]);
      await pg.exec(`UPDATE public.order_refunds SET deposit_principal_refunded_cents = deposit_principal_refunded_cents - 1, amount_cents = amount_cents - 1 WHERE operation_key = '${key}' AND operation_index = 0;`);
      eq('overview: ...and is verified again once restored', ovw(order).operations[0].verified, true);
      const rowId = (await rowsOf(key))[1].id;
      await pg.exec(`UPDATE public.order_refunds SET operation_index = 5 WHERE id = '${rowId}';`);
      eq('overview: an operation with a missing index is not verified', ovw(order).operations[0].verified, false);
      await pg.exec(`UPDATE public.order_refunds SET operation_index = 1 WHERE id = '${rowId}';`);
      await pg.exec(`UPDATE public.order_refunds SET request_allocation = 'v1|total=4500|other' WHERE operation_key = '${key}';`);
      eq('overview: an operation whose recorded identity is not the one its rows produce is not verified', ovw(order).operations[0].verified, false);
      void t1;

      // amount-only operation
      const o2 = await newOrder();
      await addPay(o2, { dep: 10000, tip: 2000 });
      const k2 = newKey();
      await oldReserve(o2, k2, 3000);
      const op2 = ovw(o2).operations[0];
      eq('overview: an amount-only operation is reported as such, verified, with no allocation', [op2.kind, op2.verified, op2.unfinished, op2.request_amount_cents, op2.rows[0].allocation_version], ['amount_only', true, true, 3000, null]);
      await markSent(k2);
      await event((await rowsOf(k2))[0].stripe_refund_id, null, 3000, 'succeeded', (await rowsOf(k2))[0].id);
      eq('overview: a finished operation is no longer unfinished', ovw(o2).operations[0].unfinished, false);
    }
    {
      const order = await newOrder();
      await addPay(order, { dep: 1000 });
      eq('overview: the service role can read it; anonymous cannot execute it', [typeof asRole('service_role', null, `public.order_refund_overview('${order}')::text`), asRole('anon', null, `public.order_refund_overview('${order}')::text`)], ['string', 'DENIED']);
      eq('overview: a missing order and a NULL id give NULL', [asRole('service_role', null, `public.order_refund_overview('${nextId()}')::text`), asRole('service_role', null, 'public.order_refund_overview(NULL)::text')], ['NULL', 'NULL']);
      const fn = (await pg.query(`SELECT prosecdef, provolatile, proconfig::text AS cfg FROM pg_proc WHERE proname = 'order_refund_overview' AND pronamespace = 'public'::regnamespace`))[0];
      eq('overview: it is SECURITY INVOKER, STABLE, with a fixed search_path, and writes nothing', [fn.prosecdef, fn.provolatile, /search_path=public/.test(fn.cfg ?? '')], [false, 's', true]);
      const src = fs.readFileSync(PAY_MIGRATION_7, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
      ok('static: the overview migration only creates the function and its grants', !/\b(INSERT\s+INTO|UPDATE\s|DELETE\s+FROM|DROP\s|ALTER\s)/i.test(src) && (src.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 1);
    }
  }

  // cleanup
  const ids = createdOrders.map((i) => `'${i}'`).join(',') || "'00000000-0000-0000-0000-000000000000'";
  await pg.exec(`UPDATE public.payments SET refunded_payment_id = NULL WHERE order_id IN (${ids});
    DELETE FROM public.order_refunds WHERE order_id IN (${ids});
    DELETE FROM public.order_changelog WHERE order_id IN (${ids});
    DELETE FROM public.payments WHERE order_id IN (${ids});
    DELETE FROM public.orders WHERE id IN (${ids});
    DELETE FROM public.user_roles WHERE user_id IN ('${ADMIN}', '${CREW}', '${CUST}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN}', '${CREW}', '${CUST}');`);
  pg.close();
  finish();
})().catch((e) => {
  console.error(`FAIL: the test stopped on an unexpected error: ${e?.message ?? e}`);
  console.error(e);
  throw e;
});

function finish() {
  console.log(`Refund allocation tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} refund allocation test(s) failed`);
}
