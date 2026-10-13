// Refund accounting database foundation: the allocation columns on order_refunds and the read-only order_net_financials function,
// run for real against the scratch PostgreSQL database (see paymentHarness.ts). Nothing here calls Stripe or the Edge Functions.
//
//   - the allocation constraint accepts the legacy shape (every refund row that exists today) and an explicit allocation, and
//     rejects every incoherent one; existing rows keep working through every status transition;
//   - order_net_financials counts Stripe, cash and check payments, subtracts succeeded order_refunds exactly once (never the
//     negative payment copies), and returns NULL instead of a misleading exact figure when anything is unclassified or unsettled;
//   - who may run it: Admin / Master and the service role only (Crew, customers and anonymous callers cannot);
//   - it is read-only and leaves every operational order column alone.
//
// With no reachable scratch database the file is SKIPPED (ROLE_DB_REQUIRE=1 makes that a failure).
// Run: node node_modules/jiti/bin/jiti.js src/lib/refundAccounting.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const process: { env: Record<string, string | undefined>; pid: number };
declare const require: (id: string) => any;

import { PgPool, ensurePayDatabase, psqlArgs, PAY_MIGRATION_5 } from './paymentHarness';

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
const nextId = () => `eeeeeeee-0000-4000-8000-${TAG}${String(++counter).padStart(3, '0')}`;
const ADMIN = `bbbbbbbb-0000-4000-8000-${TAG}b11`;
const MASTER = `bbbbbbbb-0000-4000-8000-${TAG}b12`;
const CREW = `bbbbbbbb-0000-4000-8000-${TAG}b13`;
const CUST = `bbbbbbbb-0000-4000-8000-${TAG}b14`;
let piCounter = 0;
let reCounter = 0;

