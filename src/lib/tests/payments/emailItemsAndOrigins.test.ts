// WP-02 + NI-07 + NI-10 (B3): receipts and emails name Event Essentials lines, carry every fee that is in the total, and link to the site
// this deployment serves (never a hard-coded Production origin, never a caller-chosen host).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { orderItemLabel, orderItemMode, orderItemName, orderItemQtyName, ORDER_ITEM_COLUMNS } from '../../../../supabase/functions/_shared/payments/order-item-label';
import { buildPaymentReceiptEmail } from '../../../../supabase/functions/_shared/payments/payment-receipt-email';
import { receiptOrderFigures } from '../../../../supabase/functions/_shared/payments/receipt-order-totals';
import { configuredOrigins, getSiteOrigin } from '../../../../supabase/functions/_shared/siteOrigin';
import { resolveReturnOrigin, siteOriginFrom } from '../../../../supabase/functions/_shared/booking/returnOrigin';
import { formatOrderId } from '../../../../supabase/functions/_shared/format-order-id';
import { extraFeeRows } from '../../notifications/feeRows';
import { generateCustomerBookingEmail, generateAdminBookingEmail } from '../../notifications/bookingEmailTemplates';
import { buildOrderSummary } from '../../booking/checkoutUtils';

let passed = 0;
let failed = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
  }
}
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8');

// ---- item names ---------------------------------------------------------------------------------------------------------------
const castle = { qty: 2, wet_or_dry: 'dry', unit_price_cents: 20000, unit_id: 'u1', units: { name: 'Castle' } };
const wetSlide = { qty: 1, wet_or_dry: 'water', unit_price_cents: 25000, unit_id: 'u2', units: { name: 'Slide' } };
const tables = { qty: 4, wet_or_dry: null, unit_price_cents: 1500, unit_id: null, product_id: 'p1', units: null, item_name: 'Round Tables' };
const pkg = { qty: 1, wet_or_dry: null, unit_price_cents: 9000, unit_id: null, bundle_id: 'b1', units: null, item_name: 'Party Package' };
eq('inflatable label keeps its mode', orderItemLabel(castle), '2x Castle (Dry)');
eq('wet inflatable', orderItemLabel(wetSlide), '1x Slide (Wet)');
eq('EE product has its own name and no mode', orderItemLabel(tables), '4x Round Tables');
eq('EE package has its own name and no mode', orderItemLabel(pkg), '1x Party Package');
eq('qty+name without the mode', orderItemQtyName(castle), '2x Castle');
eq('mode only for inflatables', [orderItemMode(castle), orderItemMode(tables), orderItemMode(pkg)], ['Dry', null, null]);
eq('a line with neither name falls back to "Item", never "undefined"', orderItemName({ qty: 1, units: null }), 'Item');
eq('relation returned as an array still works', orderItemName({ units: [{ name: 'Bouncer' }] as any }), 'Bouncer');
eq('blank names fall back', orderItemName({ units: { name: '  ' }, item_name: '' }), 'Item');
ok('the shared select names every column a label needs', ['qty', 'wet_or_dry', 'unit_price_cents', 'unit_id', 'product_id', 'bundle_id', 'item_name', 'units(name)'].every((c) => ORDER_ITEM_COLUMNS.includes(c)));

