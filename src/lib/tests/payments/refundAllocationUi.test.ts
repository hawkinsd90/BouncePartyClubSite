// The shared Admin refund screen: money parsing, the request an Admin builds, its identity, reading stored refunds, the controller that
// drives the screen (against a scripted server), the drawn screen (rendered with react-dom/server), and the wiring of the three entry
// points. The same controller is exercised against the REAL refund function and database in refundSafety.test.ts.
// Run: node node_modules/jiti/bin/jiti.js src/lib/refundAllocationUi.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MAX_ALLOCATION_LINES, allocationSignature, availabilitySnapshot, buildAllocation, canonicalLines, centsToInput, componentSummary, formatCents, parseDollars,
  progressOf, reasonToSend, reconstructStoredRequest, rowState, submitBodyForStored,
  type OverviewOperation, type OverviewPayment, type OverviewRow, type RefundOverview,
} from '../../payments/refundAllocationRequest';
import { RefundController, type RefundApi } from '../../payments/refundController';
import { allocationAttemptFor, classifyRefundResponse } from '../../payments/refundOperationKey';
// The screen is a .tsx module and the runner only reads .ts, so it is compiled here with the TypeScript compiler (JSX as in the app) and
// evaluated with the real react / lucide-react and the real project modules it imports.
function loadTsx(file: string): any {
  const path = require('path');
  const ts = require('typescript');
  const abs = path.resolve(file);
  const out = ts.transpileModule(require('fs').readFileSync(abs, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod: any = { exports: {} };
  const req = (id: string) => (id.startsWith('.') ? require(path.resolve(path.dirname(abs), id)) : require(id));
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
}
const { RefundAllocationView } = loadTsx('src/components/admin/orders/refunds/RefundAllocationPanel.tsx');
const noop = () => {};
const NO_HANDLERS = { onInput: noop, onMax: noop, onReason: noop, onReview: noop, onBack: noop, onConfirm: noop, onResume: noop, onRetryLoad: noop, onDismiss: noop };

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

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORDER = U(900);

// ---- fixtures ---------------------------------------------------------------------------------------------------------
const zero = { deposit_cents: 0, balance_cents: 0, tip_cents: 0, unclassified_cents: 0 };
function pay(n: number, o: { dep?: number; bal?: number; tip?: number; refunded?: Partial<typeof zero>; pending?: Partial<typeof zero>; avail?: [number, number, number]; remaining?: number; reason?: OverviewPayment['reason_unavailable']; classified?: boolean; refundable?: boolean; brand?: string | null; last4?: string | null; unknown?: boolean } = {}): OverviewPayment {
  const dep = o.dep ?? 0, bal = o.bal ?? 0, tip = o.tip ?? 0;
  const refunded = { ...zero, ...(o.refunded ?? {}) };
  const pending = { ...zero, ...(o.pending ?? {}) };
  const used = refunded.deposit_cents + refunded.balance_cents + refunded.tip_cents + refunded.unclassified_cents + pending.deposit_cents + pending.balance_cents + pending.tip_cents + pending.unclassified_cents;
  const avail = o.avail ?? [dep - refunded.deposit_cents - pending.deposit_cents, bal - refunded.balance_cents - pending.balance_cents, tip - refunded.tip_cents - pending.tip_cents];
  return {
    id: U(n), type: dep > 0 ? 'deposit' : 'balance', paid_at: '2030-05-01T15:00:00Z', created_at: '2030-05-01T15:00:00Z', amount_cents: dep + bal + tip,
    payment_method: 'card', payment_brand: o.brand === undefined ? 'visa' : o.brand, payment_last4: o.last4 === undefined ? '4242' : o.last4,
    refundable: o.refundable ?? true, classified: o.classified ?? true, deposit_cents: dep, balance_cents: bal, tip_cents: tip,
    refunded, pending, remaining_total_cents: o.remaining ?? dep + bal + tip - used, has_unclassified_history: o.unknown ?? false,
    reason_unavailable: o.reason ?? null,
    available: { deposit_cents: o.reason ? 0 : Math.max(0, avail[0]), balance_cents: o.reason ? 0 : Math.max(0, avail[1]), tip_cents: o.reason ? 0 : Math.max(0, avail[2]) },
  };
}
const row = (n: number, o: Partial<OverviewRow> & { amount: number }): OverviewRow => ({
  id: U(500 + n), operation_index: o.operation_index ?? 0, payment_id: o.payment_id ?? null, amount_cents: o.amount, status: o.status ?? 'pending', stripe_refund_id: o.stripe_refund_id ?? null,
  provider_attempted: o.provider_attempted ?? false, failure_reason: null, created_at: '2030-05-02T12:00:00Z', reason: o.reason ?? 'cancellation',
  deposit_cents: o.deposit_cents ?? null, balance_cents: o.balance_cents ?? null, tip_cents: o.tip_cents ?? null, unclassified_cents: o.unclassified_cents ?? null,
  allocation_version: o.allocation_version ?? null,
});
function allocatedOp(key: string, parts: Array<{ pay: number; d: number; b: number; t: number; status?: string; sid?: string | null; attempted?: boolean }>, over: Partial<OverviewOperation> = {}): OverviewOperation {
  const sorted = [...parts].sort((a, b) => (U(a.pay) < U(b.pay) ? -1 : 1));
  const rows = sorted.map((p, i) => row(i + 10, { amount: p.d + p.b + p.t, operation_index: i, payment_id: U(p.pay), status: p.status ?? 'pending', stripe_refund_id: p.sid ?? null, provider_attempted: p.attempted ?? false, deposit_cents: p.d, balance_cents: p.b, tip_cents: p.t, unclassified_cents: 0, allocation_version: 1 }));
  const total = rows.reduce((a, r) => a + r.amount_cents, 0);
  return {
    operation_key: key, created_at: '2030-05-02T12:00:00Z', kind: 'allocated', unfinished: rows.some((r) => r.status === 'pending'), verified: true, request_amount_cents: total,
    request_allocation: allocationSignature(sorted.map((p) => ({ paymentId: U(p.pay), depositPrincipalCents: p.d, balancePrincipalCents: p.b, tipCents: p.t }))), rows, ...over,
  };
}
const overviewOf = (payments: OverviewPayment[], extra: Partial<RefundOverview> = {}): RefundOverview => ({
  order_id: ORDER, payments, operations: [], refunds: [], unlinked_history_cents: 0, refundable_payment_count: payments.filter((p) => p.refundable).length, ...extra,
});

(async () => {
  // =================================================================================================================
  // 1. Money: exact decimal parsing
  // =================================================================================================================
  const parse = (s: string) => { const r = parseDollars(s); return r.ok ? r.cents : `err`; };
  eq('money: an empty entry is zero', parse(''), 0);
  eq('money: blanks around a number are ignored', parse('  12.50 '), 1250);
  eq('money: whole dollars', parse('75'), 7500);
  eq('money: one decimal', parse('1.1'), 110);
  eq('money: two decimals', parse('256.61'), 25661);
  eq('money: a leading decimal point', parse('.5'), 50);
  eq('money: leading zeros', parse('007.05'), 705);
  eq('money: values that floating point gets wrong (0.29, 4.35, 1.15, 19.99, 0.07)', [parse('0.29'), parse('4.35'), parse('1.15'), parse('19.99'), parse('0.07')], [29, 435, 115, 1999, 7]);
  eq('money: the sum of 0.1 and 0.2 stays exact when added as cents', (parse('0.10') as number) + (parse('0.20') as number), 30);
  for (const bad of ['-1', '-0.01', '1.005', '12.345', '1e3', '1E3', 'abc', '12abc', '$5', '5,00', '1,000.00', '1.2.3', '12.', 'Infinity', 'NaN', '0x10', '+5', ' - 5', '١٢']) {
    eq(`money: "${bad}" is refused`, parse(bad), 'err');
  }
  eq('money: the largest allowed amount', parse('999999.99'), 99999999);
  eq('money: one cent above it', parse('1000000.00'), 'err');
  eq('money: an absurdly long number', parse('9'.repeat(40)), 'err');
  eq('money: formatting', [formatCents(25661), formatCents(5), formatCents(0), formatCents(100), formatCents(-250)], ['$256.61', '$0.05', '$0.00', '$1.00', '-$2.50']);
  eq('money: cents back into an input', [centsToInput(7500), centsToInput(5), centsToInput(25661)], ['75.00', '0.05', '256.61']);
  eq('money: a reason is required, and "other" needs words', [reasonToSend('cancellation', '').ok, reasonToSend('other', '  ').ok, reasonToSend('other', 'Weather').ok, reasonToSend('nonsense', '').ok], [true, false, true, false]);

  // =================================================================================================================
  // 2. Building the request from the Admin's entries
  // =================================================================================================================
  {
    const a = pay(1, { dep: 25661, tip: 5132 });
    const ov = [a];
    const r = buildAllocation(ov, { [a.id]: { deposit: '75.00', balance: '', tip: '25.00' } });
    eq('request: the policy example (75.00 deposit + 25.00 tip of 307.93) is valid', [r.ok, r.totalCents, r.depositCents, r.balanceCents, r.tipCents, r.paymentsAffected], [true, 10000, 7500, 0, 2500, 1]);
    eq('request: its line carries all three components for the payment', r.lines, [{ paymentId: a.id, depositPrincipalCents: 7500, balancePrincipalCents: 0, tipCents: 2500 }]);
    eq('request: nothing entered is refused', [buildAllocation(ov, {}).ok, buildAllocation(ov, {}).formError], [false, 'Enter an amount to refund.']);
    eq('request: only zeros is refused', buildAllocation(ov, { [a.id]: { deposit: '0', balance: '0.00', tip: '' } }).formError, 'Enter an amount to refund.');
    eq('request: a negative amount is refused', Object.keys(buildAllocation(ov, { [a.id]: { deposit: '-5', balance: '', tip: '' } }).fieldErrors), [`${a.id}.deposit`]);
    eq('request: a third decimal is refused', Object.keys(buildAllocation(ov, { [a.id]: { deposit: '1.005', balance: '', tip: '' } }).fieldErrors), [`${a.id}.deposit`]);
    eq('request: letters are refused', Object.keys(buildAllocation(ov, { [a.id]: { deposit: '', balance: '', tip: 'ten' } }).fieldErrors), [`${a.id}.tip`]);
    eq('request: exactly the available amount is accepted', buildAllocation(ov, { [a.id]: { deposit: '256.61', balance: '', tip: '51.32' } }).ok, true);
    const over = buildAllocation(ov, { [a.id]: { deposit: '256.62', balance: '', tip: '' } });
    eq('request: one cent above what is available is refused, naming the available amount', [over.ok, over.fieldErrors[`${a.id}.deposit`]], [false, 'More than the $256.61 available.']);
    eq('request: a tip above the available tip is refused even when principal remains', buildAllocation(ov, { [a.id]: { deposit: '', balance: '', tip: '51.33' } }).ok, false);
    eq('request: a balance amount on a payment with no balance is refused', buildAllocation(ov, { [a.id]: { deposit: '', balance: '0.01', tip: '' } }).ok, false);
    // several payments
    const b = pay(2, { bal: 10000 });
    const c = pay(3, { tip: 3000 });
    const multi = buildAllocation([a, b, c], { [a.id]: { deposit: '75.00', balance: '', tip: '25.00' }, [b.id]: { deposit: '', balance: '40.00', tip: '' } });
    eq('request: two payments: one line each, zero-total payments left out, total 140.00', [multi.ok, multi.lines.map((l) => [l.paymentId, l.depositPrincipalCents, l.balancePrincipalCents, l.tipCents]), multi.totalCents, multi.paymentsAffected], [true, [[a.id, 7500, 0, 2500], [b.id, 0, 4000, 0]], 14000, 2]);
    eq('request: the totals by component across payments', [multi.depositCents, multi.balanceCents, multi.tipCents], [7500, 4000, 2500]);
    eq('request: no payment appears twice', new Set(multi.lines.map((l) => l.paymentId)).size, multi.lines.length);
    eq('request: an entry for a payment that is not on the screen is ignored', buildAllocation([a], { [a.id]: { deposit: '1.00', balance: '', tip: '' }, [U(77)]: { deposit: '5.00', balance: '', tip: '' } }).lines.length, 1);
    // unavailable payments are never sent
    const un = pay(4, { dep: 5000, reason: 'unclassified', classified: false });
    const cash = pay(5, { bal: 5000, refundable: false, reason: 'not_refundable' });
    const amb = pay(6, { dep: 5000, reason: 'history_ambiguous' });
    const rr = buildAllocation([un, cash, amb, a], { [un.id]: { deposit: '10', balance: '', tip: '' }, [cash.id]: { deposit: '', balance: '10', tip: '' }, [amb.id]: { deposit: '10', balance: '', tip: '' }, [a.id]: { deposit: '1', balance: '', tip: '' } });
    eq('request: payments that cannot be refunded by component are never included, whatever was typed', rr.lines.map((l) => l.paymentId), [a.id]);
    const odd = { ...pay(9, { dep: 5000, reason: 'unclassified', classified: false }), available: { deposit_cents: 5000, balance_cents: 0, tip_cents: 0 }, remaining_total_cents: 5000 };
    eq('request: a payment marked unavailable is never included, even if its figures say there is something available', buildAllocation([odd, a], { [odd.id]: { deposit: '10', balance: '', tip: '' }, [a.id]: { deposit: '1', balance: '', tip: '' } }).lines.map((l) => l.paymentId), [a.id]);
    // the line limit
    const many = Array.from({ length: MAX_ALLOCATION_LINES + 1 }, (_, i) => pay(100 + i, { dep: 1000 }));
    const manyIn = Object.fromEntries(many.map((p) => [p.id, { deposit: '1.00', balance: '', tip: '' }]));
    eq('request: more payments than one refund can hold is refused', [buildAllocation(many, manyIn).ok, buildAllocation(many, manyIn).formError], [false, `A single refund can include at most ${MAX_ALLOCATION_LINES} payments.`]);
    eq('request: exactly the limit is accepted', buildAllocation(many.slice(0, MAX_ALLOCATION_LINES), manyIn).ok, true);
    // the payment total limit
    const tight = pay(7, { dep: 5000, tip: 1000, avail: [5000, 0, 1000], remaining: 5500 });
    eq('request: a line larger than the payment can still return in total is refused', buildAllocation([tight], { [tight.id]: { deposit: '50.00', balance: '', tip: '10.00' } }).ok, false);
    // exactness
    const x = pay(8, { dep: 12345 });
    eq('request: entered dollars become the exact cents (123.45)', buildAllocation([x], { [x.id]: { deposit: '123.45', balance: '', tip: '' } }).lines[0].depositPrincipalCents, 12345);
  }

  // =================================================================================================================
  // 3. Identity of a request
  // =================================================================================================================
  {
    const l1 = { paymentId: U(1), depositPrincipalCents: 7500, balancePrincipalCents: 0, tipCents: 2500 };
    const l2 = { paymentId: U(2), depositPrincipalCents: 0, balancePrincipalCents: 4000, tipCents: 0 };
    eq('identity: the signature is the database form (total, then lines by payment id)', allocationSignature([l2, l1]), `v1|total=14000|${U(1)}:7500:0:2500|${U(2)}:0:4000:0`);
    eq('identity: the same lines in another order are the same request', allocationSignature([l1, l2]), allocationSignature([l2, l1]));
    eq('identity: canonical ordering', canonicalLines([l2, l1]).map((l) => l.paymentId), [U(1), U(2)]);
    const a1 = allocationAttemptFor(null, ORDER, allocationSignature([l1, l2]), 14000);
    eq('identity: an unchanged request keeps its key', allocationAttemptFor(a1, ORDER, allocationSignature([l1, l2]), 14000).key, a1.key);
    eq('identity: reordered equivalent lines keep the key', allocationAttemptFor(a1, ORDER, allocationSignature([l2, l1]), 14000).key, a1.key);
    ok('identity: a changed amount is another request with another key', allocationAttemptFor(a1, ORDER, allocationSignature([{ ...l1, tipCents: 2501 }, l2]), 14001).key !== a1.key);
    ok('identity: the same lines for another order are another request', allocationAttemptFor(a1, U(901), allocationSignature([l1, l2]), 14000).key !== a1.key);
    ok('identity: keys are valid operation keys', /^[A-Za-z0-9_-]{8,64}$/.test(a1.key));
  }

  // =================================================================================================================
  // 4. Reading a stored operation
  // =================================================================================================================
  {
    const op = allocatedOp('op-aaaaaaaa-0001', [{ pay: 1, d: 7500, b: 0, t: 2500 }, { pay: 2, d: 0, b: 4000, t: 0 }]);
    const st = reconstructStoredRequest(op);
    eq('stored: a complete verified allocated operation is rebuilt from its rows', [st.kind, (st as any).totalCents, (st as any).lines], ['allocated', 14000, [{ paymentId: U(1), depositPrincipalCents: 7500, balancePrincipalCents: 0, tipCents: 2500 }, { paymentId: U(2), depositPrincipalCents: 0, balancePrincipalCents: 4000, tipCents: 0 }]]);
    eq('stored: ...and resumed under its OWN key with its exact lines and total', submitBodyForStored(ORDER, op, st), { orderId: ORDER, operationKey: 'op-aaaaaaaa-0001', reason: 'cancellation', amountCents: 14000, allocations: (st as any).lines });
    const review = (o: OverviewOperation) => reconstructStoredRequest(o).kind;
    eq('stored: the database verdict "not verified" fails closed', review({ ...op, verified: false }), 'manual_review');
    eq('stored: a missing row fails closed', review({ ...op, rows: [op.rows[0]] }), 'manual_review');
    eq('stored: no rows fail closed', review({ ...op, rows: [] }), 'manual_review');
    eq('stored: a changed component fails closed (identity no longer matches)', review({ ...op, rows: [{ ...op.rows[0], deposit_cents: 7400, amount_cents: 9900 }, op.rows[1]] }), 'manual_review');
    eq('stored: a component moved between rows fails closed', review({ ...op, rows: [{ ...op.rows[0], tip_cents: 0, deposit_cents: 10000 }, op.rows[1]] }), 'manual_review');
    eq('stored: a nonzero unclassified part fails closed', review({ ...op, rows: [{ ...op.rows[0], unclassified_cents: 5 }, op.rows[1]] }), 'manual_review');
    eq('stored: a row with no allocation inside an allocated operation fails closed', review({ ...op, rows: [{ ...op.rows[0], allocation_version: null }, op.rows[1]] }), 'manual_review');
    eq('stored: a wrong request total fails closed', review({ ...op, request_amount_cents: 14001 }), 'manual_review');
    eq('stored: a duplicate payment fails closed', review({ ...op, rows: [op.rows[0], { ...op.rows[1], payment_id: op.rows[0].payment_id }] }), 'manual_review');
    eq('stored: a wrong identity fails closed', review({ ...op, request_allocation: 'v1|total=14000|x' }), 'manual_review');
    eq('stored: a gap in the row indexes fails closed', review({ ...op, rows: [op.rows[0], { ...op.rows[1], operation_index: 3 }] }), 'manual_review');
    eq('stored: rows that disagree about the reason fail closed', review({ ...op, rows: [op.rows[0], { ...op.rows[1], reason: 'other' }] }), 'manual_review');
    eq('stored: a mixed operation fails closed', review({ ...op, kind: 'mixed' }), 'manual_review');
    const legacy: OverviewOperation = { operation_key: 'op-legacy-0001', created_at: '2030-05-02T12:00:00Z', kind: 'amount_only', unfinished: true, verified: true, request_amount_cents: 3000, request_allocation: null, rows: [row(1, { amount: 3000, operation_index: 0, status: 'pending', provider_attempted: true })] };
    const ls = reconstructStoredRequest(legacy);
    eq('stored: an earlier amount-only operation is resumed as amount-only, with no allocation invented', [ls.kind, submitBodyForStored(ORDER, legacy, ls)], ['amount_only', { orderId: ORDER, operationKey: 'op-legacy-0001', reason: 'cancellation', amountCents: 3000 }]);
    eq('stored: an amount-only operation with an allocated row fails closed', review({ ...legacy, rows: [{ ...legacy.rows[0], allocation_version: 1 }] }), 'manual_review');
    const pr = progressOf(allocatedOp('op-bbbbbbbb-0002', [{ pay: 1, d: 100, b: 0, t: 0, status: 'succeeded' }, { pay: 2, d: 0, b: 50, t: 0, status: 'pending', sid: 're_1' }, { pay: 3, d: 0, b: 0, t: 25, status: 'pending', attempted: true }, { pay: 4, d: 0, b: 0, t: 10, status: 'failed' }, { pay: 5, d: 0, b: 0, t: 5, status: 'pending' }]));
    eq('stored: progress separates refunded, pending at Stripe, result not known, failed and reserved', [pr.succeededCents, pr.pendingCents, pr.unresolvedCents, pr.failedCents, pr.reservedCents, pr.requestedCents], [100, 50, 25, 10, 5, 190]);
    eq('stored: row states', [rowState({ status: 'pending', stripe_refund_id: null, provider_attempted: false }), rowState({ status: 'pending', stripe_refund_id: null, provider_attempted: true }), rowState({ status: 'pending', stripe_refund_id: 're_x', provider_attempted: true }), rowState({ status: 'failed', stripe_refund_id: null, provider_attempted: true })], ['reserved', 'unresolved', 'pending', 'failed']);
    eq('history: an allocated refund shows its parts', componentSummary({ allocation_version: 1, deposit_cents: 7500, balance_cents: 0, tip_cents: 2500, unclassified_cents: 0 }), '$75.00 deposit · $25.00 tip');
    eq('history: a historical refund says its allocation is unavailable and does not guess', componentSummary({ allocation_version: null, deposit_cents: null, balance_cents: null, tip_cents: null, unclassified_cents: null }), 'Allocation unavailable — historical refund');
  }

  // =================================================================================================================
  // 5. How a server answer is understood
  // =================================================================================================================
  {
    const c = (status: number, data: any) => classifyRefundResponse(status, data);
    eq('answers: success', [c(200, { success: true, status: 'succeeded', requestedCents: 10000 }).kind, c(200, { success: true, status: 'succeeded', requestedCents: 10000 }).keepKey], ['succeeded', false]);
    eq('answers: pending at Stripe is not a completed refund', c(200, { success: true, status: 'pending', requestedCents: 10000 }).kind, 'pending');
    eq('answers: 202 unresolved keeps the identity', [c(202, { success: true, status: 'unresolved' }).kind, c(202, { success: true, status: 'unresolved' }).keepKey], ['unresolved', true]);
    eq('answers: 207 partial', c(207, { status: 'partial', succeededCents: 100, requestedCents: 140, failedCents: 40 }).kind, 'partial');
    eq('answers: 422 failed is final', [c(422, { status: 'failed' }).kind, c(422, { status: 'failed' }).keepKey], ['failed', false]);
    eq('answers: a different refund is unsettled', c(409, { code: 'UNSETTLED_REFUND_EXISTS', resumeOperationKey: 'k-1234567', resumeAmountCents: 500 }).kind, 'unsettled');
    for (const code of ['DEPOSIT_CAPACITY_EXCEEDED', 'BALANCE_CAPACITY_EXCEEDED', 'TIP_CAPACITY_EXCEEDED', 'EXCEEDS_REFUNDABLE', 'REFUND_HISTORY_AMBIGUOUS', 'PAYMENT_UNCLASSIFIED', 'INVALID_ALLOCATION']) {
      eq(`answers: ${code} is a refusal that keeps no key`, [c(400, { code }).kind, c(400, { code }).keepKey, c(400, { code }).message.length > 20], ['rejected', false, true]);
    }
    eq('answers: a key conflict is its own kind and keeps no key', [c(409, { code: 'OPERATION_KEY_REUSED' }).kind, c(409, { code: 'OPERATION_KEY_REUSED' }).keepKey], ['conflict', false]);
    eq('answers: a reservation failure keeps the identity (the refund may have been started)', [c(500, { success: false, code: 'REFUND_RESERVATION_FAILED', error: 'x' }).kind, c(500, { code: 'REFUND_RESERVATION_FAILED' }).keepKey], ['unresolved', true]);
    eq('answers: a body that is not JSON is never a success, even with status 200', [c(200, null).kind, c(200, null).keepKey, c(502, null).kind, c(0, null).kind], ['unresolved', true, 'unresolved', 'unresolved']);
  }

  // =================================================================================================================
  // 6. The controller, against a scripted server
  // =================================================================================================================
  const wait = () => new Promise((r) => setTimeout(r, 0));
  function scripted(initial: RefundOverview) {
    const calls = { load: 0, submit: [] as any[] };
    let current = initial;
    let submitImpl: (b: any) => Promise<{ status: number; data: any }> = async () => ({ status: 200, data: { success: true, status: 'succeeded', requestedCents: 0 } });
    let loadFail = false;
    const api: RefundApi = {
      loadOverview: async () => { calls.load++; if (loadFail) throw new Error('boom'); return JSON.parse(JSON.stringify(current)); },
      submit: async (b) => { calls.submit.push(JSON.parse(JSON.stringify(b))); return submitImpl(b); },
    };
    return { api, calls, set: (o: RefundOverview) => { current = o; }, onSubmit: (f: typeof submitImpl) => { submitImpl = f; }, failLoads: (v: boolean) => { loadFail = v; } };
  }
  const fill = (ctl: RefundController, p: OverviewPayment, d: string, b: string, t: string) => { ctl.setInput(p.id, 'deposit', d); ctl.setInput(p.id, 'balance', b); ctl.setInput(p.id, 'tip', t); };

  {
    const a = pay(1, { dep: 25661, tip: 5132 });
    const s = scripted(overviewOf([a]));
    const ctl = new RefundController(s.api, ORDER);
    await ctl.load();
    eq('controller: opening reads the details and sends nothing; the default refund is zero', [ctl.state.phase, s.calls.submit.length, ctl.sentCount, ctl.state.inputs, ctl.built()?.totalCents], ['ready', 0, 0, {}, 0]);
    await ctl.load(); await ctl.load();
    eq('controller: refreshing never sends anything', s.calls.submit.length, 0);
    await ctl.review();
    eq('controller: reviewing nothing shows a message and does not advance', [ctl.state.phase, ctl.state.formError], ['ready', 'Enter an amount to refund.']);
    fill(ctl, a, '75.00', '', '25.00');
    await ctl.review();
    eq('controller: a valid entry reaches the confirmation, still nothing sent', [ctl.state.phase, ctl.state.review?.totalCents, ctl.state.review?.depositCents, ctl.state.review?.tipCents, s.calls.submit.length], ['review', 10000, 7500, 2500, 0]);
    ctl.cancelReview();
    eq('controller: going back returns to editing with the entries kept', [ctl.state.phase, ctl.state.inputs[a.id].deposit], ['ready', '75.00']);
    await ctl.review();
    // duplicate clicks: two confirms at once send one request
    let release: (v: any) => void = () => {};
    s.onSubmit(() => new Promise((res) => { release = res; }));
    const first = ctl.confirm();
    const second = ctl.confirm();
    const third = ctl.confirm();
    await wait();
    eq('controller: duplicate clicks while a request is in flight send exactly one', [s.calls.submit.length, ctl.state.phase], [1, 'submitting']);
    ctl.setInput(a.id, 'deposit', '1.00');
    eq('controller: entries cannot be edited while the request is in flight', ctl.state.inputs[a.id].deposit, '75.00');
    release({ status: 200, data: { success: true, status: 'succeeded', requestedCents: 10000, succeededCents: 10000, pendingCents: 0, failedCents: 0, unresolvedCents: 0 } });
    await Promise.all([first, second, third]);
    eq('controller: the request carries the exact allocation, the total and one key', s.calls.submit[0], { orderId: ORDER, operationKey: s.calls.submit[0].operationKey, reason: 'cancellation', amountCents: 10000, allocations: [{ paymentId: a.id, depositPrincipalCents: 7500, balancePrincipalCents: 0, tipCents: 2500 }] });
    eq('controller: success is shown, the form is cleared and open again, nothing is frozen', [ctl.state.result?.kind, ctl.state.phase, ctl.state.inputs, ctl.state.frozen], ['succeeded', 'ready', {}, null]);
    eq('controller: a success does not submit again by itself', s.calls.submit.length, 1);
  }
  {
    // an answer that never arrives, or is not JSON: the request identity survives, and it can only be resumed
    for (const mode of ['timeout', 'not-json']) {
      const a = pay(1, { dep: 25661, tip: 5132 });
      const s = scripted(overviewOf([a]));
      const ctl = new RefundController(s.api, ORDER);
      await ctl.load();
      fill(ctl, a, '75.00', '', '25.00');
      await ctl.review();
      s.onSubmit(async () => { if (mode === 'timeout') throw new Error('network'); return { status: 200, data: null }; });
      await ctl.confirm();
      const key1 = s.calls.submit[0].operationKey;
      eq(`controller (${mode}): the result is unknown, the screen goes to "refund in progress", the request is frozen`, [ctl.state.phase, ctl.state.result?.kind, ctl.state.frozen?.attempt.key, ctl.state.recoveries.length, ctl.state.recoveries[0]?.source], ['recovery', 'unresolved', key1, 1, 'local']);
      ctl.setInput(a.id, 'deposit', '1.00');
      await ctl.review();
      eq(`controller (${mode}): the frozen request cannot be edited or replaced by another`, [ctl.state.inputs[a.id].deposit, ctl.state.phase, s.calls.submit.length], ['75.00', 'recovery', 1]);
      s.onSubmit(async () => ({ status: 200, data: { success: true, status: 'succeeded', requestedCents: 10000 } }));
      await ctl.resume(key1);
      eq(`controller (${mode}): resuming sends the SAME key with the SAME allocation`, [s.calls.submit[1].operationKey, s.calls.submit[1].allocations, s.calls.submit[1].amountCents], [key1, s.calls.submit[0].allocations, 10000]);
      eq(`controller (${mode}): once settled the form is open again`, [ctl.state.phase, ctl.state.frozen, ctl.state.result?.kind], ['ready', null, 'succeeded']);
    }
  }
  {
    // a refund found in the database after a reload: rebuilt from its rows and resumed under its own key
    const a = pay(1, { dep: 25661, tip: 5132, pending: { deposit_cents: 7500, tip_cents: 2500 } });
    const b = pay(2, { bal: 10000, pending: { balance_cents: 4000 } });
    const op = allocatedOp('op-stored-0001', [{ pay: 1, d: 7500, b: 0, t: 2500, status: 'pending', sid: 're_a', attempted: true }, { pay: 2, d: 0, b: 4000, t: 0, status: 'pending', sid: null, attempted: true }]);
    const s = scripted(overviewOf([a, b], { operations: [op] }));
    const ctl = new RefundController(s.api, ORDER);
    await ctl.load();
    const r = ctl.state.recoveries[0];
    eq('reload: an unfinished stored refund puts the screen in recovery and shows its original allocation', [ctl.state.phase, r.source, r.kind, r.canResume, r.totalCents, r.lines.map((l) => [l.depositCents, l.balanceCents, l.tipCents])], ['recovery', 'stored', 'allocated', true, 11500 + 2500, [[7500, 0, 2500], [0, 4000, 0]]]);
    eq('reload: its progress is shown (Stripe pending and result not known)', [r.progress?.pendingCents, r.progress?.unresolvedCents], [10000, 4000]);
    fill(ctl, a, '1', '', '');
    eq('reload: nothing can be entered for a new refund while it is unfinished', [ctl.state.inputs, ctl.state.phase], [{}, 'recovery']);
    await ctl.review();
    eq('reload: a new refund cannot be started', [s.calls.submit.length, ctl.state.phase], [0, 'recovery']);
    await ctl.resume('op-stored-0001');
    eq('reload: resuming sends the stored key, the stored lines and the stored total; never a new key', [s.calls.submit[0].operationKey, s.calls.submit[0].allocations, s.calls.submit[0].amountCents, s.calls.submit[0].reason], ['op-stored-0001', canonicalLines(op.rows.map((x) => ({ paymentId: x.payment_id as string, depositPrincipalCents: x.deposit_cents as number, balancePrincipalCents: x.balance_cents as number, tipCents: x.tip_cents as number }))), 14000 - 2500 + 2500 - 0, 'cancellation']);
    // another Admin's session sees the same and sends the same
    const ctl2 = new RefundController(s.api, ORDER);
    await ctl2.load();
    await ctl2.resume('op-stored-0001');
    eq('another Admin: adopts the operation and sends the identical request', JSON.stringify(s.calls.submit[1]), JSON.stringify(s.calls.submit[0]));
    // a stored operation that cannot be rebuilt: no way to send anything
    const bad = { ...op, rows: [op.rows[0], { ...op.rows[1], tip_cents: 1, amount_cents: 4001 }] };
    s.set(overviewOf([a, b], { operations: [bad] }));
    const ctl3 = new RefundController(s.api, ORDER);
    await ctl3.load();
    const before = s.calls.submit.length;
    await ctl3.resume('op-stored-0001');
    eq('incomplete data: a stored refund that does not add up is shown for manual review, cannot be resumed, and sends nothing', [ctl3.state.recoveries[0].kind, ctl3.state.recoveries[0].canResume, s.calls.submit.length - before, ctl3.state.phase], ['manual_review', false, 0, 'recovery']);
    // an earlier amount-only refund stays recoverable the old way
    const legacy: OverviewOperation = { operation_key: 'op-legacy-0002', created_at: '2030-05-02T12:00:00Z', kind: 'amount_only', unfinished: true, verified: true, request_amount_cents: 3000, request_allocation: null, rows: [row(1, { amount: 3000, operation_index: 0, provider_attempted: true })] };
    s.set(overviewOf([a, b], { operations: [legacy] }));
    const ctl4 = new RefundController(s.api, ORDER);
    await ctl4.load();
    await ctl4.resume('op-legacy-0002');
    eq('legacy: an amount-only refund is resumed as amount-only (no allocations key, no invented split)', [s.calls.submit[s.calls.submit.length - 1], 'allocations' in s.calls.submit[s.calls.submit.length - 1]], [{ orderId: ORDER, operationKey: 'op-legacy-0002', reason: 'cancellation', amountCents: 3000 }, false]);
  }
  {
    // changes in what is available stop the review; capacity refusals refresh and re-ask
    const a = pay(1, { dep: 10000, tip: 2000 });
    const s = scripted(overviewOf([a]));
    const ctl = new RefundController(s.api, ORDER);
    await ctl.load();
    fill(ctl, a, '80.00', '', '');
    s.set(overviewOf([pay(1, { dep: 10000, tip: 2000, pending: { deposit_cents: 3000 } })]));
    await ctl.review();
    eq('availability: if the available amounts changed since they were shown, the review stops and the Admin must look again', [ctl.state.phase, ctl.state.notice, s.calls.submit.length, ctl.state.inputs[a.id].deposit], ['ready', 'The amounts available to refund have changed. Please review them before continuing.', 0, '80.00']);
    await ctl.review();
    eq('availability: ...and the entries are NOT silently reduced: they are now checked against the new numbers', [ctl.state.phase, ctl.state.fieldErrors[`${a.id}.deposit`]], ['ready', 'More than the $70.00 available.']);
    ctl.setInput(a.id, 'deposit', '70.00');
    await ctl.review();
    eq('availability: with an entry that fits, the review proceeds', ctl.state.phase, 'review');
    s.onSubmit(async () => ({ status: 400, data: { success: false, code: 'DEPOSIT_CAPACITY_EXCEEDED', paymentId: a.id, remainingCents: 6000 } }));
    s.set(overviewOf([pay(1, { dep: 10000, tip: 2000, pending: { deposit_cents: 4000 } })]));
    await ctl.confirm();
    eq('availability: a capacity refusal from the server refreshes the numbers, keeps no key, and nothing is frozen', [ctl.state.result?.kind, ctl.state.frozen, ctl.state.phase, ctl.state.overview?.payments[0].available.deposit_cents], ['rejected', null, 'ready', 6000]);
    // a refund made elsewhere meanwhile: the screen switches to recovery
    const op = allocatedOp('op-elsewhere-01', [{ pay: 1, d: 500, b: 0, t: 0, status: 'pending', sid: 're_z', attempted: true }]);
    s.set(overviewOf([pay(1, { dep: 10000, tip: 2000, pending: { deposit_cents: 500 } })], { operations: [op] }));
    await ctl.load();
    eq('availability: a refund started elsewhere is noticed on refresh and must be resumed first', [ctl.state.phase, ctl.state.recoveries.length], ['recovery', 1]);
  }
  {
    // A refresh that FAILS is not a refresh: review cannot proceed on numbers that cannot be checked.
    const a = pay(1, { dep: 10000, tip: 2000 });
    const s = scripted(overviewOf([a]));
    const ctl = new RefundController(s.api, ORDER);
    eq('refresh: the first read succeeds', [await ctl.load(), ctl.state.phase], ['ok', 'ready']);
    fill(ctl, a, '25.00', '', '5.00');
    eq('refresh: a successful read with unchanged availability says so', await ctl.load(), 'ok');
    s.failLoads(true);
    await ctl.review();
    eq('refresh: a review whose refresh fails does not advance and shows a clear error', [ctl.state.phase, ctl.state.review, /could not be refreshed/.test(ctl.state.formError ?? ''), ctl.state.notice], ['ready', null, true, null]);
    eq('refresh: ...the entries are kept', ctl.state.inputs[a.id], { deposit: '25.00', balance: '', tip: '5.00' });
    await ctl.confirm();
    eq('refresh: ...and there is no confirmation to press: nothing is sent', [s.calls.submit.length, ctl.sentCount, ctl.state.phase], [0, 0, 'ready']);
    eq('refresh: a failed read is reported as a failure, not as a change in availability', [await ctl.load(), /have changed/.test(ctl.state.notice ?? '')], ['failed', false]);
    s.failLoads(false);
    await ctl.review();
    eq('refresh: after a later successful refresh the same entries can be reviewed', [ctl.state.phase, ctl.state.review?.totalCents, ctl.state.formError], ['review', 3000, null]);
    // a confirmation that is already on screen is not made current by a refresh that fails
    s.failLoads(true);
    eq('refresh: a failed refresh while a confirmation is showing withdraws it', [await ctl.load(), ctl.state.phase, ctl.state.review, /could not be refreshed/.test(ctl.state.formError ?? '')], ['failed', 'ready', null, true]);
    await ctl.confirm();
    eq('refresh: ...it cannot be confirmed from the stale numbers', [s.calls.submit.length, ctl.sentCount], [0, 0]);
    s.failLoads(false);
    await ctl.review();
    eq('refresh: a fresh review is needed, and then it is confirmable again', ctl.state.phase, 'review');
    // a successful read with changed availability still interrupts
    s.set(overviewOf([pay(1, { dep: 10000, tip: 2000, pending: { deposit_cents: 2000 } })]));
    ctl.cancelReview();
    await ctl.review();
    eq('refresh: an availability change still interrupts the review (and is reported as a change)', [ctl.state.phase, ctl.state.notice, ctl.sentCount], ['ready', 'The amounts available to refund have changed. Please review them before continuing.', 0]);
    await ctl.review();
    eq('refresh: ...and the next review proceeds on the new numbers', ctl.state.phase, 'review');
    // a screen that has never read anything has nothing to review
    const s2 = scripted(overviewOf([a]));
    s2.failLoads(true);
    const ctl2 = new RefundController(s2.api, ORDER);
    eq('refresh: the very first read failing is a load error, with nothing to review or send', [await ctl2.load(), ctl2.state.phase, ctl2.built(), s2.calls.submit.length], ['failed', 'load_error', null, 0]);
    await ctl2.review();
    eq('refresh: ...reviewing then does nothing', [ctl2.state.phase, s2.calls.submit.length], ['load_error', 0]);
  }
  {
    // outcomes
    const mk = async (answer: { status: number; data: any }, overviewAfter?: RefundOverview) => {
      const a = pay(1, { dep: 25661, tip: 5132 });
      const b = pay(2, { bal: 10000 });
      const s = scripted(overviewOf([a, b]));
      const ctl = new RefundController(s.api, ORDER);
      await ctl.load();
      fill(ctl, a, '75.00', '', '25.00'); ctl.setInput(b.id, 'balance', '40.00');
      await ctl.review();
      s.onSubmit(async () => answer);
      if (overviewAfter) s.set(overviewAfter);
      await ctl.confirm();
      return { ctl, s, a, b };
    };
    const body = (status: string, extra: any) => ({ success: status === 'succeeded' || status === 'pending', status, requestedCents: 14000, final: true, ...extra });
    let o = await mk({ status: 200, data: body('succeeded', { succeededCents: 14000, pendingCents: 0, failedCents: 0, unresolvedCents: 0 }) });
    eq('outcome: full success', [o.ctl.state.result?.kind, o.ctl.state.phase, o.ctl.state.frozen], ['succeeded', 'ready', null]);
    o = await mk({ status: 200, data: body('pending', { final: false, succeededCents: 0, pendingCents: 14000, failedCents: 0, unresolvedCents: 0 }) });
    eq('outcome: Stripe pending is not shown as returned money', [o.ctl.state.result?.kind, o.ctl.state.result?.tone, /still processing/.test(o.ctl.state.result?.message ?? '')], ['pending', 'success', true]);
    const opAfter = allocatedOp('x', [{ pay: 1, d: 7500, b: 0, t: 2500, status: 'succeeded', sid: 're_1' }, { pay: 2, d: 0, b: 4000, t: 0, status: 'pending', sid: 're_2' }]);
    o = await mk({ status: 200, data: body('pending', { final: false, succeededCents: 10000, pendingCents: 4000, failedCents: 0, unresolvedCents: 0 }) },
      overviewOf([pay(1, { dep: 25661, tip: 5132, refunded: { deposit_cents: 7500, tip_cents: 2500 } }), pay(2, { bal: 10000, pending: { balance_cents: 4000 } })], { operations: [{ ...opAfter, operation_key: 'op-partial-pend1' }] }));
    eq('outcome: part succeeded and part pending: the stored refund is now "in progress" and nothing is retried', [o.ctl.state.phase, o.ctl.state.recoveries[0]?.progress?.succeededCents, o.ctl.state.recoveries[0]?.progress?.pendingCents, o.s.calls.submit.length], ['recovery', 10000, 4000, 1]);
    o = await mk({ status: 202, data: { success: true, status: 'unresolved', code: 'REFUND_UNRESOLVED', requestedCents: 14000, succeededCents: 10000, pendingCents: 0, failedCents: 0, unresolvedCents: 4000, final: false } });
    eq('outcome: an unknown result keeps the request frozen and offers only to resume it', [o.ctl.state.result?.kind, o.ctl.state.phase, o.ctl.state.frozen !== null], ['unresolved', 'recovery', true]);
    o = await mk({ status: 207, data: { success: false, status: 'partial', code: 'REFUND_PARTIAL', requestedCents: 14000, succeededCents: 10000, pendingCents: 0, failedCents: 4000, unresolvedCents: 0, final: true } });
    eq('outcome: partly refunded and partly rejected: both amounts are stated, nothing is claimed as fully refunded, and a new refund needs a new request', [o.ctl.state.result?.kind, o.ctl.state.result?.succeededCents, o.ctl.state.result?.failedCents, o.ctl.state.phase, o.ctl.state.frozen, /10000|\$100\.00/.test(o.ctl.state.result?.message ?? '')], ['partial', 10000, 4000, 'ready', null, true]);
    eq('outcome: ...the Admin must enter the rejected part again (no automatic retry)', o.s.calls.submit.length, 1);
    o = await mk({ status: 422, data: { success: false, status: 'failed', code: 'REFUND_FAILED', error: 'Stripe rejected the refund.', requestedCents: 14000, failedCents: 14000, final: true } });
    eq('outcome: complete failure: an error, no false success, the form is open for a NEW request', [o.ctl.state.result?.kind, o.ctl.state.result?.tone, o.ctl.state.phase, o.ctl.state.frozen], ['failed', 'error', 'ready', null]);
    o = await mk({ status: 409, data: { success: false, code: 'UNSETTLED_REFUND_EXISTS', resumeOperationKey: 'op-other-0001', resumeAmountCents: 500 } },
      overviewOf([pay(1, { dep: 25661, tip: 5132 }), pay(2, { bal: 10000 })], { operations: [allocatedOp('op-other-0001', [{ pay: 1, d: 500, b: 0, t: 0, status: 'pending', attempted: true }])] }));
    eq('outcome: an earlier unsettled refund is shown (from the database) and this request is not kept', [o.ctl.state.result?.kind, o.ctl.state.phase, o.ctl.state.recoveries[0]?.operationKey, o.ctl.state.frozen], ['unsettled', 'recovery', 'op-other-0001', null]);
    o = await mk({ status: 409, data: { success: false, code: 'OPERATION_KEY_REUSED', detail: 'allocation_changed' } });
    eq('outcome: a key conflict is reported as a conflict, nothing is kept', [o.ctl.state.result?.kind, o.ctl.state.frozen, o.ctl.state.phase], ['conflict', null, 'ready']);
    o = await mk({ status: 500, data: { success: false, code: 'REFUND_RESERVATION_FAILED', error: 'The refund could not be started. Nothing was refunded.' } });
    eq('outcome: a server error keeps the request identity and does not retry by itself', [o.ctl.state.frozen !== null, o.ctl.state.phase, o.s.calls.submit.length], [true, 'recovery', 1]);
    const s2 = scripted(overviewOf([pay(1, { dep: 100 })]));
    s2.failLoads(true);
    const c2 = new RefundController(s2.api, ORDER);
    await c2.load();
    eq('read failure: a failed load is a visible error with a retry, and sends nothing', [c2.state.phase, c2.state.loadError, s2.calls.submit.length], ['load_error', 'boom', 0]);
    s2.failLoads(false);
    await c2.load();
    eq('read failure: retrying the read recovers', c2.state.phase, 'ready');
  }

  // =================================================================================================================
  // 7. The drawn screen
  // =================================================================================================================
  {
    const html = (state: any, props: any = {}) => renderToStaticMarkup(createElement(RefundAllocationView, { state, handlers: NO_HANDLERS, ...props }));
    const base = (ov: RefundOverview, over: any = {}) => ({
      phase: 'ready', overview: ov, loadError: null, inputs: {}, reasonValue: 'cancellation', reasonText: '', fieldErrors: {}, formError: null, notice: null, review: null, result: null, frozen: null, recoveries: [], ...over,
    });
    const a = pay(1, { dep: 25661, tip: 5132, brand: 'visa', last4: '4242' });
    const h1 = html(base(overviewOf([a])));
    ok('screen: one payment shows its title with the card, its collected, refunded, pending and available amounts', /Deposit · visa •••• 4242/.test(h1) && />\$307\.93</.test(h1) && /Collected/.test(h1) && /Refunded/.test(h1) && /Pending refund/.test(h1) && /Available to refund/.test(h1));
    ok('screen: components use familiar words, with the available amount of each', /Deposit \(refund amount\)/.test(h1) && /Tip \(refund amount\)/.test(h1) && /Available to refund: <span class="tabular-nums">\$256\.61<\/span> of <span class="tabular-nums">\$256\.61<\/span> collected/.test(h1));
    ok('screen: a component the payment never held is not offered', !/Remaining Balance \(refund amount\)/.test(h1));
    ok('screen: the default refund is zero', /Total Refund<\/dt><dd[^>]*><span class="tabular-nums">\$0\.00/.test(h1));
    ok('screen: no technical names are shown', !/deposit_principal|allocation_version|request_allocation|ledger_version|_cents/.test(h1));
    ok('screen: labelled inputs with a Max control and a review action', /<label for="refund-[^"]+-deposit"/.test(h1) && /aria-label="Refund the maximum available deposit, \$256\.61"/.test(h1) && />Review Refund</.test(h1));
    ok('screen: nothing is submitted from the form step (no confirm action yet)', !/Confirm \$/.test(h1));
    const b = pay(2, { bal: 10000, brand: 'mastercard', last4: '4444' });
    const h2 = html(base(overviewOf([a, b])));
    ok('screen: several payments are distinct cards', (h2.match(/data-testid="refund-payment"/g) ?? []).length === 2 && /mastercard •••• 4444/.test(h2) && /Remaining Balance \(refund amount\)/.test(h2));
    const h3 = html(base(overviewOf([pay(1, { dep: 25661, tip: 5132, refunded: { deposit_cents: 7500, tip_cents: 2500 }, pending: { deposit_cents: 1000 } })])));
    ok('screen: refunded and pending amounts are shown separately and availability falls', />\$100\.00</.test(h3) && />\$10\.00</.test(h3) && />\$197\.93</.test(h3));
    const h4 = html(base(overviewOf([pay(1, { dep: 5000, reason: 'unclassified', classified: false })])));
    ok('screen: a payment without a recorded split says component refunding is unavailable and has no inputs', /Component-level refunding is unavailable/.test(h4) && !/<input/.test(h4));
    const h5 = html(base(overviewOf([pay(1, { dep: 5000, tip: 1000, unknown: true, avail: [2500, 0, 0] })])));
    ok('screen: unknown earlier refunds are called out', /earlier refund on this payment has no recorded breakdown/.test(h5));
    const h6 = html(base(overviewOf([])));
    ok('screen: no card payments gives an empty state, no form', /no successful card payments/.test(h6) && !/Review Refund/.test(h6));
    ok('screen: loading and failure states', /Loading refund details/.test(html(base(null as any, { phase: 'loading' }))) && /role="alert"/.test(html(base(null as any, { phase: 'load_error', loadError: 'You do not have access.' }))) && /You do not have access\./.test(html(base(null as any, { phase: 'load_error', loadError: 'You do not have access.' }))));
    const h7 = html(base(overviewOf([a]), { phase: 'review', review: { lines: [{ paymentId: a.id, title: 'deposit · visa •••• 4242', depositCents: 7500, balanceCents: 0, tipCents: 2500, totalCents: 10000 }], totalCents: 10000, depositCents: 7500, balanceCents: 0, tipCents: 2500, paymentsAffected: 1, reason: 'cancellation', allocation: [] } }), { customerName: 'Pat Lee' });
    ok('screen: the confirmation states the total, each component, the payments affected, and a distinct final action', /Refund <span class="tabular-nums">\$100\.00<\/span> to Pat Lee\?/.test(h7) && /\$75\.00<\/span> from deposit/.test(h7) && /\$25\.00<\/span> from tip/.test(h7) && /1 payment affected/.test(h7) && />Confirm \$100\.00 Refund</.test(h7) && />Back</.test(h7) && !/from remaining balance/.test(h7));
    const op = allocatedOp('op-ui-0001', [{ pay: 1, d: 7500, b: 0, t: 2500, status: 'succeeded', sid: 're_1' }, { pay: 2, d: 0, b: 4000, t: 0, status: 'pending', sid: 're_2' }]);
    const rec = { source: 'stored', operationKey: 'op-ui-0001', kind: 'allocated', canResume: true, progress: progressOf(op), totalCents: 11500, lines: [{ paymentTitle: 'deposit · visa •••• 4242', depositCents: 7500, balanceCents: 0, tipCents: 2500 }, { paymentTitle: 'balance · mastercard •••• 4444', depositCents: 0, balanceCents: 4000, tipCents: 0 }] };
    const h8 = html(base(overviewOf([a, b], { operations: [op] }), { phase: 'recovery', recoveries: [rec] }));
    ok('screen: an unfinished refund shows "Refund in progress — resume existing refund" with its allocation and progress, and no entry form', /Refund in progress — resume existing refund/.test(h8) && /\$75\.00<\/span> deposit · \$25\.00<\/span> tip|\$75\.00 deposit · \$25\.00 tip/.test(h8) && />Resume Existing Refund</.test(h8) && /Pending at Stripe/.test(h8) && /Failed/.test(h8) && !/Review Refund/.test(h8) && !/<input/.test(h8));
    const h9 = html(base(overviewOf([a]), { phase: 'recovery', recoveries: [{ ...rec, kind: 'manual_review', canResume: false, manualReviewWhy: 'The stored refund rows do not add up to the requested total.' }] }));
    ok('screen: a refund that cannot be rebuilt asks for manual review and offers no way to send', /needs manual review/.test(h9) && !/Resume Existing Refund/.test(h9));
    const hist = [row(1, { amount: 10000, status: 'succeeded', payment_id: a.id, deposit_cents: 7500, tip_cents: 2500, balance_cents: 0, unclassified_cents: 0, allocation_version: 1, stripe_refund_id: 're_1', provider_attempted: true }), row(2, { amount: 3000, status: 'pending', stripe_refund_id: 're_2', provider_attempted: true }), row(3, { amount: 500, status: 'failed' }), row(4, { amount: 700, status: 'pending', provider_attempted: true })];
    const h10 = html(base(overviewOf([a], { refunds: hist })));
    ok('screen: history shows each refund with its parts and honest status: refunded, pending at Stripe, failed, result not known', /\$75\.00 deposit · \$25\.00 tip/.test(h10) && /Refunded/.test(h10) && /Pending at Stripe/.test(h10) && /Failed/.test(h10) && /Result not yet known/.test(h10));
    ok('screen: historical refunds say their allocation is unavailable and are not shown as deposit or tip', (h10.match(/Allocation unavailable — historical refund/g) ?? []).length === 3);
    ok('screen: only a succeeded refund is shown as returned money (with a minus sign)', (h10.match(/>-<span/g) ?? []).length === 1);
    ok('screen: history can be switched off for pages that show their own', !/Refund History/.test(html(base(overviewOf([a], { refunds: hist })), { showHistory: false })));
    const h11 = html(base(overviewOf([a]), { result: { kind: 'partial', tone: 'error', message: 'Only $100.00 of $140.00 was refunded.', requestedCents: 14000, succeededCents: 10000, failedCents: 4000 } }));
    ok('screen: a partial result states each portion and is announced as an alert', /role="alert"/.test(h11) && /refunded <span class="tabular-nums">\$100\.00/.test(h11) && /failed <span class="tabular-nums">\$40\.00/.test(h11));
    ok('screen: errors are tied to their inputs for screen readers', (() => { const t = html(base(overviewOf([a]), { fieldErrors: { [`${a.id}.deposit`]: 'More than the $256.61 available.' } })); return /aria-invalid="true"/.test(t) && new RegExp(`aria-describedby="refund-${a.id}-deposit-error"`).test(t) && new RegExp(`id="refund-${a.id}-deposit-error" role="alert"`).test(t); })());
    ok('screen: touch targets and no fixed widths (inputs, buttons are at least 44px tall; no pixel widths that could overflow a phone)', /min-h-\[44px\]/.test(h1) && !/\bw-\[\d+px\]|\bmin-w-\[\d+px\]|style="[^"]*width/.test(h1 + h2 + h7 + h8 + h10));
    const busyHtml = html(base(overviewOf([a]), { phase: 'submitting', review: { lines: [{ paymentId: a.id, title: 'deposit', depositCents: 7500, balanceCents: 0, tipCents: 2500, totalCents: 10000 }], totalCents: 10000, depositCents: 7500, balanceCents: 0, tipCents: 2500, paymentsAffected: 1, reason: 'cancellation', allocation: [] } }));
    ok('screen: while a refund is being sent the confirmation stays on screen, is busy, and its buttons cannot be pressed again; the entries are locked', /aria-busy="true"/.test(busyHtml) && (busyHtml.match(/disabled=""/g) ?? []).length >= 2 && />Processing…</.test(busyHtml) && !/Review Refund/.test(busyHtml) && !/<input(?![^>]*disabled)/.test(busyHtml));
    ok('screen: snapshot of availability changes when a pending refund appears', availabilitySnapshot(overviewOf([a])) !== availabilitySnapshot(overviewOf([pay(1, { dep: 25661, tip: 5132, pending: { deposit_cents: 1 } })])));
  }

  // =================================================================================================================
  // 8. The three entry points use the one shared screen
  // =================================================================================================================
  {
    const read = (f: string) => require('fs').readFileSync(f, 'utf8');
    const screens: Array<[string, string]> = [
      ['Single Order -> Payments', 'src/components/order-detail/PaymentsTab.tsx'],
      ['Pending Order -> Payment Management', 'src/components/pending-order/PaymentManagementSection.tsx'],
      ['Calendar -> Task Detail', 'src/components/admin/tasks/detail/TaskDetailCustomerInfo.tsx'],
    ];
    for (const [label, file] of screens) {
      const src = read(file).replace(/\/\/.*$/gm, '');
      ok(`wiring: ${label} renders the shared refund panel`, /import \{ RefundAllocationPanel \} from '[./]+(\/admin)?\/?(\.\.\/)*(admin\/)?refunds\/RefundAllocationPanel'|RefundAllocationPanel \} from '.*refunds\/RefundAllocationPanel'/.test(src) && /<RefundAllocationPanel[\s\S]*?orderId=/.test(src));
      ok(`wiring: ${label} has no refund arithmetic, request or key handling of its own`, !/parseFloat|stripe-refund|refundAttemptFor|classifyRefundResponse|operationKey|amountCents/.test(src));
      ok(`wiring: ${label} shows the panel only on an explicit action or a cancelled order, and passes its own refresh`, /onChanged=\{|onChanged=/.test(src));
    }
    const modal = read('src/components/admin/tasks/TaskDetailModal.tsx').replace(/\/\/.*$/gm, '');
    ok('wiring: the calendar task modal no longer owns a refund handler; it only refreshes the task (without closing it)', !/handleRefund|refundAttempt|stripe-refund|classifyRefundResponse/.test(modal) && /TaskDetailCustomerInfo task=\{task\} isAdmin=\{isAdmin\} onRefundChanged=\{refresh\}/.test(modal));
    const panel = read('src/components/admin/orders/refunds/RefundAllocationPanel.tsx');
    ok('wiring: the shared panel never calls the browser client or sends from a load', !/from '.*lib\/supabase'/.test(panel) && /void c\.load\(\)/.test(panel) && !/useEffect\([^)]*confirm|useEffect\([^)]*resume/.test(panel));
    ok('wiring: payments are never marked or the refund function called from the three screens directly', !/from\('payments'\)\.(update|insert)|from\('order_refunds'\)\.(update|insert)/.test(read('src/components/order-detail/PaymentsTab.tsx') + read('src/components/pending-order/PaymentManagementSection.tsx')));
    const ctlSrc = read('src/lib/payments/refundController.ts');
    ok('wiring: the controller sends only from confirm and resume', (ctlSrc.match(/this\.send\(/g) ?? []).length === 2 && /async confirm\(\)/.test(ctlSrc) && /async resume\(/.test(ctlSrc));
  }

  console.log(`Refund allocation screen tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} refund allocation screen test(s) failed`);
})().catch((e) => {
  console.error(`FAIL: the test stopped on an unexpected error: ${e?.message ?? e}`);
  console.error(e);
  throw e;
});
