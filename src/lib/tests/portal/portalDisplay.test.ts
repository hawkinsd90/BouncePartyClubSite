// Defect: the portal's Order Details card read order.total_cents and order.order_number, which orders does not have and the portal projection never
// sends. With no loaded summary the Total row therefore read $0.00 next to real Subtotal / fee rows. The data contract is the projection's field list
// (supabase/functions/_shared/portal/portal-projection.ts); the fallback is the total composed from the stored components, as on the approval screen.
import { readFileSync } from 'node:fs';
import { portalOrderTotalCents } from '../../portal/portalDisplay';
import { storedOrderTotalCents } from '../../pricing/orderMoney';
import * as projection from '../../../../supabase/functions/_shared/portal/portal-projection';

let passed = 0;
let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}\n  got:      ${JSON.stringify(got)}\n  expected: ${JSON.stringify(want)}`);
  }
}
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

// the contract
const fields: string[] = [...projection.PORTAL_ORDER_FIELDS];
ok('the portal projection sends no total_cents, order_number or customer_email', !['total_cents', 'order_number', 'customer_email'].some((f) => fields.includes(f)));
ok('it does send the stored components a total is composed from', ['subtotal_cents', 'travel_fee_cents', 'surface_fee_cents', 'tax_cents'].every((f) => fields.includes(f)));

// the behavior
const order = { subtotal_cents: 25000, travel_fee_cents: 2000, surface_fee_cents: 3500, same_day_pickup_fee_cents: 0, generator_fee_cents: 10000, setup_fee_cents: 0, tax_cents: 2400 };
eq('with a loaded summary the summary total is shown', portalOrderTotalCents(order, { total: 41900 }), 41900);
eq('without one the total is composed from the stored components (not $0)', portalOrderTotalCents(order, null), storedOrderTotalCents(order, [], []));
eq('...and that is the sum of the rows the card lists', portalOrderTotalCents(order, null), 25000 + 2000 + 3500 + 10000 + 2400);
eq('the old fallback (order.total_cents || 0) was always zero for a projected order', ((order as { total_cents?: number }).total_cents || 0), 0);
eq('a missing component counts as zero', portalOrderTotalCents({ subtotal_cents: 1000 }, null), 1000);

// the screen
const view = readFileSync('src/components/customer-portal/RegularPortalView.tsx', 'utf8').replace(/\r\n/g, '\n');
ok('RegularPortalView no longer reads order.total_cents', !/order\.total_cents/.test(view));
ok('RegularPortalView no longer reads order.order_number', !/order\.order_number/.test(view));
ok('the Total row uses portalOrderTotalCents', /formatCurrency\(portalOrderTotalCents\(order, orderSummary\)\)/.test(view));
ok('the lot-pictures tab gets the short order id', /orderNumber=\{formatOrderId\(order\.id\)\}/.test(view));
const types = readFileSync('src/components/customer-portal/portalTypes.ts', 'utf8');
ok('portalTypes no longer declares the nonexistent total_cents / order_number', !/total_cents\?|order_number\?/.test(types));

console.log(`portalDisplay: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} portal display test(s) failed`);