// ---- the payment receipt email for the four order shapes -----------------------------------------------------------------------
const baseOrder = { event_date: '2030-06-01', start_window: '10:00', end_window: '14:00', addresses: { line1: '1 Main', city: 'Detroit', state: 'MI' }, location_type: 'residential', tax_cents: 0 };
function receipt(order: any, extra: Partial<Parameters<typeof buildPaymentReceiptEmail>[0]> = {}) {
  return buildPaymentReceiptEmail({
    firstName: 'Pat', orderId: 'o1', orderNum: 'ABCD1234', amountCents: 5000, tipCents: 0, totalCents: 5000, paymentType: 'deposit', newBalanceDue: 0,
    order: { ...baseOrder, ...order }, businessPhone: '(313) 555-0100', paymentBanner: '', paymentMethodLabel: 'Card', ...extra,
  });
}
const inflatableOnly = receipt({ order_items: [castle], subtotal_cents: 40000, surface: 'grass' });
ok('inflatable-only: name and mode, no undefined', inflatableOnly.includes('2x Castle') && inflatableOnly.includes('(Dry)') && !inflatableOnly.includes('undefined'));
const eeOnly = receipt({ order_items: [tables, pkg], subtotal_cents: 15000, surface: null, setup_fee_cents: 15000 - 15000 + 2500 });
ok('EE-only: product and package names appear', eeOnly.includes('4x Round Tables') && eeOnly.includes('1x Party Package'));
ok('EE-only: no undefined, no wet/dry, no surface row', !eeOnly.includes('undefined') && !eeOnly.includes('(Dry)') && !eeOnly.includes('(Wet)') && !eeOnly.includes('Surface:'));
ok('EE-only: the Setup Fee row is shown when it is in the total', eeOnly.includes('Setup Fee'));
const mixed = receipt({ order_items: [castle, tables], subtotal_cents: 46000, surface: 'grass', same_day_weekday_delivery_fee_cents: 2500 });
ok('mixed: both kinds named, delivery fee row present', mixed.includes('2x Castle') && mixed.includes('(Dry)') && mixed.includes('4x Round Tables') && mixed.includes('Same-Day Delivery Fee'));
const multi = receipt({ order_items: [castle, wetSlide, tables, pkg], subtotal_cents: 100000 });
ok('multi-category: four lines, wet marked wet', ['2x Castle', '1x Slide', '(Wet)', '4x Round Tables', '1x Party Package'].every((t) => multi.includes(t)));
const figures = receiptOrderFigures({ subtotal_cents: 15000, setup_fee_cents: 2500, same_day_weekday_delivery_fee_cents: 2500, tax_cents: 0 }, [], []);
eq('the stored total includes the setup and delivery fees', figures.total, 20000);
const withFees = receipt({ order_items: [tables], subtotal_cents: 15000, setup_fee_cents: 2500, same_day_weekday_delivery_fee_cents: 2500 });
ok('the emailed Total equals the stored total (setup + delivery included)', withFees.includes('$200.00'));

// ---- every receipt select carries the fee columns and the item columns ---------------------------------------------------------
for (const f of ['supabase/functions/stripe-webhook/handlers.ts', 'supabase/functions/customer-balance-payment/index.ts', 'supabase/functions/reconcile-balance-payment/index.ts']) {
  const t = read(f);
  ok(`${f}: the order select includes the setup and delivery fee columns`, t.includes('same_day_weekday_delivery_fee_cents, generator_fee_cents, setup_fee_cents, tax_cents'));
  ok(`${f}: the order items select uses the shared columns`, t.includes('order_items(${ORDER_ITEM_COLUMNS})'));
}
for (const f of ['supabase/functions/record-cash-payment/index.ts', 'supabase/functions/record-check-payment/index.ts']) {
  ok(`${f}: cash/check receipts select the shared item columns`, read(f).includes('order_items (${ORDER_ITEM_COLUMNS})'));
}
ok('the deposit confirmation email (shared by charge-deposit and the post-payment completion) selects the shared item columns and labels lines with them', read('supabase/functions/_shared/payments/deposit-confirmation-email.ts').includes('order_items(${ORDER_ITEM_COLUMNS})') && read('supabase/functions/_shared/payments/deposit-confirmation-email.ts').includes('${orderItemLabel(item)}'));
ok('no server email still reads units?.name directly', !/item\.units\?\.name/.test([
  'supabase/functions/_shared/payments/deposit-confirmation-email.ts', 'supabase/functions/customer-balance-payment/index.ts', 'supabase/functions/reconcile-balance-payment/index.ts',
  'supabase/functions/stripe-webhook/emails.ts', 'supabase/functions/_shared/payments/payment-receipt-email.ts',
].map(read).join('\n')));
ok('complete-booking returns the fee columns the confirmation email shows', ['same_day_weekday_delivery_fee_cents', 'generator_fee_cents', 'setup_fee_cents'].every((c) => read('supabase/functions/complete-booking/index.ts').includes(c)));

