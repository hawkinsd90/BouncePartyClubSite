// Differential tests for the shared Event Essentials availability core
// (checkEventEssentialsAvailabilityWith in eeOrderItemAvailability.ts).
//
// Nine caller flows (ten call sites) used to perform "expand -> query -> validate" by hand.
// Each flow's old sequence is kept below, verbatim, as an independent oracle that only uses the
// pre-existing helpers (buildEventEssentialAvailabilityRequestFromOrderItems and
// validateAvailabilityResult). Each flow's NEW form is the shared core plus that caller's own
// projection (its messages / issue rows / thrown errors), copied from the adopted code.
// For every flow and every scenario the old projection, the new projection AND the exact query
// call (items, start date, end date, excluded order id) must be identical.
//
// Flows covered: InvoiceBuilder.checkAvailability, InvoiceBuilder.handleGenerateInvoice,
// OrderDetailModal.checkAvailability, CustomerApprovalModal.checkAvailability,
// InvoiceAcceptanceView, AddEventEssentialsSection (product and package),
// adminGeneratorResolution, orderApprovalService.checkEEProductAvailability, orderCreation.
//
// Deliberately NOT migrated (different semantics, so not in this file): the public catalog's add
// handlers and preview, CartSection, useQuoteCart and the Generator checkbox. They expand with the
// unvalidated cart expander and have their own result handling.