(async () => {
  const db = ensurePayDatabase();
  if (!db) {
    if (process.env.ROLE_DB_REQUIRE) ok('executed: the scratch database is available (ROLE_DB_REQUIRE is set)', false);
    else console.log('Refund accounting tests SKIPPED: the scratch database was not reachable.');
    finish();
    return;
  }
  const pg = new PgPool(db.psql, db.db, 4);
  const createdOrders: string[] = [];

  // A psql run that reports whether the statement failed and with what.
  const tryExec = (sql: string): { ok: boolean; err: string } => {
    const p = spawnSync(db.psql, [...psqlArgs(db.db), '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
    return { ok: p.status === 0, err: String(p.stderr ?? '') };
  };
  // One statement as a real role, inside a rolled-back transaction. Returns the text of the value, 'DENIED' or 'ERR:...'.
  const asRole = (role: string, uid: string | null, sql: string): string => {
    const script = `BEGIN;
-- The scratch payment database is built without the platform's default table grants; the deployed service role has them. Rolled back.
GRANT SELECT ON public.payments, public.order_refunds, public.orders TO service_role;
SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', true);
SELECT set_config('request.jwt.claim.role', '${role}', true);
SET LOCAL ROLE ${role};
SELECT 'R|' || COALESCE((${sql})::text, 'NULL');
ROLLBACK;`;
    const p = spawnSync(db.psql, [...psqlArgs(db.db)], { input: script, encoding: 'utf8' });
    const line = String(p.stdout ?? '').split('\n').find((l: string) => l.startsWith('R|'));
    if (line) return line.slice(2).trim();
    return /permission denied/i.test(String(p.stderr)) ? 'DENIED' : `ERR:${String(p.stderr).trim().split('\n')[0]}`;
  };
  const netAs = (role: string, uid: string | null, orderId: string): any => {
    const r = asRole(role, uid, `public.order_net_financials('${orderId}')`);
    try { return JSON.parse(r); } catch { return r; }
  };
  const net = (orderId: string) => netAs('service_role', null, orderId);
  // Setup SQL (as the superuser) and then the net function as the service role, all inside a transaction that is rolled back, so a
  // state the database normally forbids (a dropped unique index) can be examined without changing the shared scratch database.
  const netInTx = (setup: string, orderId: string): any => {
    const script = `BEGIN;\n${setup}\nGRANT SELECT ON public.payments, public.order_refunds, public.orders TO service_role;\nSET LOCAL ROLE service_role;\nSELECT 'R|' || public.order_net_financials('${orderId}')::text;\nROLLBACK;`;
    const pr = spawnSync(db.psql, [...psqlArgs(db.db)], { input: script, encoding: 'utf8' });
    const line = String(pr.stdout ?? '').split(String.fromCharCode(10)).find((l: string) => l.startsWith('R|'));
    try { return JSON.parse((line ?? '').slice(2).trim()); } catch { return `ERR:${String(pr.stderr).trim().split(String.fromCharCode(10))[0]}`; }
  };

  for (const [id, k, role] of [[ADMIN, 'b11', 'admin'], [MASTER, 'b12', 'master'], [CREW, 'b13', 'crew'], [CUST, 'b14', 'customer']] as const) {
    await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${id}', 'acct-${TAG}-${k}@example.test') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_roles (user_id, role) VALUES ('${id}', '${role}');`);
  }

  async function newOrder(): Promise<string> {
    const id = nextId();
    createdOrders.push(id);
    await pg.exec(`INSERT INTO public.orders (id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents)
      VALUES ('${id}', 'confirmed', 'residential', '2030-06-01', '2030-06-01', '10:00', '12:00', 'next_day', 60000, 25661, 34339);`);
    return id;
  }
  interface PayOpts { method?: 'card' | 'cash' | 'check'; dep?: number; bal?: number; tip?: number; classified?: boolean; status?: string; amount?: number }
  // A payment. Classified: principal = dep + bal, amount = principal + tip. Unclassified: only `amount` (components NULL).
  async function addPay(orderId: string, o: PayOpts): Promise<{ id: string; pi: string | null }> {
    const id = nextId();
    const method = o.method ?? 'card';
    const pi = method === 'card' ? `pi_acct_${TAG}_${++piCounter}` : null;
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
  interface RefundOpts { amount: number; status?: string; payId?: string | null; pi?: string | null; version?: 'legacyshape' | 'allocated' | 'allocated-null-ledger' | 'null-ledger'; dep?: number; bal?: number; tip?: number; unc?: number; reId?: string | null }
  // A refund row, inserted directly (as the migration of a database that already holds refunds would have left it).
  async function addRefund(orderId: string, o: RefundOpts): Promise<{ id: string; re: string | null }> {
    const id = nextId();
    const re = o.reId === undefined ? `re_acct_${TAG}_${++reCounter}` : o.reId;
    const allocated = o.version === 'allocated' || o.version === 'allocated-null-ledger';
    const alloc = allocated
      ? `, allocation_version, deposit_principal_refunded_cents, balance_principal_refunded_cents, tip_refunded_cents, unclassified_refunded_cents, request_allocation`
      : '';
    const allocVals = allocated ? `, 1, ${o.dep ?? 0}, ${o.bal ?? 0}, ${o.tip ?? 0}, ${o.unc ?? 0}, 'sig-${id}'` : '';
    const ledger = o.version === 'null-ledger' || o.version === 'allocated-null-ledger' ? 'NULL' : '2';
    await pg.exec(`INSERT INTO public.order_refunds (id, order_id, amount_cents, reason, status, ledger_version, stripe_refund_id, payment_id, stripe_payment_intent_id, source, updated_at${alloc})
      VALUES ('${id}', '${orderId}', ${o.amount}, 'test', '${o.status ?? 'succeeded'}', ${ledger}, ${re ? `'${re}'` : 'NULL'}, ${o.payId ? `'${o.payId}'` : 'NULL'}, ${o.pi ? `'${o.pi}'` : 'NULL'}, 'admin', now()${allocVals});`);
    ok(`fixture: the ${o.status ?? 'succeeded'} refund row (${o.version ?? 'legacy shape'}) was accepted`, (await pg.query(`SELECT 1 AS x FROM public.order_refunds WHERE id = '${id}'`)).length === 1);
    return { id, re };
  }
  const event = async (re: string, pi: string | null, amount: number, status: string, rowId: string | null) =>
    (await pg.query(`SELECT public.apply_provider_refund_event('${re}', ${pi ? `'${pi}'` : 'NULL'}, ${amount}, '${status}', NULL, NULL, ${rowId ? `'${rowId}'` : 'NULL'}) AS j`, true))[0].j;
  const orderRow = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.orders t WHERE id = '${id}'`))[0].j;
  const refundRow = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.order_refunds t WHERE id = '${id}'`))[0].j;
  const NEW_COLS = ['allocation_version', 'deposit_principal_refunded_cents', 'balance_principal_refunded_cents', 'tip_refunded_cents', 'unclassified_refunded_cents', 'request_allocation'];

  // =================================================================================================================
  // 1. The migration
  // =================================================================================================================
  {
    const cols = (await pg.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='order_refunds' AND column_name IN (${NEW_COLS.map((c) => `'${c}'`).join(',')}) ORDER BY column_name`));
    eq('migration: the six allocation columns exist', cols.map((c: any) => c.column_name).sort(), [...NEW_COLS].sort());
    ok('migration: all six are nullable and none has a default (existing rows stay "no allocation recorded")', cols.every((c: any) => c.is_nullable === 'YES' && c.column_default === null));
    const types = (await pg.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='order_refunds' AND column_name IN (${NEW_COLS.map((c) => `'${c}'`).join(',')})`));
    ok('migration: the version is smallint, the amounts integer and the signature text', types.every((c: any) => (c.column_name === 'allocation_version' ? c.data_type === 'smallint' : c.column_name === 'request_allocation' ? c.data_type === 'text' : c.data_type === 'integer')));
    const con = (await pg.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'order_refunds_allocation_shape' AND conrelid = 'public.order_refunds'::regclass`));
    eq('migration: the allocation constraint exists and is validated', con.map((c: any) => c.convalidated), [true]);
    const again = tryExec(fs.readFileSync(PAY_MIGRATION_5, 'utf8'));
    ok('migration: it can be applied again without error (idempotent)', again.ok);
    const fn = (await pg.query(`SELECT prosecdef, provolatile, proconfig::text AS cfg FROM pg_proc WHERE proname = 'order_net_financials' AND pronamespace = 'public'::regnamespace`));
    eq('migration: the net function is SECURITY INVOKER, STABLE, with a fixed search_path', fn.map((f: any) => [f.prosecdef, f.provolatile, /search_path=public/.test(f.cfg ?? '')]), [[false, 's', true]]);
    const grants = (await pg.query(`SELECT has_function_privilege('anon','public.order_net_financials(uuid)','execute') AS anon, has_function_privilege('authenticated','public.order_net_financials(uuid)','execute') AS auth, has_function_privilege('service_role','public.order_net_financials(uuid)','execute') AS svc`))[0];
    eq('migration: execute is granted to authenticated and service_role, not to anon', [grants.anon, grants.auth, grants.svc], [false, true, true]);
    const src = fs.readFileSync(PAY_MIGRATION_5, 'utf8');
    ok('migration: it contains no INSERT, UPDATE or DELETE of data (schema plus one read-only function)', !/^\s*(INSERT|UPDATE|DELETE)\b/im.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')));
  }

  // =================================================================================================================
  // 2. Existing (legacy-shaped) rows stay valid through every transition
  // =================================================================================================================
  {
    const order = await newOrder();
    const pay = await addPay(order, { dep: 25661, tip: 5132 });
    const pend = await addRefund(order, { amount: 4000, status: 'pending', payId: pay.id, pi: pay.pi });
    const r0 = await refundRow(pend.id);
    ok('legacy shape: a ledger-version-2 row with every allocation column NULL is valid', NEW_COLS.every((c) => r0[c] === null) && r0.ledger_version === 2);
    const settled = await event(pend.re as string, pay.pi, 4000, 'succeeded', pend.id);
    eq('legacy shape: a pre-existing pending refund settles through the webhook function', [settled.outcome, settled.applied_now], ['succeeded', true]);
    const r1 = await refundRow(pend.id);
    ok('legacy shape: it is succeeded, counted once, and its allocation columns are still NULL', r1.status === 'succeeded' && r1.total_applied === true && NEW_COLS.every((c) => r1[c] === null));
    const again = await event(pend.re as string, pay.pi, 4000, 'succeeded', pend.id);
    eq('legacy shape: another webhook for the succeeded refund changes nothing', [again.outcome, again.applied_now], ['unchanged', false]);
    eq('legacy shape: the order total counted it once', (await orderRow(order)).total_refunded_cents, 4000);
    const failedNow = await event(pend.re as string, pay.pi, 4000, 'failed', pend.id);
    eq('legacy shape: succeeded -> failed is still permitted and valid', [failedNow.outcome], ['failed']);
    ok('legacy shape: the row is failed and still has the legacy shape', await (async () => { const r = await refundRow(pend.id); return r.status === 'failed' && NEW_COLS.every((c) => r[c] === null); })());
    ok('legacy shape: a failed row can still be updated (failure reason)', tryExec(`UPDATE public.order_refunds SET failure_reason = 'reviewed' WHERE id = '${pend.id}';`).ok);
    const late = await event(pend.re as string, pay.pi, 4000, 'succeeded', pend.id);
    eq('legacy shape: a late success for a failed refund is refused without breaking the row', late.outcome, 'invalid_transition');
    const failedFirst = await addRefund(order, { amount: 500, status: 'failed', payId: pay.id, pi: pay.pi });
    ok('legacy shape: a failed row inserted without allocation is valid', (await refundRow(failedFirst.id)).status === 'failed');
    // amount-only inserts, exactly as the current functions write them
    ok('legacy shape: an amount-only insert (no allocation columns named) is accepted', tryExec(`INSERT INTO public.order_refunds (order_id, amount_cents, reason, status, operation_key, operation_index, request_amount_cents, provider_idempotency_key) VALUES ('${order}', 100, 'x', 'pending', 'amountonly-${TAG}', 0, 100, 'refund:amountonly-${TAG}:0');`).ok);
    const reserved = await pg.query(`SELECT public.reserve_refund_operation('${order}', 'resv-${TAG}-1', 1000, 'test', NULL) AS j`, true);
    ok('legacy shape: the existing reservation function still reserves (amount-only)', reserved[0].j.outcome === 'reserved' || reserved[0].j.outcome === 'exceeds_refundable' || reserved[0].j.outcome === 'unsettled_operation');
    const ver = await pg.query(`SELECT allocation_version FROM public.order_refunds WHERE operation_key = 'resv-${TAG}-1'`);
    ok('legacy shape: rows the existing reservation function creates have no allocation recorded', ver.every((r: any) => r.allocation_version === null));
  }

  // =================================================================================================================
  // 3. The constraint
  // =================================================================================================================
  {
    const order = await newOrder();
    const row = (extra: string, vals: string) => tryExec(`INSERT INTO public.order_refunds (order_id, amount_cents, reason, status, ${extra}) VALUES ('${order}', 1000, 'c', 'pending', ${vals});`);
    const COLS = 'allocation_version, deposit_principal_refunded_cents, balance_principal_refunded_cents, tip_refunded_cents, unclassified_refunded_cents, request_allocation';
    ok('constraint: a coherent allocation is accepted', row(COLS, `1, 400, 300, 200, 100, 'p:400:300:200:100'`).ok);
    ok('constraint: an allocation made only of an unclassified amount is accepted', row(COLS, `1, 0, 0, 0, 1000, 'p:0:0:0:1000'`).ok);
    ok('constraint: a zero component is accepted', row(COLS, `1, 1000, 0, 0, 0, 'p:1000:0:0:0'`).ok);
    const neg = row(COLS, `1, 1100, 0, -100, 0, 'sig'`);
    ok('constraint: a negative component is rejected', !neg.ok && /order_refunds_allocation_shape/.test(neg.err));
    ok('constraint: a negative deposit component is rejected', !row(COLS, `1, -100, 700, 300, 100, 'sig'`).ok);
    ok('constraint: a negative balance component is rejected', !row(COLS, `1, 700, -100, 300, 100, 'sig'`).ok);
    ok('constraint: a negative unclassified component is rejected', !row(COLS, `1, 700, 300, 100, -100, 'sig'`).ok);
    ok('constraint: a NULL component in an allocated row is rejected', !row(COLS, `1, 400, NULL, 200, 400, 'sig'`).ok);
    ok('constraint: a component sum below the amount is rejected', !row(COLS, `1, 400, 300, 200, 0, 'sig'`).ok);
    ok('constraint: a component sum above the amount is rejected', !row(COLS, `1, 400, 300, 200, 200, 'sig'`).ok);
    ok('constraint: an unsupported allocation version is rejected', !row(COLS, `2, 400, 300, 200, 100, 'sig'`).ok);
    ok('constraint: version 0 is rejected', !row(COLS, `0, 400, 300, 200, 100, 'sig'`).ok);
    ok('constraint: an allocated row without a signature is rejected', !row(COLS, `1, 400, 300, 200, 100, NULL`).ok);
    ok('constraint: an allocated row with a blank signature is rejected', !row(COLS, `1, 400, 300, 200, 100, '   '`).ok);
    ok('constraint: components without a version are rejected', !row('deposit_principal_refunded_cents, balance_principal_refunded_cents, tip_refunded_cents, unclassified_refunded_cents', `400, 300, 200, 100`).ok);
    ok('constraint: complete components AND a signature, but no version, are rejected', !row('deposit_principal_refunded_cents, balance_principal_refunded_cents, tip_refunded_cents, unclassified_refunded_cents, request_allocation', `400, 300, 200, 100, 'sig'`).ok);
    ok('constraint: a signature without a version is rejected', !row('request_allocation', `'sig'`).ok);
    ok('constraint: a version without components is rejected', !row('allocation_version', `1`).ok);
    ok('constraint: a partly filled legacy shape is rejected', !row('tip_refunded_cents', `1000`).ok);
    const okRow = nextId();
    ok('constraint: an allocated row cannot later be made inconsistent', (() => {
      tryExec(`INSERT INTO public.order_refunds (id, order_id, amount_cents, reason, status, ${COLS}) VALUES ('${okRow}', '${order}', 1000, 'c', 'pending', 1, 400, 300, 200, 100, 'sig');`);
      return !tryExec(`UPDATE public.order_refunds SET tip_refunded_cents = 999 WHERE id = '${okRow}';`).ok;
    })());
    ok('constraint: an allocated row can change status', tryExec(`UPDATE public.order_refunds SET status = 'succeeded' WHERE id = '${okRow}';`).ok);
    ok('constraint: a huge component cannot wrap the integer sum into a match', !row(COLS, `1, 2147483647, 2147483647, 2, 0, 'sig'`).ok);
  }

  // =================================================================================================================
  // 4. Net financials: payments of every method
  // =================================================================================================================
  {
    const order = await newOrder();
    await addPay(order, { dep: 25661, tip: 5132 });
    const n1 = net(order);
    eq('stripe payment: gross, deposit principal and tip', [n1.gross_recorded_payments_cents, n1.known_gross_deposit_principal_cents, n1.known_gross_tips_cents, n1.known_gross_principal_cents], [30793, 25661, 5132, 25661]);
    ok('stripe payment: classification is complete and the exact figures are available', n1.classification_complete === true && n1.net_principal_exact_cents === 25661 && n1.net_tips_exact_cents === 5132 && n1.recorded_only === false);
    eq('stripe payment: recorded net cash retained', n1.recorded_net_cash_retained_cents, 30793);

    const o2 = await newOrder();
    await addPay(o2, { method: 'cash', bal: 10000, tip: 500 });
    const n2 = net(o2);
    eq('cash payment: principal and tip are visible without a PaymentIntent', [n2.gross_recorded_payments_cents, n2.known_gross_balance_principal_cents, n2.known_gross_tips_cents], [10500, 10000, 500]);
    ok('cash payment: recorded-only is flagged because offline refunds are not tracked', n2.recorded_only === true && n2.offline_refunds_tracked === false && n2.classification_complete === true);

    const o3 = await newOrder();
    await addPay(o3, { method: 'check', dep: 20000 });
    const n3 = net(o3);
    eq('check payment: principal is visible', [n3.gross_recorded_payments_cents, n3.known_gross_deposit_principal_cents, n3.known_gross_tips_cents, n3.recorded_only], [20000, 20000, 0, true]);

    const o4 = await newOrder();
    const c4 = await addPay(o4, { dep: 25661, tip: 5132 });
    await addPay(o4, { method: 'cash', bal: 10000, tip: 500 });
    await addPay(o4, { method: 'check', bal: 20000 });
    const n4 = net(o4);
    eq('mixed order: gross, deposit, balance, tips', [n4.gross_recorded_payments_cents, n4.known_gross_deposit_principal_cents, n4.known_gross_balance_principal_cents, n4.known_gross_principal_cents, n4.known_gross_tips_cents], [61293, 25661, 30000, 55661, 5632]);
    // a Stripe refund on an order that also holds cash and check
    const ref = await addRefund(o4, { amount: 10000, status: 'pending', payId: c4.id, pi: c4.pi, version: 'allocated', dep: 7500, tip: 2500 });
    const pend = net(o4);
    eq('mixed order: a pending refund reserves but does not reduce any net figure', [pend.pending_refund_reservations_cents, pend.recorded_net_cash_retained_cents, pend.known_net_deposit_principal_cents, pend.known_net_tips_cents], [10000, 61293, 25661, 5632]);
    await event(ref.re as string, c4.pi, 10000, 'succeeded', ref.id);
    const done = net(o4);
    eq('mixed order: the succeeded classified refund reduces exactly its own components', [done.total_succeeded_refunds_cents, done.deposit_principal_refunded_cents, done.balance_principal_refunded_cents, done.tips_refunded_cents, done.known_net_deposit_principal_cents, done.known_net_balance_principal_cents, done.known_net_tips_cents, done.recorded_net_cash_retained_cents], [10000, 7500, 0, 2500, 18161, 30000, 3132, 51293]);
    ok('mixed order: still complete, so the exact figures are present', done.classification_complete === true && done.net_principal_exact_cents === 48161 && done.net_tips_exact_cents === 3132 && done.recorded_only === true);
    eq('mixed order: the negative payment copy was reported but NOT subtracted a second time', [done.refund_copy_cents, done.refund_copies_match_ledger, done.recorded_net_cash_retained_cents], [10000, true, 51293]);
    const dup = await event(ref.re as string, c4.pi, 10000, 'succeeded', ref.id);
    const dup2 = net(o4);
    eq('mixed order: a duplicate webhook delivery does not change anything', [dup.outcome, dup2.total_succeeded_refunds_cents, dup2.recorded_net_cash_retained_cents, dup2.refund_copy_cents], ['unchanged', 10000, 51293, 10000]);
    const failedLater = await event(ref.re as string, c4.pi, 10000, 'failed', ref.id);
    const reversed = net(o4);
    eq('mixed order: a refund that later fails stops reducing the net figures', [failedLater.outcome, reversed.total_succeeded_refunds_cents, reversed.known_net_deposit_principal_cents, reversed.known_net_tips_cents, reversed.refund_copy_cents], ['failed', 0, 25661, 5632, 0]);

    // failed refund never reduced anything
    const oc = await newOrder();
    const pc = await addPay(oc, { dep: 25661, tip: 5132 });
    const rc = await addRefund(oc, { amount: 4000, status: 'pending', payId: pc.id, pi: pc.pi, version: 'allocated', dep: 4000 });
    await event(rc.re as string, pc.pi, 4000, 'succeeded', rc.id);
    await pg.exec(`DELETE FROM public.payments WHERE order_id = '${oc}' AND amount_cents < 0;`);
    const nc = net(oc);
    eq('refund copies: a missing negative copy is reported, and the refund is still subtracted exactly once', [nc.refund_copies_match_ledger, nc.refund_copy_cents, nc.recorded_net_cash_retained_cents], [false, 0, 26793]);
    eq('refund copies: a missing copy is harmless for the figures: reported, and the order is still exact', [nc.missing_refund_copy_cents, nc.unbacked_refund_copy_cents, nc.classification_complete, nc.net_principal_exact_cents], [4000, 0, true, 21661]);

    // a refund copy that does not belong to any succeeded refund
    const od = await newOrder();
    const pd = await addPay(od, { dep: 25661, tip: 5132 });
    const rd = await addRefund(od, { amount: 4000, status: 'pending', payId: pd.id, pi: pd.pi, version: 'allocated', dep: 4000 });
    await event(rd.re as string, pd.pi, 4000, 'succeeded', rd.id);
    await pg.exec(`INSERT INTO public.payments (order_id, type, amount_cents, status, paid_at, payment_method, refunded_payment_id) VALUES ('${od}', 'incidental', -4000, 'succeeded', now(), 'card', '${pd.id}');`);
    const nd = net(od);
    eq('refund copies: a duplicate negative copy is evidence of an unrecorded refund: reported, never subtracted, and the order is not exact', [nd.unbacked_refund_copy_cents, nd.refund_copy_cents, nd.recorded_net_cash_retained_cents, nd.refund_copies_match_ledger, nd.classification_complete, nd.net_principal_exact_cents], [4000, 8000, 26793, false, false, null]);

    const om = await newOrder();
    const pm = await addPay(om, { dep: 25661, tip: 5132 });
    const rm = await addRefund(om, { amount: 4000, status: 'pending', payId: pm.id, pi: pm.pi, version: 'allocated', dep: 4000 });
    await event(rm.re as string, pm.pi, 4000, 'succeeded', rm.id);
    await pg.exec(`UPDATE public.payments SET amount_cents = -5000 WHERE order_id = '${om}' AND amount_cents < 0;`);
    const nm = net(om);
    eq('refund copies: a copy whose amount disagrees with its refund is unbacked, and the order is not exact', [nm.unbacked_refund_copy_cents, nm.total_succeeded_refunds_cents, nm.recorded_net_cash_retained_cents, nm.classification_complete], [5000, 4000, 26793, false]);
    eq('refund copies: the refund whose only copy has the wrong amount has no valid copy (missing), is still counted once from order_refunds, and nothing is deleted', [nm.missing_refund_copy_cents, nm.duplicate_refund_copies, Number((await pg.query(`SELECT count(*) AS n FROM public.payments WHERE order_id = '${om}' AND amount_cents < 0`))[0].n)], [4000, 0, 1]);

    // a copy that names a DIFFERENT provider refund is not evidence for this one, even when the amounts agree
    const ow = await newOrder();
    const pw = await addPay(ow, { dep: 25661, tip: 5132 });
    const rw = await addRefund(ow, { amount: 4000, status: 'pending', payId: pw.id, pi: pw.pi, version: 'allocated', dep: 4000 });
    await event(rw.re as string, pw.pi, 4000, 'succeeded', rw.id);
    await pg.exec(`UPDATE public.payments SET stripe_refund_id = 're_other_${TAG}' WHERE order_id = '${ow}' AND amount_cents < 0;`);
    const nw = net(ow);
    eq('refund copies: a copy that names another provider refund is unbacked (same amount does not make it a match); the refund has no valid copy; not exact', [nw.unbacked_refund_copy_cents, nw.missing_refund_copy_cents, nw.classification_complete, nw.recorded_net_cash_retained_cents], [4000, 4000, false, 26793]);

    // several legitimate, distinct refunds each with its own correct copy
    const ok3 = await newOrder();
    const pk3 = await addPay(ok3, { dep: 25661, tip: 5132 });
    for (const [amt, dep, tip] of [[1000, 1000, 0], [2000, 0, 2000], [1500, 1500, 0]] as const) {
      const rr = await addRefund(ok3, { amount: amt, status: 'pending', payId: pk3.id, pi: pk3.pi, version: 'allocated', dep, tip });
      await event(rr.re as string, pk3.pi, amt, 'succeeded', rr.id);
    }
    const n3x = net(ok3);
    eq('refund copies: three distinct refunds, each with its own correct copy: all backed, nothing double-subtracted, exact', [n3x.unbacked_refund_copy_cents, n3x.missing_refund_copy_cents, n3x.duplicate_refund_copies, n3x.refund_copy_cents, n3x.total_succeeded_refunds_cents, n3x.refund_copies_match_ledger, n3x.recorded_net_cash_retained_cents, n3x.classification_complete, n3x.net_principal_exact_cents, n3x.net_tips_exact_cents], [0, 0, 0, 4500, 4500, true, 26293, true, 23161, 3132]);

    // two copies of ONE provider refund (the unique index normally forbids this; examined inside a rolled-back transaction)
    const ox = await newOrder();
    const px = await addPay(ox, { dep: 25661, tip: 5132 });
    const rx = await addRefund(ox, { amount: 4000, status: 'pending', payId: px.id, pi: px.pi, version: 'allocated', dep: 4000 });
    await event(rx.re as string, px.pi, 4000, 'succeeded', rx.id);
    const insertDup = (amt: number) => `INSERT INTO public.payments (order_id, type, amount_cents, status, paid_at, payment_method, refunded_payment_id, stripe_refund_id) VALUES ('${ox}', 'incidental', ${amt}, 'succeeded', now(), 'card', '${px.id}', '${rx.re}');`;
    const refused = tryExec(insertDup(-4000));
    ok('refund copies: the database refuses a second copy with the same provider refund id (unique index)', !refused.ok && /payments_refund_event_unique/.test(refused.err));
    const one = net(ox);
    eq('refund copies: exactly one correct copy of one refund is backed', [one.unbacked_refund_copy_cents, one.duplicate_refund_copies, one.missing_refund_copy_cents, one.classification_complete, one.net_principal_exact_cents], [0, 0, 0, true, 21661]);
    const dupSame = netInTx(`DROP INDEX public.payments_refund_event_unique;\n${insertDup(-4000)}`, ox);
    eq('refund copies: two copies with the same provider id AND amount: one is backed, the other is duplicate evidence, and the order is not exact', [dupSame.unbacked_refund_copy_cents, dupSame.duplicate_refund_copies, dupSame.refund_copy_cents, dupSame.missing_refund_copy_cents, dupSame.classification_complete, dupSame.net_principal_exact_cents], [4000, 1, 8000, 0, false, null]);
    eq('refund copies: ...and the refund is still subtracted exactly once', [dupSame.total_succeeded_refunds_cents, dupSame.recorded_net_cash_retained_cents], [4000, 26793]);
    const dupWrongFirst = netInTx(`DROP INDEX public.payments_refund_event_unique;\nUPDATE public.payments SET amount_cents = -5000, created_at = now() - interval '1 hour' WHERE order_id = '${ox}' AND amount_cents < 0;\n${insertDup(-4000)}`, ox);
    eq('refund copies: when a wrong-amount copy and a right-amount copy share the id, the right one is the backed one (matching is one-to-one, not by age)', [dupWrongFirst.unbacked_refund_copy_cents, dupWrongFirst.duplicate_refund_copies, dupWrongFirst.missing_refund_copy_cents, dupWrongFirst.classification_complete], [5000, 1, 0, false]);

    // a matching copy is fully backed
    const ob = await newOrder();
    const pb = await addPay(ob, { dep: 25661, tip: 5132 });
    const rb = await addRefund(ob, { amount: 4000, status: 'pending', payId: pb.id, pi: pb.pi, version: 'allocated', dep: 4000 });
    await event(rb.re as string, pb.pi, 4000, 'succeeded', rb.id);
    const nb = net(ob);
    eq('refund copies: a matching copy is backed: nothing unbacked, nothing missing, order exact', [nb.unbacked_refund_copy_cents, nb.missing_refund_copy_cents, nb.refund_copies_match_ledger, nb.classification_complete, nb.net_principal_exact_cents], [0, 0, true, true, 21661]);
    const o5 = await newOrder();
    const c5 = await addPay(o5, { dep: 25661, tip: 5132 });
    await addRefund(o5, { amount: 5000, status: 'failed', payId: c5.id, pi: c5.pi, version: 'allocated', dep: 5000 });
    const n5 = net(o5);
    eq('failed refund: nothing is reduced', [n5.total_succeeded_refunds_cents, n5.known_net_deposit_principal_cents, n5.pending_refund_reservations_cents], [0, 25661, 0]);

    // an old negative refund row that was never linked to anything
    const on = await newOrder();
    await addPay(on, { dep: 25661, tip: 5132 });
    await pg.exec(`INSERT INTO public.payments (order_id, type, amount_cents, status, paid_at, payment_method) VALUES ('${on}', 'incidental', -2500, 'succeeded', now(), 'card');`);
    const nn = net(on);
    eq('negative rows: an old, unlinked negative payment row is not a payment and is not subtracted', [nn.gross_recorded_payments_cents, nn.recorded_net_cash_retained_cents, nn.total_succeeded_refunds_cents], [30793, 30793, 0]);
    eq('negative rows: ...but it is evidence of money returned that no refund row shows, so the order is not exact', [nn.unbacked_refund_copy_cents, nn.classification_complete, nn.net_principal_exact_cents], [2500, false, null]);

    // not captured payments
    const o6 = await newOrder();
    await addPay(o6, { dep: 1000, status: 'pending' });
    await addPay(o6, { dep: 2000, status: 'failed' });
    await addPay(o6, { dep: 3000 });
    eq('statuses: pending and failed payments are not collected', net(o6).gross_recorded_payments_cents, 3000);
    const o7 = await newOrder();
    await addPay(o7, { dep: 4000 });
    await addPay(o7, { dep: 2500, status: 'refunded' });
    const n7 = net(o7);
    eq('statuses: a historic "refunded" payment is not counted and makes the order inexact', [n7.gross_recorded_payments_cents, n7.legacy_refunded_status_payments, n7.classification_complete, n7.net_principal_exact_cents], [4000, 1, false, null]);
  }

  // =================================================================================================================
  // 5. Unknown allocations never produce an exact number
  // =================================================================================================================
  {
    const o1 = await newOrder();
    const p1 = await addPay(o1, { dep: 25661, tip: 5132 });
    const r1 = await addRefund(o1, { amount: 10000, status: 'pending', payId: p1.id, pi: p1.pi });
    await event(r1.re as string, p1.pi, 10000, 'succeeded', r1.id);
    const n1 = net(o1);
    eq('unclassified refund: the whole amount is unclassified and the recorded cash figure is still exact', [n1.total_succeeded_refunds_cents, n1.unclassified_succeeded_refunds_cents, n1.known_principal_refunded_cents, n1.tips_refunded_cents, n1.recorded_net_cash_retained_cents], [10000, 10000, 0, 0, 20793]);
    ok('unclassified refund: exact net principal and tips are NULL, completeness is false', n1.net_principal_exact_cents === null && n1.net_tips_exact_cents === null && n1.classification_complete === false && n1.exact_net_available === false && n1.has_unclassified_transactions === true);
    eq('unclassified refund: the known figures do not pretend the refund came from anywhere', [n1.known_net_deposit_principal_cents, n1.known_net_tips_cents], [25661, 5132]);

    const o2 = await newOrder();
    await addPay(o2, { dep: 25661, tip: 5132 });
    await addPay(o2, { classified: false, amount: 10000 });
    const n2 = net(o2);
    eq('unclassified payment: it is counted in gross but not in the known principal or tips', [n2.gross_recorded_payments_cents, n2.unclassified_gross_payments_cents, n2.known_gross_principal_cents, n2.known_gross_tips_cents], [40793, 10000, 25661, 5132]);
    ok('unclassified payment: exact net principal is unavailable', n2.net_principal_exact_cents === null && n2.net_tips_exact_cents === null && n2.classification_complete === false && n2.has_unclassified_transactions === true);
    ok('unclassified payment: no safe bounds are claimed (none are returned)', typeof n2 === 'object' && !('net_principal_min_cents' in n2) && !('net_principal_max_cents' in n2));

    const o3 = await newOrder();
    const p3 = await addPay(o3, { dep: 25661, tip: 5132 });
    await addRefund(o3, { amount: 3000, status: 'pending', payId: p3.id, pi: p3.pi, version: 'null-ledger', reId: null });
    const n3 = net(o3);
    eq('historic unsettled: a legacy refund that never left pending is reported distinctly', [n3.historic_unsettled_refunds_cents, n3.pending_refund_reservations_cents, n3.total_succeeded_refunds_cents], [3000, 3000, 0]);
    ok('historic unsettled: it makes the order inexact', n3.classification_complete === false && n3.net_principal_exact_cents === null);

    const o4 = await newOrder();
    const p4 = await addPay(o4, { dep: 25661, tip: 5132 });
    await addRefund(o4, { amount: 2000, status: 'pending', payId: p4.id, pi: p4.pi, reId: `re_dup_${TAG}`, version: 'null-ledger' });
    await addRefund(o4, { amount: 2000, status: 'pending', payId: p4.id, pi: p4.pi, reId: `re_dup_${TAG}`, version: 'null-ledger' });
    const n4 = net(o4);
    eq('duplicate legacy rows: the same provider refund recorded twice is reported, not silently merged', [n4.duplicate_refund_ids, n4.classification_complete], [1, false]);

    const o4b = await newOrder();
    const p4b = await addPay(o4b, { dep: 25661, tip: 5132 });
    await addRefund(o4b, { amount: 2000, status: 'succeeded', payId: p4b.id, pi: p4b.pi, reId: `re_dupc_${TAG}`, version: 'allocated-null-ledger', dep: 2000 });
    await addRefund(o4b, { amount: 2000, status: 'succeeded', payId: p4b.id, pi: p4b.pi, reId: `re_dupc_${TAG}`, version: 'allocated-null-ledger', dep: 2000 });
    const n4b = net(o4b);
    eq('duplicate classified rows: the only uncertainty is the repeated provider refund, and it alone makes the order inexact', [n4b.duplicate_refund_ids, n4b.unclassified_succeeded_refunds_cents, n4b.historic_unsettled_refunds_cents, n4b.classification_complete, n4b.net_principal_exact_cents], [1, 0, 0, false, null]);

    const o5 = await newOrder();
    const p5 = await addPay(o5, { dep: 1000 });
    await addRefund(o5, { amount: 1500, status: 'pending', payId: p5.id, pi: p5.pi, version: 'allocated', dep: 1500 });
    await pg.exec(`UPDATE public.order_refunds SET status = 'succeeded' WHERE order_id = '${o5}';`);
    const n5 = net(o5);
    ok('inconsistent: refunds above what was collected are flagged and no exact figure is given', n5.inconsistent === true && n5.net_principal_exact_cents === null && n5.classification_complete === false);
  }

  // =================================================================================================================
  // 6. The $307.93 example
  // =================================================================================================================
  {
    const order = await newOrder();
    const pay = await addPay(order, { dep: 25661, tip: 5132 });
    eq('example: the payment totals $307.93', net(order).gross_recorded_payments_cents, 30793);
    const classified = await addRefund(order, { amount: 10000, status: 'pending', payId: pay.id, pi: pay.pi, version: 'allocated', dep: 7500, tip: 2500 });
    await event(classified.re as string, pay.pi, 10000, 'succeeded', classified.id);
    const n = net(order);
    eq('example: classified $100 refund ($75 deposit + $25 tip): net deposit $181.61, net tip $26.32, net payment $207.93', [n.known_net_deposit_principal_cents, n.known_net_tips_cents, n.recorded_net_cash_retained_cents], [18161, 2632, 20793]);
    ok('example: the classified result is exact', n.classification_complete === true && n.net_principal_exact_cents === 18161 && n.net_tips_exact_cents === 2632);
    const second = await addRefund(order, { amount: 5000, status: 'pending', payId: pay.id, pi: pay.pi, version: 'allocated', dep: 5000 });
    await event(second.re as string, pay.pi, 5000, 'succeeded', second.id);
    const n2 = net(order);
    eq('example: a second partial refund of $50 deposit principal', [n2.known_net_deposit_principal_cents, n2.known_net_tips_cents, n2.recorded_net_cash_retained_cents], [13161, 2632, 15793]);

    const o2 = await newOrder();
    const pay2 = await addPay(o2, { dep: 25661, tip: 5132 });
    const unc = await addRefund(o2, { amount: 10000, status: 'pending', payId: pay2.id, pi: pay2.pi });
    await event(unc.re as string, pay2.pi, 10000, 'succeeded', unc.id);
    const u = net(o2);
    ok('example: the same $100 refund without an allocation is unclassified: cash is exact, principal and tips are not', u.recorded_net_cash_retained_cents === 20793 && u.net_principal_exact_cents === null && u.net_tips_exact_cents === null && u.unclassified_succeeded_refunds_cents === 10000);
  }

  // =================================================================================================================
  // 7. Who may run it
  //    Role-by-role behaviour with the REAL row-level security (Admin, Master, Crew, customer) is proved in coreDatabaseAccess.test.ts
  //    (database with the core lockdown migration). This scratch database has no row-level security policies, so here only the
  //    function-level privileges are checked.
  // =================================================================================================================
  {
    const order = await newOrder();
    await addPay(order, { dep: 25661, tip: 5132 });
    const call = `public.order_net_financials('${order}')::jsonb ->> 'gross_recorded_payments_cents'`;
    eq('authorization: the service role gets the figures', asRole('service_role', null, call), '30793');
    eq('authorization: anonymous cannot execute the function', asRole('anon', null, call), 'DENIED');
    eq('authorization: the superuser role is not the service role, so the guard returns NULL rather than figures', ((): string => {
      const p = spawnSync(db.psql, [...psqlArgs(db.db)], { input: `SELECT 'R|' || COALESCE(public.order_net_financials('${order}')::text, 'NULL');`, encoding: 'utf8' });
      return String(p.stdout).split(String.fromCharCode(10)).find((l: string) => l.startsWith('R|'))?.slice(2).trim() ?? 'ERR';
    })(), 'NULL');
    eq('authorization: a NULL order id returns NULL', asRole('service_role', null, `public.order_net_financials(NULL)::text`), 'NULL');
    eq('authorization: an unknown order returns NULL', asRole('service_role', null, `public.order_net_financials('${nextId()}')::text`), 'NULL');
    eq('authorization: no browser role can write the refund table (insert, update, delete are not granted)', ['authenticated', 'anon'].flatMap((r) => ['INSERT', 'UPDATE', 'DELETE'].map((k) => asRole(r, null, `has_table_privilege('${r}', 'public.order_refunds', '${k}')`))), Array(6).fill('false'));
  }

  // =================================================================================================================
  // 8. Read-only; operational columns untouched
  // =================================================================================================================
  {
    const order = await newOrder();
    const pay = await addPay(order, { dep: 25661, tip: 5132 });
    const r = await addRefund(order, { amount: 1000, status: 'pending', payId: pay.id, pi: pay.pi, version: 'allocated', dep: 1000 });
    await pg.exec(`UPDATE public.orders SET deposit_paid_cents = 25661, balance_paid_cents = 0, tip_cents = 5132, stripe_payment_status = 'paid' WHERE id = '${order}';`);
    const before = await orderRow(order);
    for (let i = 0; i < 3; i++) net(order);
    ok('read-only: running the function leaves the order row exactly as it was', JSON.stringify(await orderRow(order)) === JSON.stringify(before));
    const payBefore = (await pg.query(`SELECT count(*) AS n, sum(amount_cents) AS s FROM public.payments WHERE order_id = '${order}'`))[0];
    const reBefore = await refundRow(r.id);
    net(order);
    const payAfter = (await pg.query(`SELECT count(*) AS n, sum(amount_cents) AS s FROM public.payments WHERE order_id = '${order}'`))[0];
    ok('read-only: it writes no payment and does not change any refund row', JSON.stringify(payBefore) === JSON.stringify(payAfter) && JSON.stringify(await refundRow(r.id)) === JSON.stringify(reBefore));
    tryExec(fs.readFileSync(PAY_MIGRATION_5, 'utf8'));
    ok('read-only: applying the migration again does not change the order row', JSON.stringify(await orderRow(order)) === JSON.stringify(before));
    await event(r.re as string, pay.pi, 1000, 'succeeded', r.id);
    const after = await orderRow(order);
    const keep = ['deposit_due_cents', 'deposit_paid_cents', 'balance_due_cents', 'balance_paid_cents', 'tip_cents', 'stripe_payment_status', 'status'];
    eq('operational columns: a classified refund settling leaves them exactly as before (only the existing refund total moves)', keep.map((k) => after[k]), keep.map((k) => before[k]));
    eq('operational columns: the existing refund total counted it once', after.total_refunded_cents, 1000);
    ok('operational columns: nothing was charged or created (still one payment and one refund copy)', Number((await pg.query(`SELECT count(*) AS n FROM public.payments WHERE order_id = '${order}' AND amount_cents > 0`))[0].n) === 1);
    ok('operational columns: the net result matches the refund (net deposit principal 24661)', net(order).known_net_deposit_principal_cents === 24661 && Number(net(order).cached_deposit_paid_cents) === 25661);
    eq('operational columns: the cached principal matches the ledger', net(order).cached_principal_matches_ledger, true);
  }

  // cleanup
  const ids = createdOrders.map((i) => `'${i}'`).join(',') || "'00000000-0000-0000-0000-000000000000'";
  await pg.exec(`UPDATE public.payments SET refunded_payment_id = NULL WHERE order_id IN (${ids});
    DELETE FROM public.order_refunds WHERE order_id IN (${ids});
    DELETE FROM public.order_changelog WHERE order_id IN (${ids});
    DELETE FROM public.payments WHERE order_id IN (${ids});
    DELETE FROM public.orders WHERE id IN (${ids});
    DELETE FROM public.user_roles WHERE user_id IN ('${ADMIN}', '${MASTER}', '${CREW}', '${CUST}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN}', '${MASTER}', '${CREW}', '${CUST}');`);
  pg.close();
  finish();
})().catch((e) => {
  console.error(e);
  throw e;
});

function finish() {
  console.log(`Refund accounting tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} refund accounting test(s) failed`);
}