// ---- client booking / confirmation emails ----------------------------------------------------------------------------------------
const bookingOrder: any = {
  id: '12345678-aaaa-bbbb-cccc-1234567890ab', customer: { first_name: 'Pat', last_name: 'Lee', email: 'p@x.co' }, event_date: '2030-06-01', start_window: '10:00', end_window: '14:00',
  location_type: 'residential', surface: null, subtotal_cents: 15000, travel_fee_cents: 0, surface_fee_cents: 0, same_day_pickup_fee_cents: 0, tax_cents: 0,
  deposit_due_cents: 5000, balance_due_cents: 12500, travel_total_miles: 0, addresses: { line1: '1 Main', city: 'Detroit', state: 'MI', zip: '48201' },
  order_items: [{ qty: 4, wet_or_dry: null, unit_price_cents: 1500, unit_id: null, product_id: 'p1', bundle_id: null, item_name: 'Round Tables', pricing_context: 'standalone', component_snapshot: null, units: null }],
  setup_fee_cents: 2500, same_day_weekday_delivery_fee_cents: 0, generator_fee_cents: 0,
};
const eeBooking = generateCustomerBookingEmail(bookingOrder);
ok('EE-only booking email: no "Surface" row and no "null"', !eeBooking.includes('Surface') && !/>\s*null\s*</.test(eeBooking));
ok('EE-only booking email lists the Setup Fee', eeBooking.includes('Setup Fee'));
const inflatableBooking = generateCustomerBookingEmail({ ...bookingOrder, surface: 'grass', setup_fee_cents: 0, order_items: [{ ...castle, unit_id: 'u1', product_id: null, bundle_id: null, item_name: null, pricing_context: null, component_snapshot: null }] });
ok('inflatable booking email keeps the Surface row and has no extra fee rows', inflatableBooking.includes('Surface') && !inflatableBooking.includes('Setup Fee') && !inflatableBooking.includes('Same-Day Delivery Fee') && !inflatableBooking.includes('Generator Fee'));
const feeBooking = generateCustomerBookingEmail({ ...bookingOrder, surface: 'grass', same_day_weekday_delivery_fee_cents: 2500, generator_fee_cents: 10000, setup_fee_cents: 0 });
ok('booking email lists the generator and same-day delivery fees', feeBooking.includes('Generator Fee') && feeBooking.includes('Same-Day Delivery Fee'));
ok('admin booking email lists the extra fees as well', generateAdminBookingEmail({ ...bookingOrder, setup_fee_cents: 2500 }).includes('Setup Fee'));
eq('fee rows helper: nothing when nothing is charged', extraFeeRows({ generator_fee_cents: 0, same_day_weekday_delivery_fee_cents: null, setup_fee_cents: undefined }), []);
eq('fee rows helper: order and amounts', extraFeeRows({ generator_fee_cents: 10000, same_day_weekday_delivery_fee_cents: 2500, setup_fee_cents: 1500 }), [
  { label: 'Generator Fee', value: '$100.00' }, { label: 'Same-Day Delivery Fee', value: '$25.00' }, { label: 'Setup Fee', value: '$15.00' },
]);

// ---- checkout summary lists the Setup Fee ----------------------------------------------------------------------------------------
const totals: any = { equipmentSubtotalCents: 3000, setupFeeCents: 12000, taxCents: 0, totalCents: 15000, depositCents: 5000, balanceDueCents: 10000 };
const bd: any = { travel_fee_cents: 0, travel_fee_display_name: 'Travel', surface_fee_cents: 0, same_day_pickup_fee_cents: 0, same_day_weekday_delivery_fee_cents: 0, generator_fee_cents: 0 };
const summary: any = buildOrderSummary(bd, [{ item_type: 'event_essential_product', product_id: 'p1', product_name: 'Tables', unit_price_cents: 1500, qty: 2, pricing_context: 'standalone' }] as any, { pickup_preference: 'next_day' } as any, 0, totals);
ok('the checkout summary shows the Setup Fee line', JSON.stringify(summary?.fees ?? summary).includes('Setup Fee'));
ok('the invoice preview page passes the totals to the summary', read('src/pages/InvoicePreview.tsx').includes('data.unifiedTotals ?? null') && read('src/pages/Checkout.tsx').includes('unifiedTotals,\n    };'.replace('\n', '\r\n')) || read('src/pages/Checkout.tsx').includes('unifiedTotals,\n    };'));
ok('the invoice display names packages from bundle_name', read('src/components/shared/SimpleInvoiceDisplay.tsx').includes('item.bundle_name'));

