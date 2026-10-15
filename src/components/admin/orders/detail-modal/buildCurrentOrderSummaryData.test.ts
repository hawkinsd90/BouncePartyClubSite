// Differential characterization tests for buildCurrentOrderSummaryData.
//
// The oracle functions below are verbatim copies of the code that lived inline
// in OrderDetailModal's current-summary effect before the extraction (the normal
// path with its total_cents IIFE, and the separate fallback in the .catch). They
// never call the helper. Only the `any` annotations were replaced with real
// types. Several expected values are also hand-computed literals so the test
// does not rely on the oracle alone.
//
// These tests pin CURRENT behavior, including oddities (a percentage of 0 falls
// through to the fixed amount, tip is excluded from total_cents, only one
// fee-waiver flag is emitted, a raw nullish subtotal is passed through on the
// normal path). They are not a statement of desired behavior.

import { buildCurrentOrderSummaryData } from './buildCurrentOrderSummaryData';
import type { CurrentOrderSummarySource } from './buildCurrentOrderSummaryData';
import type { OrderSummaryData, OrderDiscount, OrderCustomFee } from '../../../../lib/orders/orderSummaryLoader';

type TestDiscount = OrderDiscount & { is_new?: boolean };
type TestFee = OrderCustomFee & { is_new?: boolean };
type TestOrder = CurrentOrderSummarySource & { travel_total_miles?: string };
type TestItems = OrderSummaryData['items'];

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

// Strict structural equality: NaN equals NaN, and an own property whose value
// is undefined is different from a missing property.
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim copy of the pre-extraction inline code.
// ---------------------------------------------------------------------------

function oraclePrimary(
  order: TestOrder,
  orderItems: TestItems,
  discounts: TestDiscount[],
  customFees: TestFee[],
  travelMiles: number,
) {
  const summaryData = {
    items: orderItems,
    discounts: discounts.filter(d => !d.is_new),
    customFees: customFees.filter(f => !f.is_new),
    subtotal_cents: order.subtotal_cents,
    travel_fee_cents: order.travel_fee_cents || 0,
    travel_total_miles: travelMiles,
    surface_fee_cents: order.surface_fee_cents || 0,
    same_day_pickup_fee_cents: order.same_day_pickup_fee_cents || 0,
    same_day_weekday_delivery_fee_cents: order.same_day_weekday_delivery_fee_cents || 0,
    same_day_weekday_delivery_fee_waived: order.same_day_weekday_delivery_fee_waived || false,
    generator_fee_cents: order.generator_fee_cents || 0,
    setup_fee_cents: order.setup_fee_cents || 0,
    generator_qty: order.generator_qty || 0,
    tax_cents: order.tax_cents || 0,
    tip_cents: order.tip_cents || 0,
    total_cents: (() => {
      const subtotal = order.subtotal_cents || 0;
      const fees = (order.travel_fee_cents || 0) + (order.surface_fee_cents || 0) + (order.same_day_pickup_fee_cents || 0) + (order.same_day_weekday_delivery_fee_cents || 0) + (order.generator_fee_cents || 0) + (order.setup_fee_cents || 0);
      const totalCustomFees = customFees.filter(f => !f.is_new).reduce((sum: number, f: TestFee) => sum + (f.amount_cents || 0), 0);
      const totalDiscounts = discounts.filter(d => !d.is_new).reduce((sum: number, d: TestDiscount) => {
        // APPROVED: one amount per discount - the fixed amount wins, else the percentage (never both).
        if (d.amount_cents && d.amount_cents > 0) return sum + d.amount_cents;
        if (d.percentage) return sum + Math.round(subtotal * (d.percentage / 100));
        return sum;
      }, 0);
      const tax = order.tax_cents || 0;
      return subtotal + fees + totalCustomFees - totalDiscounts + tax;
    })(),
    deposit_due_cents: order.deposit_due_cents,
    deposit_paid_cents: order.deposit_paid_cents || 0,
    balance_due_cents: order.balance_due_cents,
    custom_deposit_cents: order.custom_deposit_cents,
    pickup_preference: order.pickup_preference,
    event_date: order.event_date,
    event_end_date: order.event_end_date,
  };
  return summaryData;
}

