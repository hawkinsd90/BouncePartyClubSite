// Stage E4 — Production-helper focused tests
import { buildEventEssentialAvailabilityRequestFromOrderItems } from './eeOrderItemAvailability';
import { getQuotePricingDisplayState } from './quotePricingDisplayState';
import { buildReceiptEmailInput } from './orderEmailTemplates';
import { composeUnifiedQuoteTotals } from './unifiedTotals';
import { DEFAULT_EE_ONLY_DEPOSIT_SETTINGS } from './depositCalculation';
import type { PriceBreakdown } from './pricing';
import type { UnifiedCartItem } from '../types';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

function makeBd(overrides: Partial<PriceBreakdown> = {}): PriceBreakdown {
  return {
    subtotal_cents: 0, travel_fee_cents: 0, travel_total_miles: 0,
    travel_base_radius_miles: 15, travel_chargeable_miles: 0,
    travel_per_mile_cents: 200, travel_is_flat_fee: false,
    travel_fee_display_name: '', surface_fee_cents: 0,
    same_day_pickup_fee_cents: 0, same_day_weekday_delivery_fee_cents: 0,
    generator_fee_cents: 0, tax_cents: 0, tax_applied: false,
    total_cents: 0, deposit_due_cents: 0, balance_due_cents: 0,
    event_essentials_subtotal_cents: 0,
    ...overrides,
  };
}

function makeProduct(id: string, name: string, price: number, qty = 1): UnifiedCartItem {
  return {
    item_type: 'event_essential_product',
    product_id: id, product_name: name,
    unit_price_cents: price, qty,
  } as any;
}

// (makeBundle removed — unused in this test file)

// 1. unit_id-only row is accepted as inflatable and excluded from EE request
{
  const items = [
    { unit_id: 'u1', qty: 1 },
    { product_id: 'p1', qty: 2 },
  ];
  const result = buildEventEssentialAvailabilityRequestFromOrderItems(items);
  ok('1 status ready', result.status === 'ready');
  if (result.status === 'ready') {
    ok('1 only product p1 in request', result.productQuantities.length === 1);
    ok('1 product is p1', result.productQuantities[0].product_id === 'p1');
    ok('1 qty is 2', result.productQuantities[0].quantity === 2);
  }
}

// 2. unit_id + product_id returns invalid
{
  const result = buildEventEssentialAvailabilityRequestFromOrderItems([
    { unit_id: 'u1', product_id: 'p1', qty: 1 },
  ]);
  ok('2 invalid', result.status === 'invalid');
}

// 3. unit_id + bundle_id returns invalid
{
  const result = buildEventEssentialAvailabilityRequestFromOrderItems([
    { unit_id: 'u1', bundle_id: 'b1', qty: 1 },
  ]);
  ok('3 invalid', result.status === 'invalid');
}

// 4. product_id + bundle_id returns invalid
{
  const result = buildEventEssentialAvailabilityRequestFromOrderItems([
    { product_id: 'p1', bundle_id: 'b1', qty: 1 },
  ]);
  ok('4 invalid', result.status === 'invalid');
}

// 5. all three identities return invalid
{
  const result = buildEventEssentialAvailabilityRequestFromOrderItems([
    { unit_id: 'u1', product_id: 'p1', bundle_id: 'b1', qty: 1 },
  ]);
  ok('5 invalid', result.status === 'invalid');
}

// 6. missing all identities returns invalid
{
  const result = buildEventEssentialAvailabilityRequestFromOrderItems([
    { qty: 1 },
  ]);
  ok('6 invalid', result.status === 'invalid');
}

// 7. package multiplication overflow returns invalid
{
  const result = buildEventEssentialAvailabilityRequestFromOrderItems([
    {
      bundle_id: 'b1', qty: Number.MAX_SAFE_INTEGER,
      component_snapshot: { components: [{ product_id: 'p1', quantity_per_bundle: 2 }] },
    },
  ]);
  ok('7 invalid overflow', result.status === 'invalid');
}

// 8. duplicate-product aggregation overflow returns invalid
{
  const maxSafe = Number.MAX_SAFE_INTEGER;
  const result = buildEventEssentialAvailabilityRequestFromOrderItems([
    { product_id: 'p1', qty: maxSafe },
    { bundle_id: 'b1', qty: 1, component_snapshot: { components: [{ product_id: 'p1', quantity_per_bundle: 1 }] } },
  ]);
  ok('8 invalid aggregation overflow', result.status === 'invalid');
}

// 9. normal direct + package quantities aggregate correctly
{
  const result = buildEventEssentialAvailabilityRequestFromOrderItems([
    { product_id: 'p1', qty: 3 },
    { bundle_id: 'b1', qty: 2, component_snapshot: { components: [{ product_id: 'p1', quantity_per_bundle: 4 }] } },
    { product_id: 'p2', qty: 1 },
  ]);
  ok('9 ready', result.status === 'ready');
  if (result.status === 'ready') {
    const p1 = result.productQuantities.find(p => p.product_id === 'p1');
    const p2 = result.productQuantities.find(p => p.product_id === 'p2');
    ok('9 p1 aggregated = 11', p1?.quantity === 11);
    ok('9 p2 = 1', p2?.quantity === 1);
  }
}

// 10. Quote summary render decision does not expose zero total while totals unavailable
{
  ok('10 null totals → calculating', getQuotePricingDisplayState(null, null) === 'calculating');
  ok('10 null totals + error → error', getQuotePricingDisplayState(null, 'bad config') === 'error');
  const fakeTotals = { inflatableSubtotalCents: 0, eventEssentialsSubtotalCents: 0, equipmentSubtotalCents: 0, travelFeeCents: 0, surfaceFeeCents: 0, sameDayPickupFeeCents: 0, sameDayWeekdayDeliveryFeeCents: 0, generatorFeeCents: 0, taxableSubtotalCents: 0, taxCents: 0, totalCents: 10000, depositCents: 5000, balanceDueCents: 5000 } as any;
  ok('10 totals → ready', getQuotePricingDisplayState(fakeTotals, null) === 'ready');
}

// 11. Invoice-acceptance receipt adapter receives a generated short URL
{
  const input = buildReceiptEmailInput({
    order: { id: 'order-123' },
    customer: { first_name: 'Jane' },
    address: null,
    items: [],
    payment: null,
    totalCents: 5000,
    portalUrl: 'https://example.com/i/ABC123',
  });
  ok('11 portalUrl is short URL', input.portalUrl === 'https://example.com/i/ABC123');
  ok('11 portalUrl is not window.location', !input.portalUrl.includes('customer-portal/order-123'));
}

// 12. Event Essentials-only cart reflects supported behavior
{
  const cart: UnifiedCartItem[] = [makeProduct('p1', 'Generator', 9500)];
  const hasInflatable = cart.some(i => i.item_type === 'inflatable' || i.item_type === undefined);
  ok('12 zero inflatables', !hasInflatable);
  ok('12 has valid EE', cart.length > 0);
  const bd = makeBd({ subtotal_cents: 9500, total_cents: 9500 });
  const totals = composeUnifiedQuoteTotals({
    inflatableBreakdown: bd, cart, taxApplied: false,
    inflatableDepositPerUnitCents: 5000,
    eeOnlyDepositSettings: DEFAULT_EE_ONLY_DEPOSIT_SETTINGS,
  });
  ok('12 receives configured deposit', totals.depositCents > 0);
  ok('12 not blocked by missing inflatable', !totals.depositError);
}

console.log(`\nStage E4 Production-Helper Tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