// ---- NI-07: links use the site this deployment serves --------------------------------------------------------------------------
const env = (map: Record<string, string>) => ({ get: (k: string) => map[k] });
eq('no SITE_URL => Production', getSiteOrigin(env({})), 'https://bouncepartyclub.com');
eq('SITE_URL (https) => that origin', getSiteOrigin(env({ SITE_URL: 'https://www.dev.bouncepartyclub.com' })), 'https://www.dev.bouncepartyclub.com');
eq('SITE_URL with a path or trailing slash => origin only', getSiteOrigin(env({ SITE_URL: 'https://dev.bouncepartyclub.com/some/path/' })), 'https://dev.bouncepartyclub.com');
eq('SITE_URL over plain http => Production', getSiteOrigin(env({ SITE_URL: 'http://example.com' })), 'https://bouncepartyclub.com');
eq('SITE_URL loopback http (local development) is allowed', getSiteOrigin(env({ SITE_URL: 'http://localhost:5173' })), 'http://localhost:5173');
eq('SITE_URL junk => Production', getSiteOrigin(env({ SITE_URL: 'not a url' })), 'https://bouncepartyclub.com');
eq('SITE_URL with credentials => Production', getSiteOrigin(env({ SITE_URL: 'https://user:pw@evil.example' })), 'https://bouncepartyclub.com');
eq('siteOriginFrom rejects non-strings', siteOriginFrom(42), null);
eq('configuredOrigins reads both settings', configuredOrigins(env({ SITE_URL: 'https://a.example', RETURN_ORIGINS: 'https://b.example' })), ['https://a.example', 'https://b.example']);
// A request-supplied origin is only a claim
const configured = configuredOrigins(env({ SITE_URL: 'https://www.dev.bouncepartyclub.com' }));
eq('request origin on the allow-list (configured SITE_URL) wins', resolveReturnOrigin(['https://www.dev.bouncepartyclub.com'], configured), 'https://www.dev.bouncepartyclub.com');
eq('request origin not on the allow-list falls back to the configured site', resolveReturnOrigin(['https://evil.example'], configured), 'https://www.dev.bouncepartyclub.com');
eq('missing Origin and Referer fall back to the configured site', resolveReturnOrigin([null, null], configured), 'https://www.dev.bouncepartyclub.com');
eq('no configuration at all falls back to Production', resolveReturnOrigin(['https://evil.example'], []), 'https://bouncepartyclub.com');

// No server code outside the helper may contain the Production origin as a literal URL
const offenders: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.deno') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !/\.test\.ts$/.test(p) && !p.replace(/\\/g, '/').endsWith('_shared/booking/returnOrigin.ts')) {
      if (/https:\/\/(www\.)?bouncepartyclub\.com/.test(read(p))) offenders.push(p.replace(/\\/g, '/'));
    }
  }
};
walk('supabase/functions');
eq('no Edge Function source outside returnOrigin.ts hard-codes the Production site URL', offenders, []);
const customerBalance = read('supabase/functions/customer-balance-payment/index.ts');
ok('customer-balance-payment no longer trusts the raw Origin/Referer', customerBalance.includes('resolveReturnOrigin([headerOrigin, refererOrigin], configuredOrigins())') && !customerBalance.includes('let siteOrigin = headerOrigin;'));
const sendInvoice = read('supabase/functions/send-invoice/index.ts');
ok('send-invoice no longer trusts the raw Origin header', sendInvoice.includes("resolveReturnOrigin([req.headers.get('origin')], configuredOrigins())"));
ok('order-lifecycle admin links use the configured site', (read('supabase/functions/order-lifecycle/index.ts').match(/\$\{getSiteOrigin\(\)\}\/admin/g) || []).length === 2);

// ---- NI-10: the customer sees the short order number, never the 36-character id -----------------------------------------------
eq('formatOrderId is the first eight characters, upper-case', formatOrderId('12345678-aaaa-bbbb-cccc-1234567890ab'), '12345678');
const sendEmail = read('supabase/functions/send-email/index.ts');
ok('send-email templates use the short order number', sendEmail.includes("const formattedOrderId = formatOrderId(order.id.toString());") && !sendEmail.includes("padStart(4, '0')"));

console.log(`\nB3 email items and origins tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