import {
  buildEventEssentialAvailabilityRequestFromOrderItems as build,
  validateAvailabilityResult as validate,
  checkEventEssentialsAvailabilityWith as checkWith,
} from '../../eventEssentials/eeOrderItemAvailability';
import type { EventEssentialsAvailabilityQuery } from '../../eventEssentials/eeOrderItemAvailability';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}\n  actual:   ${a}\n  expected: ${e}`); }
}
function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

// ---------------------------------------------------------------------------
// Fake query: records calls, returns a scripted response.
// ---------------------------------------------------------------------------
type Resp = { kind: 'result'; value: any } | { kind: 'throw'; error: string };
function fakeQuery(resp: (requested: Array<{ product_id: string; quantity: number }>) => Resp) {
  const calls: any[] = [];
  const query: EventEssentialsAvailabilityQuery = async (items, start, end, exclude) => {
    calls.push({ items, start, end, exclude });
    const r = resp(items);
    if (r.kind === 'throw') throw new Error(r.error);
    return r.value;
  };
  return { query, calls };
}
const allowed = (ids: string[], over: Record<string, unknown> = {}) => ({ data: ids.map((id) => ({ product_id: id, is_allowed: true, ...over })), error: null });

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
const snap = (comps: Array<[string, number]>) => ({ bundle_name: 'Pkg', bundle_description: null, components: comps.map(([product_id, q]) => ({ product_id, product_name: product_id, quantity_per_bundle: q })) });
const prod = (id: string, qty: number) => ({ product_id: id, bundle_id: null, unit_id: null, qty, component_snapshot: null });
const pkg = (id: string, qty: number, comps: Array<[string, number]>) => ({ product_id: null, bundle_id: id, unit_id: null, qty, component_snapshot: snap(comps) });
const inflatable = (id: string, qty: number) => ({ unit_id: id, product_id: null, bundle_id: null, qty, component_snapshot: null });

interface Scenario {
  name: string;
  items: any[];
  start: string;
  end: string | null;
  exclude: string | null;
  resp: (requested: Array<{ product_id: string; quantity: number }>) => Resp;
  emptyOk?: boolean; // scenario has an empty requirement (callers that never guard for it are skipped)
}
const okResp = (r: Array<{ product_id: string }>): Resp => ({ kind: 'result', value: allowed(r.map((x) => x.product_id)) });

const D1 = '2026-07-04';
const D2 = '2026-07-06';
const scenarios: Scenario[] = [
  { name: 'one available product', items: [prod('p1', 2)], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'multiple available products', items: [prod('p1', 2), prod('p2', 1), prod('p3', 5)], start: D1, end: D2, exclude: 'order-1', resp: okResp },
  { name: 'package expansion', items: [pkg('b1', 1, [['p1', 2], ['p2', 1]])], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'package quantity multiplication', items: [pkg('b1', 3, [['p1', 2], ['p2', 1]])], start: D1, end: D2, exclude: 'order-1', resp: okResp },
  { name: 'product + package combination (aggregated per product)', items: [prod('p1', 4), pkg('b1', 2, [['p1', 1], ['p9', 3]])], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'no end date (same-day fallback or raw, per caller)', items: [prod('p1', 1)], start: D1, end: null, exclude: 'order-1', resp: okResp },
  { name: 'empty end date string', items: [prod('p1', 1)], start: D1, end: '', exclude: null, resp: okResp },
  { name: 'explicit end date', items: [prod('p1', 1)], start: D1, end: D2, exclude: 'order-9', resp: okResp },
  { name: 'missing start date', items: [prod('p1', 1)], start: '', end: D2, exclude: null, resp: okResp },
  { name: 'missing both dates', items: [prod('p1', 1)], start: '', end: null, exclude: null, resp: okResp },
  { name: 'expansion failure: zero qty', items: [prod('p1', 0)], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'expansion failure: fractional qty', items: [prod('p1', 1.5)], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'expansion failure: package without snapshot', items: [{ product_id: null, bundle_id: 'b1', unit_id: null, qty: 1, component_snapshot: null }], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'expansion failure: package with empty components', items: [pkg('b1', 1, [])], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'expansion failure: package with two identities', items: [{ product_id: 'p1', bundle_id: 'b1', unit_id: null, qty: 1, component_snapshot: snap([['p1', 1]]) }], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'expansion failure: no identity', items: [{ product_id: null, bundle_id: null, unit_id: null, qty: 1, component_snapshot: null }], start: D1, end: D2, exclude: null, resp: okResp },
  { name: 'empty requirement (only inflatable rows)', items: [inflatable('u1', 1)], start: D1, end: D2, exclude: null, resp: okResp, emptyOk: true },
  { name: 'unavailable product', items: [prod('p1', 2), prod('p2', 1)], start: D1, end: D2, exclude: 'order-1', resp: (r) => ({ kind: 'result', value: { data: r.map((x, i) => ({ product_id: x.product_id, is_allowed: i !== 0 })), error: null } }) },
  { name: 'unavailable package component', items: [pkg('b1', 1, [['p1', 1], ['p2', 1]])], start: D1, end: D2, exclude: null, resp: (r) => ({ kind: 'result', value: { data: r.map((x) => ({ product_id: x.product_id, is_allowed: x.product_id !== 'p2' })), error: null } }) },
  { name: 'malformed response: data is null', items: [prod('p1', 1)], start: D1, end: D2, exclude: null, resp: () => ({ kind: 'result', value: { data: null, error: null } }) },
  { name: 'malformed response: missing product row', items: [prod('p1', 1), prod('p2', 1)], start: D1, end: D2, exclude: null, resp: () => ({ kind: 'result', value: allowed(['p1']) }) },
  { name: 'malformed response: blank product id', items: [prod('p1', 1)], start: D1, end: D2, exclude: null, resp: () => ({ kind: 'result', value: { data: [{ product_id: '  ', is_allowed: true }], error: null } }) },
  { name: 'malformed response: non-boolean is_allowed', items: [prod('p1', 1)], start: D1, end: D2, exclude: null, resp: () => ({ kind: 'result', value: { data: [{ product_id: 'p1', is_allowed: 'yes' }], error: null } }) },
  { name: 'query error (string)', items: [prod('p1', 1)], start: D1, end: D2, exclude: 'order-1', resp: () => ({ kind: 'result', value: { data: null, error: 'rpc failed' } }) },
  { name: 'query error (object) with data present', items: [prod('p1', 1)], start: D1, end: D2, exclude: null, resp: () => ({ kind: 'result', value: { data: allowed(['p1']).data, error: { message: 'boom' } } }) },
  { name: 'query throws', items: [prod('p1', 1)], start: D1, end: D2, exclude: 'order-1', resp: () => ({ kind: 'throw', error: 'network down' }) },
];

// ---------------------------------------------------------------------------
// Flows: OLD (verbatim oracle) and NEW (shared core + the caller's own projection).
// Each returns a plain projection; a throwing query surfaces as 'THROWN:<message>'.
// ---------------------------------------------------------------------------
type Q = EventEssentialsAvailabilityQuery;
interface FlowInput { items: any[]; start: string; end: string | null; exclude: string | null }
interface Flow { name: string; old: (i: FlowInput, q: Q) => Promise<unknown>; neu: (i: FlowInput, q: Q) => Promise<unknown>; skipsEmpty: boolean; usesExclude: boolean }

const guard = async (fn: () => Promise<unknown>) => { try { return await fn(); } catch (e) { return `THROWN:${(e as Error).message}`; } };
const ibItems = (items: any[]) => items.map((item) => ({ product_id: item.product_id, bundle_id: item.bundle_id, qty: item.qty, component_snapshot: item.component_snapshot }));

const flows: Flow[] = [
  {
    name: 'InvoiceBuilder.checkAvailability', skipsEmpty: true, usesExclude: false,
    old: async ({ items, start, end }, q) => {
      let issue = false;
      const expansion = build(ibItems(items));
      if (expansion.status !== 'ready') { issue = true; }
      else if (expansion.productQuantities.length > 0) {
        try {
          const eeResult = await q(expansion.productQuantities, start, (end as string) || start, null);
          const validation = validate(expansion.productQuantities.map((item) => item.product_id), eeResult);
          if (!validation.ok) { issue = true; }
        } catch { issue = true; }
      }
      return issue ? 'issue' : 'ok';
    },
    neu: async ({ items, start, end }, q) => {
      let issue = false;
      try {
        const eeCheck = await checkWith(q, { items: ibItems(items), eventDate: start, eventEndDate: (end as string) || start, excludeOrderId: null });
        if (!eeCheck.ok) { issue = true; }
      } catch { issue = true; }
      return issue ? 'issue' : 'ok';
    },
  },
  {
    name: 'InvoiceBuilder.handleGenerateInvoice', skipsEmpty: true, usesExclude: false,
    old: (i, q) => guard(async () => {
      const { items, start, end } = i;
      const expansion = build(ibItems(items));
      if (expansion.status !== 'ready') return 'toast:Unable to verify Event Essentials availability. Please try again.';
      if (expansion.productQuantities.length > 0) {
        const eeResult = await q(expansion.productQuantities, start, (end as string) || start, null);
        const validation = validate(expansion.productQuantities.map((item) => item.product_id), eeResult);
        if (!validation.ok) {
          return 'toast:' + (validation.status === 'unavailable'
            ? 'Cannot create invoice: One or more Event Essentials are not available for the selected dates.'
            : 'Unable to verify Event Essentials availability. Please try again.');
        }
      }
      return 'ok';
    }),
    neu: (i, q) => guard(async () => {
      const eeCheck = await checkWith(q, { items: ibItems(i.items), eventDate: i.start, eventEndDate: (i.end as string) || i.start, excludeOrderId: null });
      if (!eeCheck.ok) {
        return 'toast:' + (eeCheck.kind === 'unavailable'
          ? 'Cannot create invoice: One or more Event Essentials are not available for the selected dates.'
          : 'Unable to verify Event Essentials availability. Please try again.');
      }
      return 'ok';
    }),
  },
  {
    name: 'OrderDetailModal.checkAvailability', skipsEmpty: true, usesExclude: true,
    old: (i, q) => guard(async () => {
      const finalIssues: any[] = [];
      const expansion = build(i.items);
      if (expansion.status === 'invalid') {
        finalIssues.push({ unitName: 'Event Essentials', error: expansion.error });
      } else if (expansion.productQuantities.length > 0) {
        const eeResult: any = await q(expansion.productQuantities, i.start, i.end as string, i.exclude);
        if (eeResult.error) {
          finalIssues.push({ unitName: 'Event Essentials', error: eeResult.error });
        } else {
          const validation = validate(expansion.productQuantities.map((pq) => pq.product_id), { data: eeResult.data, error: null });
          if (!validation.ok) {
            finalIssues.push({ unitName: 'Event Essentials', error: validation.error || 'Event Essentials availability check failed' });
          }
        }
      }
      return finalIssues;
    }),
    neu: (i, q) => guard(async () => {
      const finalIssues: any[] = [];
      const eeCheck = await checkWith(q, { items: i.items, eventDate: i.start, eventEndDate: i.end as string, excludeOrderId: i.exclude });
      if (!eeCheck.ok) {
        if (eeCheck.kind === 'invalid_requirement') {
          finalIssues.push({ unitName: 'Event Essentials', error: eeCheck.error });
        } else if (eeCheck.kind === 'unverifiable' && eeCheck.queryError) {
          finalIssues.push({ unitName: 'Event Essentials', error: eeCheck.queryError });
        } else {
          finalIssues.push({ unitName: 'Event Essentials', error: eeCheck.error || 'Event Essentials availability check failed' });
        }
      }
      return finalIssues;
    }),
  },
  {
    name: 'CustomerApprovalModal.checkAvailability', skipsEmpty: true, usesExclude: true,
    old: (i, q) => guard(async () => {
      const expansion = build(i.items);
      if (expansion.status === 'invalid') return 'toast:Unable to verify Event Essentials availability. Please try again or contact us for assistance.';
      if (expansion.productQuantities.length > 0) {
        const availabilityResult = await q(expansion.productQuantities, i.start, (i.end as string) || i.start, i.exclude);
        const validation = validate(expansion.productQuantities.map((x) => x.product_id), availabilityResult);
        if (!validation.ok) return 'toast:' + (validation.error || 'One or more Event Essentials items are no longer available for your event date.');
      }
      return 'ok';
    }),
    neu: (i, q) => guard(async () => {
      const eeCheck = await checkWith(q, { items: i.items, eventDate: i.start, eventEndDate: (i.end as string) || i.start, excludeOrderId: i.exclude });
      if (!eeCheck.ok) {
        if (eeCheck.kind === 'invalid_requirement') return 'toast:Unable to verify Event Essentials availability. Please try again or contact us for assistance.';
        return 'toast:' + (eeCheck.error || 'One or more Event Essentials items are no longer available for your event date.');
      }
      return 'ok';
    }),
  },
  {
    name: 'InvoiceAcceptanceView', skipsEmpty: true, usesExclude: true,
    old: (i, q) => guard(async () => {
      const expansion = build(i.items);
      if (expansion.status === 'ready' && expansion.productQuantities.length > 0) {
        const eeResult = await q(expansion.productQuantities, i.start, (i.end as string) || i.start, i.exclude);
        const validation = validate(expansion.productQuantities.map((item) => item.product_id), eeResult);
        if (!validation.ok) {
          return 'toast:' + (validation.status === 'unavailable'
            ? 'Sorry, one or more Event Essentials in your order are no longer available for your event date. Please contact us to reschedule.'
            : 'Sorry, we could not verify item availability. Please contact us to reschedule.');
        }
      } else if (expansion.status === 'invalid') {
        return 'toast:Sorry, we could not verify item availability. Please contact us to reschedule.';
      }
      return 'ok';
    }),
    neu: (i, q) => guard(async () => {
      const eeCheck = await checkWith(q, { items: i.items, eventDate: i.start, eventEndDate: (i.end as string) || i.start, excludeOrderId: i.exclude });
      if (!eeCheck.ok) {
        return 'toast:' + (eeCheck.kind === 'unavailable'
          ? 'Sorry, one or more Event Essentials in your order are no longer available for your event date. Please contact us to reschedule.'
          : 'Sorry, we could not verify item availability. Please contact us to reschedule.');
      }
      return 'ok';
    }),
  },
  {
    name: 'AddEventEssentialsSection (product and package)', skipsEmpty: false, usesExclude: true,
    old: (i, q) => guard(async () => {
      const projectedItems = i.items;
      const expansion = build(projectedItems);
      if (expansion.status !== 'ready') return 'err:Unable to verify availability. Please try again.';
      const effectiveEndDate = (i.end as string) || i.start;
      if (!i.start || !effectiveEndDate) return 'err:Please select the event dates before adding Event Essentials.';
      const availResult = await q(expansion.productQuantities, i.start, effectiveEndDate, i.exclude);
      const validation = validate(expansion.productQuantities.map((p) => p.product_id), availResult);
      if (!validation.ok) return 'err:' + (validation.error || 'That quantity is not available for the selected dates.');
      return 'ok';
    }),
    neu: (i, q) => guard(async () => {
      const eeCheck = await checkWith(q, { items: i.items, eventDate: i.start, eventEndDate: (i.end as string) || i.start, excludeOrderId: i.exclude, requireDates: true });
      if (!eeCheck.ok) {
        if (eeCheck.kind === 'invalid_requirement') return 'err:Unable to verify availability. Please try again.';
        if (eeCheck.kind === 'missing_dates') return 'err:Please select the event dates before adding Event Essentials.';
        return 'err:' + (eeCheck.error || 'That quantity is not available for the selected dates.');
      }
      return 'ok';
    }),
  },
  {
    name: 'adminGeneratorResolution', skipsEmpty: false, usesExclude: true,
    old: (i, q) => guard(async () => {
      const expansion = build(i.items);
      if (expansion.status === 'invalid') return `fail_closed:${expansion.error}`;
      const availability = await q(expansion.productQuantities, i.start, i.end as string, i.exclude);
      const validation = validate(expansion.productQuantities.map((pq) => pq.product_id), availability);
      if (validation.status === 'invalid') return `fail_closed:${validation.error || 'Availability check failed.'}`;
      if (validation.status === 'unavailable') return 'skip';
      return 'candidate';
    }),
    neu: (i, q) => guard(async () => {
      const eeCheck = await checkWith(q, { items: i.items, eventDate: i.start, eventEndDate: i.end as string, excludeOrderId: i.exclude });
      if (!eeCheck.ok) {
        if (eeCheck.kind === 'invalid_requirement') return `fail_closed:${eeCheck.error}`;
        if (eeCheck.kind === 'unverifiable') return `fail_closed:${eeCheck.error || 'Availability check failed.'}`;
        return 'skip';
      }
      return 'candidate';
    }),
  },
  {
    name: 'orderApprovalService.checkEEProductAvailability', skipsEmpty: true, usesExclude: true,
    old: (i, q) => guard(async () => {
      const expansion = build(i.items);
      if (expansion.status === 'invalid') throw new Error(expansion.error);
      if (expansion.productQuantities.length === 0) return 'ok';
      const result = await q(expansion.productQuantities, i.start, (i.end as string) || i.start, i.exclude);
      const validation = validate(expansion.productQuantities.map((x) => x.product_id), result);
      if (!validation.ok) throw new Error(`Cannot approve order: ${validation.error}`);
      return 'ok';
    }),
    neu: (i, q) => guard(async () => {
      const check = await checkWith(q, { items: i.items, eventDate: i.start, eventEndDate: (i.end as string) || i.start, excludeOrderId: i.exclude });
      if (!check.ok) {
        if (check.kind === 'invalid_requirement') throw new Error(check.error);
        throw new Error(`Cannot approve order: ${check.error}`);
      }
      return 'ok';
    }),
  },
  {
    name: 'orderCreation', skipsEmpty: true, usesExclude: false,
    old: (i, q) => guard(async () => {
      const expansion = build(i.items);
      if (expansion.status === 'invalid') throw new Error(`Cannot create order: ${expansion.error}`);
      if (expansion.productQuantities.length > 0) {
        const availabilityResult = await q(expansion.productQuantities, i.start, (i.end as string) || i.start, undefined);
        const validation = validate(expansion.productQuantities.map((x) => x.product_id), availabilityResult);
        if (!validation.ok) throw new Error(`Cannot create order: ${validation.error}`);
      }
      return 'ok';
    }),
    neu: (i, q) => guard(async () => {
      const eeCheck = await checkWith(q, { items: i.items, eventDate: i.start, eventEndDate: (i.end as string) || i.start, excludeOrderId: undefined });
      if (!eeCheck.ok) throw new Error(`Cannot create order: ${eeCheck.error}`);
      return 'ok';
    }),
  },
];

// ---------------------------------------------------------------------------
// Differential run: every flow x every scenario.
// ---------------------------------------------------------------------------
async function main() {
  let combos = 0;
  for (const flow of flows) {
    for (const s of scenarios) {
      // Callers that never guard for an empty requirement always include a validated candidate, so an
      // empty requirement cannot reach them (checked separately below).
      if (s.emptyOk && !flow.skipsEmpty) continue;
      const input: FlowInput = { items: s.items, start: s.start, end: s.end, exclude: flow.usesExclude ? s.exclude : null };
      const o = fakeQuery(s.resp); const n = fakeQuery(s.resp);
      const oldOut = await flow.old(input, o.query);
      const newOut = await flow.neu(input, n.query);
      eq(`${flow.name} / ${s.name}: projection`, newOut, oldOut);
      eq(`${flow.name} / ${s.name}: exact query calls (items, start, end, excluded order)`, n.calls, o.calls);
      combos++;
    }
  }
  ok('differential grid ran', combos > 150);

  // A few literal pins so the grid cannot pass vacuously.
  {
    const q = fakeQuery(okResp);
    const r = await checkWith(q.query, { items: [prod('p1', 4), pkg('b1', 2, [['p1', 1], ['p9', 3]])], eventDate: D1, eventEndDate: D2, excludeOrderId: 'o-1' });
    eq('pin: product + package aggregate per product', q.calls[0].items, [{ product_id: 'p1', quantity: 6 }, { product_id: 'p9', quantity: 6 }]);
    eq('pin: dates and exclusion are passed through untouched', [q.calls[0].start, q.calls[0].end, q.calls[0].exclude], [D1, D2, 'o-1']);
    ok('pin: available result is ok and carries the expanded quantities', r.ok === true && (r as any).productQuantities.length === 2);
  }
  {
    const q = fakeQuery((r) => ({ kind: 'result', value: { data: r.map((x, i) => ({ product_id: x.product_id, is_allowed: i !== 0 })), error: null } }));
    const r = await checkWith(q.query, { items: [prod('p1', 1), prod('p2', 1)], eventDate: D1, eventEndDate: D2, excludeOrderId: null });
    eq('pin: an unavailable product is kind unavailable', [r.ok, (r as any).kind], [false, 'unavailable']);
  }
  {
    const q = fakeQuery(() => ({ kind: 'result', value: { data: null, error: 'rpc failed' } }));
    const r: any = await checkWith(q.query, { items: [prod('p1', 1)], eventDate: D1, eventEndDate: D2 });
    eq('pin: a query error is kind unverifiable with the raw error kept', [r.kind, r.queryError, r.error], ['unverifiable', 'rpc failed', 'Unable to verify Event Essentials availability. Please try again or contact us for assistance.']);
  }
  {
    const q = fakeQuery(okResp);
    const r: any = await checkWith(q.query, { items: [prod('p1', 0)], eventDate: D1, eventEndDate: D2 });
    eq('pin: expansion failure never queries', [r.kind, q.calls.length], ['invalid_requirement', 0]);
    const empty: any = await checkWith(q.query, { items: [inflatable('u1', 1)], eventDate: D1, eventEndDate: D2 });
    eq('pin: an empty requirement is ok and never queries', [empty.ok, empty.productQuantities, q.calls.length], [true, [], 0]);
  }
  {
    // requireDates is opt-in and checked AFTER the expansion check (the picker's order).
    const q = fakeQuery(okResp);
    const both: any = await checkWith(q.query, { items: [prod('p1', 0)], eventDate: '', eventEndDate: '', requireDates: true });
    eq('pin: with requireDates, an invalid requirement is reported before missing dates', both.kind, 'invalid_requirement');
    const noDate: any = await checkWith(q.query, { items: [prod('p1', 1)], eventDate: '', eventEndDate: '', requireDates: true });
    eq('pin: with requireDates, missing dates never query', [noDate.kind, q.calls.length], ['missing_dates', 0]);
    const noEnd: any = await checkWith(q.query, { items: [prod('p1', 1)], eventDate: D1, eventEndDate: '', requireDates: true });
    eq('pin: with requireDates, a missing END date alone is also missing_dates', [noEnd.kind, q.calls.length], ['missing_dates', 0]);
    const noFlag: any = await checkWith(q.query, { items: [prod('p1', 1)], eventDate: '', eventEndDate: '' });
    eq('pin: without requireDates the (empty) dates go straight to the query', [noFlag.ok, q.calls.length, q.calls[0].start], [true, 1, '']);
  }
  {
    // A thrown query propagates (the helper never catches).
    const q = fakeQuery(() => ({ kind: 'throw', error: 'network down' }));
    let caught = '';
    try { await checkWith(q.query, { items: [prod('p1', 1)], eventDate: D1, eventEndDate: D2 }); } catch (e) { caught = (e as Error).message; }
    eq('pin: a throwing query propagates unchanged', caught, 'network down');
  }

  // Invariant behind the "no empty-requirement guard" callers (AEES, Generator resolution): an item list that
  // includes a validated candidate expands to a NON-empty requirement, or is invalid.
  {
    let checked = 0; let bad = 0;
    const candidates: any[] = [prod('c1', 1), prod('c1', 7), pkg('bc', 1, [['c1', 1]]), pkg('bc', 3, [['c1', 2], ['c2', 1]])];
    const existing: any[][] = [[], [prod('p1', 1)], [inflatable('u1', 1)], [pkg('b1', 2, [['p1', 1]])], [prod('p1', 0)]];
    for (const c of candidates) for (const e of existing) {
      const x = build([...e, c]);
      if (x.status === 'ready' && x.productQuantities.length === 0) bad++;
      checked++;
    }
    eq('invariant: expansion that includes a valid candidate is never an empty requirement', [checked > 0, bad], [true, 0]);
  }

  console.log(`Event Essentials availability core differential tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} availability core test(s) failed`);
}

void main().catch((e) => { throw e; });