function oracleFallback(
  order: TestOrder,
  orderItems: TestItems,
  discounts: TestDiscount[],
  customFees: TestFee[],
) {
  const subtotal = order.subtotal_cents || 0;
  const fees = (order.travel_fee_cents || 0) + (order.surface_fee_cents || 0) + (order.same_day_pickup_fee_cents || 0) + (order.same_day_weekday_delivery_fee_cents || 0) + (order.generator_fee_cents || 0) + (order.setup_fee_cents || 0);
  const totalCustomFees = customFees.filter((f: TestFee) => !f.is_new).reduce((sum: number, f: TestFee) => sum + (f.amount_cents || 0), 0);
  const totalDiscounts = discounts.filter((d: TestDiscount) => !d.is_new).reduce((sum: number, d: TestDiscount) => {
    if (d.amount_cents && d.amount_cents > 0) return sum + d.amount_cents;
    if (d.percentage) return sum + Math.round(subtotal * (d.percentage / 100));
    return sum;
  }, 0);
  const fallbackSummary = {
    items: orderItems,
    discounts: discounts.filter(d => !d.is_new),
    customFees: customFees.filter(f => !f.is_new),
    subtotal_cents: subtotal,
    travel_fee_cents: order.travel_fee_cents || 0,
    travel_total_miles: parseFloat(order.travel_total_miles as string) || 0,
    surface_fee_cents: order.surface_fee_cents || 0,
    same_day_pickup_fee_cents: order.same_day_pickup_fee_cents || 0,
    same_day_weekday_delivery_fee_cents: order.same_day_weekday_delivery_fee_cents || 0,
    same_day_weekday_delivery_fee_waived: order.same_day_weekday_delivery_fee_waived || false,
    generator_fee_cents: order.generator_fee_cents || 0,
    setup_fee_cents: order.setup_fee_cents || 0,
    generator_qty: order.generator_qty || 0,
    tax_cents: order.tax_cents || 0,
    tip_cents: order.tip_cents || 0,
    total_cents: subtotal + fees + totalCustomFees - totalDiscounts + (order.tax_cents || 0),
    deposit_due_cents: order.deposit_due_cents,
    deposit_paid_cents: order.deposit_paid_cents || 0,
    balance_due_cents: order.balance_due_cents,
    custom_deposit_cents: order.custom_deposit_cents,
    pickup_preference: order.pickup_preference,
    event_date: order.event_date,
    event_end_date: order.event_end_date,
  };
  return fallbackSummary;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkOrder(over: Record<string, unknown> = {}): TestOrder {
  return {
    subtotal_cents: 100000,
    travel_fee_cents: 5000,
    surface_fee_cents: 2000,
    same_day_pickup_fee_cents: 3000,
    same_day_weekday_delivery_fee_cents: 4000,
    same_day_weekday_delivery_fee_waived: false,
    generator_fee_cents: 6000,
    setup_fee_cents: 1500,
    generator_qty: 2,
    tax_cents: 8000,
    tip_cents: 2000,
    deposit_due_cents: 30000,
    deposit_paid_cents: 10000,
    balance_due_cents: 88000,
    custom_deposit_cents: 25000,
    pickup_preference: 'next_day',
    event_date: '2026-10-10',
    event_end_date: '2026-10-11',
    travel_total_miles: '12.5',
    ...over,
  } as unknown as TestOrder;
}

// An order with every monetary field zeroed, so a scenario can vary one input.
function bareOrder(over: Record<string, unknown> = {}): TestOrder {
  return mkOrder({
    subtotal_cents: 10000,
    travel_fee_cents: 0,
    surface_fee_cents: 0,
    same_day_pickup_fee_cents: 0,
    same_day_weekday_delivery_fee_cents: 0,
    generator_fee_cents: 0,
    setup_fee_cents: 0,
    tax_cents: 0,
    tip_cents: 0,
    ...over,
  });
}

const ITEMS = [
  { id: 'i1', unit_id: 'u1', qty: 1, wet_or_dry: 'dry', unit_price_cents: 60000 },
  { id: 'i2', unit_id: null, product_id: 'p1', qty: 2, wet_or_dry: null, unit_price_cents: 20000 },
  { id: 'i3', unit_id: 'u2', qty: 1, wet_or_dry: 'water', unit_price_cents: 0 },
] as unknown as TestItems;

function disc(over: Record<string, unknown>): TestDiscount {
  return { name: 'd', ...over } as unknown as TestDiscount;
}
function fee(over: Record<string, unknown>): TestFee {
  return { name: 'f', amount_cents: 0, ...over } as unknown as TestFee;
}

interface Run {
  primary: OrderSummaryData;
  fallback: OrderSummaryData;
}

// Runs both call-site shapes through the helper and compares each against the
// matching oracle.
function check(
  label: string,
  order: TestOrder,
  discounts: TestDiscount[] = [],
  customFees: TestFee[] = [],
  travelMiles = 12.5,
): Run {
  const primary = buildCurrentOrderSummaryData({
    order,
    orderItems: ITEMS,
    discounts,
    customFees,
    travelMiles,
    subtotalCents: order.subtotal_cents,
  });
  ok(`${label} [primary matches oracle]`, same(primary, oraclePrimary(order, ITEMS, discounts, customFees, travelMiles)));

  const fallback = buildCurrentOrderSummaryData({
    order,
    orderItems: ITEMS,
    discounts,
    customFees,
    travelMiles: parseFloat(order.travel_total_miles as string) || 0,
    subtotalCents: order.subtotal_cents || 0,
  });
  ok(`${label} [fallback matches oracle]`, same(fallback, oracleFallback(order, ITEMS, discounts, customFees)));

  return { primary, fallback };
}

// ---------------------------------------------------------------------------
// 1. Hand-calculated anchor case
//    fees = 5000 + 2000 + 3000 + 4000 + 6000 + 1500 = 21500
//    custom fees = 1000 + 2500 = 3500 (the 9999 one is new, ignored)
//    discounts = 10% of 100000 = 10000, plus fixed 5000 = 15000 (7777 is new, ignored)
//    total = 100000 + 21500 + 3500 - 15000 + 8000 = 118000
// ---------------------------------------------------------------------------

const anchorDiscounts = [disc({ percentage: 10 }), disc({ amount_cents: 5000 }), disc({ amount_cents: 7777, is_new: true })];
const anchorFees = [fee({ amount_cents: 1000 }), fee({ amount_cents: 2500 }), fee({ amount_cents: 9999, is_new: true })];
const anchor = check('anchor', mkOrder(), anchorDiscounts, anchorFees);
ok('anchor total_cents is 118000 (primary)', anchor.primary.total_cents === 118000);
ok('anchor total_cents is 118000 (fallback)', anchor.fallback.total_cents === 118000);
ok('anchor keeps only existing discounts', anchor.primary.discounts.length === 2);
ok('anchor keeps only existing custom fees', anchor.primary.customFees.length === 2);
ok('anchor subtotal_cents raw (primary)', anchor.primary.subtotal_cents === 100000);
ok('anchor tip_cents shown', anchor.primary.tip_cents === 2000);

// ---------------------------------------------------------------------------
// 2-8. Discounts
// ---------------------------------------------------------------------------

ok('percentage discount: 10% of 10000 -> total 9000',
  check('pct', bareOrder(), [disc({ percentage: 10 })]).primary.total_cents === 9000);
ok('percentage rounds up: 15% of 999 = 149.85 -> 150 -> total 849',
  check('pct round up', bareOrder({ subtotal_cents: 999 }), [disc({ percentage: 15 })]).primary.total_cents === 849);
ok('percentage rounds down: 12.5% of 1001 = 125.125 -> 125 -> total 876',
  check('pct round down', bareOrder({ subtotal_cents: 1001 }), [disc({ percentage: 12.5 })]).primary.total_cents === 876);
ok('percentage 0 falls through to fixed amount: total 9300',
  check('pct zero', bareOrder(), [disc({ percentage: 0, amount_cents: 700 })]).primary.total_cents === 9300);
ok('APPROVED rule: the fixed amount wins over the percentage when both are set: total 1',
  check('pct wins', bareOrder(), [disc({ percentage: 10, amount_cents: 9999 })]).primary.total_cents === 1);
ok('fixed discount: total 7500',
  check('fixed', bareOrder(), [disc({ amount_cents: 2500 })]).primary.total_cents === 7500);
ok('multiple discounts: 10000 - 1000 - 500 - 250 = 8250',
  check('multi', bareOrder(), [disc({ percentage: 10 }), disc({ amount_cents: 500 }), disc({ amount_cents: 250 })]).primary.total_cents === 8250);
const newDiscountOnly = check('new discount ignored', bareOrder(), [disc({ amount_cents: 5000, is_new: true })]);
ok('is_new discount ignored in total', newDiscountOnly.primary.total_cents === 10000);
ok('is_new discount removed from the list', newDiscountOnly.primary.discounts.length === 0);
ok('discount with neither percentage nor amount counts as 0',
  check('empty discount', bareOrder(), [disc({})]).primary.total_cents === 10000);

// ---------------------------------------------------------------------------
// 9-10. Custom fees
// ---------------------------------------------------------------------------

const feesRun = check('custom fees', bareOrder(), [], [fee({ amount_cents: 300 }), fee({ amount_cents: 700, is_new: true })]);
ok('existing custom fee included, new custom fee ignored: total 10300', feesRun.primary.total_cents === 10300);
ok('is_new custom fee removed from the list', feesRun.primary.customFees.length === 1);

// ---------------------------------------------------------------------------
// 11-16. Each fee and tax individually: subtotal 1000 + 100 -> 1100
// ---------------------------------------------------------------------------

const feeFields = [
  'travel_fee_cents',
  'surface_fee_cents',
  'same_day_pickup_fee_cents',
  'same_day_weekday_delivery_fee_cents',
  'generator_fee_cents',
  'setup_fee_cents',
  'tax_cents',
];
for (const field of feeFields) {
  const r = check(`single ${field}`, bareOrder({ subtotal_cents: 1000, [field]: 100 }));
  ok(`${field} adds 100 to total_cents (1100)`, r.primary.total_cents === 1100);
  ok(`${field} is echoed as 100`, (r.primary as unknown as Record<string, unknown>)[field] === 100);
}

// ---------------------------------------------------------------------------
// 17. Tip is excluded from total_cents
// ---------------------------------------------------------------------------

const tipRun = check('tip', bareOrder({ subtotal_cents: 1000, tip_cents: 5000 }));
ok('tip excluded from total_cents (1000)', tipRun.primary.total_cents === 1000);
ok('tip still emitted as tip_cents', tipRun.primary.tip_cents === 5000);

// ---------------------------------------------------------------------------
// 18-19. Null and undefined monetary fields use the existing || 0 behavior
// ---------------------------------------------------------------------------

const nullOrder = mkOrder({
  subtotal_cents: null, travel_fee_cents: null, surface_fee_cents: null,
  same_day_pickup_fee_cents: null, same_day_weekday_delivery_fee_cents: null,
  same_day_weekday_delivery_fee_waived: null, generator_fee_cents: null, setup_fee_cents: null,
  generator_qty: null, tax_cents: null, tip_cents: null, deposit_paid_cents: null,
});
const nullRun = check('null monetary fields', nullOrder);
ok('null fields: total_cents is 0', nullRun.primary.total_cents === 0);
ok('null fields: fees default to 0', nullRun.primary.travel_fee_cents === 0 && nullRun.primary.setup_fee_cents === 0 && nullRun.primary.tax_cents === 0);
ok('null fields: tip and generator_qty default to 0', nullRun.primary.tip_cents === 0 && nullRun.primary.generator_qty === 0);
ok('null fields: deposit_paid_cents defaults to 0', nullRun.primary.deposit_paid_cents === 0);
ok('null waiver flag becomes false', nullRun.primary.same_day_weekday_delivery_fee_waived === false);

const undefinedOrder = mkOrder({
  subtotal_cents: undefined, travel_fee_cents: undefined, surface_fee_cents: undefined,
  same_day_pickup_fee_cents: undefined, same_day_weekday_delivery_fee_cents: undefined,
  same_day_weekday_delivery_fee_waived: undefined, generator_fee_cents: undefined, setup_fee_cents: undefined,
  generator_qty: undefined, tax_cents: undefined, tip_cents: undefined, deposit_paid_cents: undefined,
});
const undefRun = check('undefined monetary fields', undefinedOrder);
ok('undefined fields: total_cents is 0', undefRun.primary.total_cents === 0);
ok('undefined fields: deposit_paid_cents defaults to 0', undefRun.primary.deposit_paid_cents === 0);
ok('undefined waiver flag becomes false', undefRun.primary.same_day_weekday_delivery_fee_waived === false);

// ---------------------------------------------------------------------------
// 20-23. Raw subtotal on the normal path, normalized on the fallback path
// ---------------------------------------------------------------------------

ok('normal path keeps the raw numeric subtotal', check('subtotal raw', mkOrder({ subtotal_cents: 4321 })).primary.subtotal_cents === 4321);
ok('normal path keeps a raw null subtotal', nullRun.primary.subtotal_cents === null);
ok('normal path keeps a raw undefined subtotal', undefRun.primary.subtotal_cents === undefined);
ok('normal path emits subtotal_cents as an own key even when undefined', Object.keys(undefRun.primary).includes('subtotal_cents'));
ok('fallback normalizes a null subtotal to 0', nullRun.fallback.subtotal_cents === 0);
ok('fallback normalizes an undefined subtotal to 0', undefRun.fallback.subtotal_cents === 0);
ok('fallback keeps a numeric subtotal', check('subtotal fallback', mkOrder({ subtotal_cents: 4321 })).fallback.subtotal_cents === 4321);

// ---------------------------------------------------------------------------
// 24-25. Travel miles are passed through untouched (parsing lives in the parent)
// ---------------------------------------------------------------------------

ok('supplied travelMiles 12.5 passes through', check('miles 12.5', mkOrder(), [], [], 12.5).primary.travel_total_miles === 12.5);
ok('supplied travelMiles 0 passes through', check('miles 0', mkOrder(), [], [], 0).primary.travel_total_miles === 0);
const nanRun = buildCurrentOrderSummaryData({
  order: mkOrder(), orderItems: ITEMS, discounts: [], customFees: [], travelMiles: NaN, subtotalCents: 100000,
});
ok('NaN travelMiles passes through unchanged (no normalization in the helper)', Number.isNaN(nanRun.travel_total_miles));
ok('NaN travelMiles matches the oracle', same(nanRun, oraclePrimary(mkOrder(), ITEMS, [], [], NaN)));
// The fallback's stored-mile parsing is done by the caller: parseFloat(x) || 0.
ok('fallback call-site expression: "12.5" parses to 12.5', check('fallback miles', mkOrder({ travel_total_miles: '12.5' })).fallback.travel_total_miles === 12.5);
ok('fallback call-site expression: invalid text becomes 0', check('fallback bad miles', mkOrder({ travel_total_miles: 'abc' })).fallback.travel_total_miles === 0);
ok('fallback call-site expression: missing value becomes 0', check('fallback no miles', mkOrder({ travel_total_miles: undefined })).fallback.travel_total_miles === 0);

// ---------------------------------------------------------------------------
// 26-32. Raw and defaulted pass-through fields
// ---------------------------------------------------------------------------

const passRun = check('passthrough', mkOrder({ deposit_due_cents: 123, deposit_paid_cents: 456, balance_due_cents: 789, custom_deposit_cents: 0, pickup_preference: 'same_day', event_date: '2027-01-02', event_end_date: '2027-01-03' }));
ok('deposit_due_cents raw', passRun.primary.deposit_due_cents === 123);
ok('deposit_paid_cents kept when set', passRun.primary.deposit_paid_cents === 456);
ok('balance_due_cents raw', passRun.primary.balance_due_cents === 789);
ok('custom_deposit_cents 0 preserved (not defaulted)', passRun.primary.custom_deposit_cents === 0);
ok('pickup_preference raw', passRun.primary.pickup_preference === 'same_day');
ok('event_date raw', passRun.primary.event_date === '2027-01-02');
ok('event_end_date raw', passRun.primary.event_end_date === '2027-01-03');

const rawNulls = check('raw nulls', mkOrder({ deposit_due_cents: null, balance_due_cents: null, custom_deposit_cents: null, event_end_date: undefined }));
ok('deposit_due_cents null preserved', rawNulls.primary.deposit_due_cents === null as unknown as number);
ok('balance_due_cents null preserved', rawNulls.primary.balance_due_cents === null as unknown as number);
ok('custom_deposit_cents null preserved', rawNulls.primary.custom_deposit_cents === null);
ok('event_end_date undefined is an own key with an undefined value', Object.keys(rawNulls.primary).includes('event_end_date') && rawNulls.primary.event_end_date === undefined);

// ---------------------------------------------------------------------------
// 33. Items keep reference identity and order
// ---------------------------------------------------------------------------

ok('items is the same array reference', anchor.primary.items === ITEMS && anchor.fallback.items === ITEMS);
ok('items keep their order', anchor.primary.items[0] === ITEMS[0] && anchor.primary.items[1] === ITEMS[1] && anchor.primary.items[2] === ITEMS[2]);

// ---------------------------------------------------------------------------
// 34. Only the weekday-delivery waiver flag is emitted
// ---------------------------------------------------------------------------

const waiverRun = check('waivers', mkOrder({
  same_day_weekday_delivery_fee_waived: true,
  travel_fee_waived: true, surface_fee_waived: true, same_day_pickup_fee_waived: true,
  generator_fee_waived: true, tax_waived: true,
}));
ok('weekday delivery waiver is emitted', waiverRun.primary.same_day_weekday_delivery_fee_waived === true);
const waiverKeys = Object.keys(waiverRun.primary);
ok('no travel/surface/pickup/generator/tax waiver keys are emitted',
  !waiverKeys.some((k) => ['travel_fee_waived', 'surface_fee_waived', 'same_day_pickup_fee_waived', 'generator_fee_waived', 'tax_waived'].includes(k)));

// ---------------------------------------------------------------------------
// 35. Exact output key set (23 keys)
// ---------------------------------------------------------------------------

const EXPECTED_KEYS = [
  'balance_due_cents', 'custom_deposit_cents', 'customFees', 'deposit_due_cents', 'deposit_paid_cents',
  'discounts', 'event_date', 'event_end_date', 'generator_fee_cents', 'generator_qty', 'items',
  'pickup_preference', 'same_day_pickup_fee_cents', 'same_day_weekday_delivery_fee_cents',
  'same_day_weekday_delivery_fee_waived', 'setup_fee_cents', 'subtotal_cents', 'surface_fee_cents',
  'tax_cents', 'tip_cents', 'total_cents', 'travel_fee_cents', 'travel_total_miles',
].sort();
ok('primary output has exactly the expected 23 keys', same(Object.keys(anchor.primary).sort(), EXPECTED_KEYS));
ok('fallback output has exactly the expected 23 keys', same(Object.keys(anchor.fallback).sort(), EXPECTED_KEYS));

// ---------------------------------------------------------------------------
// 36. The comparison itself distinguishes undefined from a missing key
// ---------------------------------------------------------------------------

ok('same() treats { a: undefined } and {} as different', !same({ a: undefined }, {}));
ok('same() treats NaN as equal to NaN', same(NaN, NaN));
ok('same() treats different values as different', !same({ a: 1 }, { a: 2 }));

console.log(`\nCurrent order summary builder tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} current order summary builder test(s) failed`);
