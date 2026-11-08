// WP-P1-03 (F-03): a WAIVED fee must be shown as waived in the customer-facing summary chain, and the visible, charged lines must add up to the total.
// Chain: order row -> buildOrderSummaryData (loader) -> formatOrderSummary -> buildFeesList/buildOrderSummaryDisplay -> OrderSummary / portal / approval views.
// Defect: the loader copied only same_day_weekday_delivery_fee_waived, so a waived travel/surface/pickup/generator fee reached the display as a plain charged
// line next to a total that did not include it. PASS - LOCAL AUTOMATED (pure rules; the view checks are SOURCE-LEVEL, not UI integration tests).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { buildFeesList } from '../../orders/orderSummaryDisplay';
import { loadModuleWithMocks } from '../support/hookHarness';

declare const require: (id: string) => any;
// The loader imports the Supabase client (needs import.meta.env); the pure pieces are real, only the client and the distance helper are replaced.
const loader = loadModuleWithMocks('src/lib/orders/orderSummaryLoader.ts', {
  '../supabase': { supabase: {} },
  '../pricing': { calculateDrivingDistance: async () => 0 },
  '../core/businessLocation': { HOME_BASE: { lat: 0, lng: 0 } },
  './orderSummaryDisplay': require('../../orders/orderSummaryDisplay'),
  '../pricing/orderMoney': require('../../pricing/orderMoney'),
  '../pricing/orderFeeDisplay': require('../../pricing/orderFeeDisplay'),
  './formatStoredOrderItems': require('../../orders/formatStoredOrderItems'),
});
const { buildOrderSummaryData, formatOrderSummary } = loader;

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const FEES = [
  ['travel', 'travel_fee', 'Travel Fee'],
  ['surface', 'surface_fee', 'Surface Fee (Sandbags)'],
  ['same_day_pickup', 'same_day_pickup_fee', 'Same-Day Pickup Fee'],
  ['same_day_weekday_delivery', 'same_day_weekday_delivery_fee', 'Same-Day Delivery Fee'],
  ['generator', 'generator_fee', 'Generator'],
] as const;

function baseOrder(extra: Record<string, unknown> = {}) {
  return {
    subtotal_cents: 30000, travel_fee_cents: 0, surface_fee_cents: 0, same_day_pickup_fee_cents: 0, same_day_weekday_delivery_fee_cents: 0,
    generator_fee_cents: 0, generator_qty: 1, tax_cents: 0, tip_cents: 0, deposit_due_cents: 0, deposit_paid_cents: 0, balance_due_cents: 0,
    pickup_preference: 'next_day', event_date: '2030-01-01', travel_total_miles: 1, ...extra,
  };
}
async function summary(order: any): Promise<{ data: any; display: { fees: any[]; totalFees: number; total: number } }> {
  const data = await buildOrderSummaryData({ order, items: [], discounts: [], customFees: [] });
  return { data, display: formatOrderSummary(data!) };
}

async function main() {
  // 1. Each of the five fees: waived (stored 0, amount remembered) -> flag reaches the display line; not charged, so not in totalFees.
  for (const [key, col, name] of FEES) {
    const order = baseOrder({ [`${col}_cents`]: 0, [`${col}_waived`]: true, waived_fee_amounts_cents: { [key]: 5000 } });
    const { data, display } = await summary(order);
    ok(`${key}: loader copies ${col}_waived`, (data as any)[`${col}_waived`] === true);
    const line = display.fees.find((f) => f.name.startsWith(name));
    ok(`${key}: line is present and flagged waived`, !!line && line.waived === true);
    ok(`${key}: remembered amount still shown (struck through by the view)`, line?.amount === 5000);
    ok(`${key}: waived amount excluded from totalFees`, display.totalFees === 0);
  }

  // 2. A fee that is charged (not waived) carries no waived flag and counts toward totalFees.
  for (const [key, col, name] of FEES) {
    const { display } = await summary(baseOrder({ [`${col}_cents`]: 4000 }));
    const line = display.fees.find((f) => f.name.startsWith(name));
    ok(`${key}: charged line not flagged waived`, !!line && !line.waived && line.amount === 4000);
    ok(`${key}: charged line counted in totalFees`, display.totalFees === 4000);
  }

  // 3. Waived with no stored historical amount: flagged waived AND amountUnknown (view shows "WAIVED" with no dollar figure).
  {
    const { display } = await summary(baseOrder({ travel_fee_waived: true }));
    const line = display.fees.find((f) => f.name.startsWith('Travel Fee'));
    ok('unknown amount: waived and amountUnknown', !!line && line.waived === true && line.amountUnknown === true && line.amount === 0);
  }

  // 4. Reconciliation: one waived travel fee plus one charged surface fee. Visible CHARGED lines + subtotal sum to the stated total.
  {
    const order = baseOrder({ subtotal_cents: 30000, travel_fee_cents: 0, travel_fee_waived: true, waived_fee_amounts_cents: { travel: 10000 }, surface_fee_cents: 3500 });
    const { display, data } = await summary(order);
    const charged = display.fees.filter((f) => !f.waived).reduce((s, f) => s + f.amount, 0);
    ok('reconciliation: subtotal + charged fee lines = total', 30000 + charged === data!.total_cents && display.total === 33500);
    const allLines = display.fees.reduce((s, f) => s + f.amount, 0);
    ok('reconciliation: summing the waived line too would NOT match (the old defect)', 30000 + allLines !== data!.total_cents);
  }

  // 5. buildFeesList direct (the admin / invoice-builder path already passes flags): flag set only when waived.
  {
    const list = buildFeesList({ travel_fee_cents: 0, travel_fee_waived: true, surface_fee_cents: 2000 });
    ok('buildFeesList: waived flag only on the waived fee', list[0].waived === true && list[1].waived === undefined);
  }

  // 6. SOURCE-LEVEL: the customer views render the flag; the shared OrderSummary honours the line flag.
  const approval = read('src/components/customer-portal/OrderApprovalView.tsx');
  const portal = read('src/components/customer-portal/RegularPortalView.tsx');
  const orderSummaryView = read('src/components/order/OrderSummary.tsx');
  ok('source: approval view shows a WAIVED badge from fee.waived', /fee\.waived/.test(approval) && /WAIVED/.test(approval) && /line-through/.test(approval));
  ok('source: portal view shows a WAIVED badge from fee.waived', /fee\.waived/.test(portal) && /WAIVED/.test(portal) && /line-through/.test(portal));
  ok('source: OrderSummary uses the line flag as well as the props', /!!fee\.waived/.test(orderSummaryView));

  console.log(`waivedFeeCustomerDisplay: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();
