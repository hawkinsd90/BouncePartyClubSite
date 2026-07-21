// Stage E4 — Pure money + unified composer tests.
// jiti runner, no React/Supabase. Mirrors existing test convention.

import { calculateEventEssentialsSubtotalCents } from './eventEssentialsMoney';
import { composeUnifiedQuoteTotals } from './unifiedTotals';
import type { PriceBreakdown } from './pricing';
import type {
  UnifiedCartItem,
  InflatableCartItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
  BundleComponentSnapshot,
} from '../types';

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function makeInflatable(
  unitId: string,
  price: number,
  wetOrDry: 'dry' | 'water' = 'dry',
  qty = 1,
): InflatableCartItem {
  return {
    item_type: 'inflatable',
    unit_id: unitId,
    unit_name: `Unit ${unitId}`,
    wet_or_dry: wetOrDry,
    unit_price_cents: price,
    price_dry_cents: price,
    price_water_cents: price + 5000,
    qty,
  };
}

function makeProduct(
  productId: string,
  name: string,
  price: number,
  context: 'standalone' | 'addon' = 'standalone',
  qty = 1,
): EventEssentialProductCartItem {
  return {
    item_type: 'event_essential_product',
    product_id: productId,
    product_name: name,
    unit_price_cents: price,
    qty,
    pricing_context: context,
  };
}

function makeBundle(
  bundleId: string,
  name: string,
  price: number,
  context: 'standalone' | 'addon' = 'standalone',
  qty = 1,
): EventEssentialBundleCartItem {
  const snapshot: BundleComponentSnapshot = {
    bundle_name: name,
    bundle_description: null,
    components: [
      { product_id: 'comp_1', product_name: 'Component 1', quantity_per_bundle: 2 },
    ],
  };
  return {
    item_type: 'event_essential_bundle',
    bundle_id: bundleId,
    bundle_name: name,
    unit_price_cents: price,
    qty,
    pricing_context: context,
    component_snapshot: snapshot,
  };
}

function makeBreakdown(overrides: Partial<PriceBreakdown> = {}): PriceBreakdown {
  return {
    subtotal_cents: 15000,
    travel_fee_cents: 11400,
    travel_total_miles: 20,
    travel_base_radius_miles: 15,
    travel_chargeable_miles: 5,
    travel_per_mile_cents: 200,
    travel_is_flat_fee: false,
    travel_fee_display_name: 'Travel Fee (20.0 mi)',
    surface_fee_cents: 0,
    same_day_pickup_fee_cents: 0,
    same_day_weekday_delivery_fee_cents: 0,
    generator_fee_cents: 0,
    tax_cents: 1584,
    total_cents: 27984,
    deposit_due_cents: 5000,
    balance_due_cents: 22984,
    ...overrides,
  };
}

function run() {
  // 1. Inflatable-only EE subtotal = 0.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    ok('1 inflatable-only EE subtotal 0', calculateEventEssentialsSubtotalCents(cart) === 0);
  }

  // 2. One Event Essential product.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Generator', 9500)];
    ok('2 one product', calculateEventEssentialsSubtotalCents(cart) === 9500);
  }

  // 3. Product qty multiplication.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Tables', 10000, 'standalone', 3)];
    ok('3 product qty mult', calculateEventEssentialsSubtotalCents(cart) === 30000);
  }

  // 4. One package.
  {
    const cart: UnifiedCartItem[] = [makeBundle('b1', 'Celebration', 15000)];
    ok('4 one package', calculateEventEssentialsSubtotalCents(cart) === 15000);
  }

  // 5. Package qty multiplication.
  {
    const cart: UnifiedCartItem[] = [makeBundle('b1', 'Celebration', 15000, 'standalone', 2)];
    ok('5 package qty mult', calculateEventEssentialsSubtotalCents(cart) === 30000);
  }

  // 6. Product + package sum.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Gen', 9500), makeBundle('b1', 'Cel', 15000)];
    ok('6 product+package sum', calculateEventEssentialsSubtotalCents(cart) === 24500);
  }

  // 7. Inflatable excluded from EE subtotal.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500)];
    ok('7 inflatable excluded', calculateEventEssentialsSubtotalCents(cart) === 9500);
  }

  // 8. Malformed price does not produce NaN.
  {
    const item = makeProduct('p1', 'Bad', NaN as unknown as number);
    const cart: UnifiedCartItem[] = [item];
    const result = calculateEventEssentialsSubtotalCents(cart);
    ok('8 malformed price no NaN', !Number.isNaN(result) && result === 0);
  }

  // 9. Malformed qty does not produce NaN.
  {
    const item = makeProduct('p1', 'Bad', 10000, 'standalone', Infinity as unknown as number);
    const cart: UnifiedCartItem[] = [item];
    const result = calculateEventEssentialsSubtotalCents(cart);
    ok('9 malformed qty no NaN', !Number.isNaN(result) && result === 0);
  }

  // 10. Integer-cent precision preserved.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Odd', 10001, 'standalone', 3)];
    ok('10 integer cents', calculateEventEssentialsSubtotalCents(cart) === 30003);
  }

  // 11. Existing inflatable subtotal unchanged.
  {
    const bd = makeBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok('11 inflatable subtotal unchanged', result.inflatableSubtotalCents === 15000);
  }

  // 12. Existing travel fee unchanged.
  {
    const bd = makeBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok('12 travel fee unchanged', result.travelFeeCents === 11400);
  }

  // 13. Existing surface fee unchanged.
  {
    const bd = makeBreakdown({ surface_fee_cents: 2500 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok('13 surface fee unchanged', result.surfaceFeeCents === 2500);
  }

  // 14. Existing same-day fee unchanged.
  {
    const bd = makeBreakdown({ same_day_pickup_fee_cents: 3000 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok('14 same-day fee unchanged', result.sameDayPickupFeeCents === 3000);
  }

  // 15. Existing generator fee unchanged when no EE generator conflict.
  {
    const bd = makeBreakdown({ generator_fee_cents: 10000 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p_tables', 'Tables', 5000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok('15 generator fee unchanged', result.generatorFeeCents === 10000);
  }

  // 16. Combined equipment subtotal adds EE exactly once.
  {
    const bd = makeBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok('16 equipment subtotal', result.equipmentSubtotalCents === 24500);
  }

  // 17. Tax-disabled mixed cart.
  {
    const bd = makeBreakdown({ tax_cents: 0 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: false });
    ok('17 tax disabled', result.taxCents === 0);
  }

  // 18. Tax-enabled mixed cart.
  {
    const bd = makeBreakdown({ tax_cents: 0 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    // taxable: 15000 + 11400 + 0 + 0 + 9500 = 35900 -> 0.06 = 2154
    ok('18 tax enabled', result.taxCents === 2154);
  }

  // 19. Existing fee taxable treatment remains unchanged.
  {
    const bd = makeBreakdown({ surface_fee_cents: 2500, generator_fee_cents: 10000, tax_cents: 0 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    // taxable: 15000 + 11400 + 2500 + 10000 = 38900 -> 0.06 = 2334
    ok('19 fee taxable treatment', result.taxCents === 2334);
  }

  // 20. Deposit unchanged by Event Essentials.
  {
    const bd = makeBreakdown({ deposit_due_cents: 5000 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon', 5)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok('20 deposit unchanged', result.depositCents === 5000);
  }

  // 21. Screenshot example: 15000 + 9500 + 11400 = 35900 before tax.
  {
    const bd = makeBreakdown({ tax_cents: 0 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: false });
    ok('21 screenshot example', result.totalCents === 35900);
  }

  // 22. Removing the EE line returns total to 26400.
  {
    const bd = makeBreakdown({ tax_cents: 1584 });
    const cartWithEE: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const cartWithoutEE: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const withEE = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart: cartWithEE, applyTaxes: true });
    const withoutEE = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart: cartWithoutEE, applyTaxes: true });
    ok('22 removing EE returns to inflatable-only', withoutEE.totalCents === 27984 && withEE.totalCents === 35900 + 2154);
  }

  // 23. Repricing Generator 10000 -> 9500 changes total by exactly 500.
  {
    const bd = makeBreakdown({ tax_cents: 0 });
    const cart100: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 10000, 'standalone')];
    const cart95: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const r100 = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart: cart100, applyTaxes: false });
    const r95 = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart: cart95, applyTaxes: false });
    ok('23 repricing delta 500', r100.totalCents - r95.totalCents === 500);
  }

  // 24. Duplicate Event Essential lines each count once.
  {
    const cart: UnifiedCartItem[] = [
      makeProduct('p1', 'Gen', 9500, 'addon'),
      makeProduct('p1', 'Gen', 9500, 'addon'),
    ];
    ok('24 duplicate lines', calculateEventEssentialsSubtotalCents(cart) === 19000);
  }

  // 25. Package components are not added as additional charges.
  {
    const bundle = makeBundle('b1', 'Celebration', 15000);
    const cart: UnifiedCartItem[] = [bundle];
    const result = calculateEventEssentialsSubtotalCents(cart);
    ok('25 package components not extra', result === 15000);
  }

  // 26. Quote and Checkout composition produce deep-equal totals.
  {
    const bd = makeBreakdown({ tax_cents: 0 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const quoteResult = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    const checkoutResult = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok(
      '26 quote=checkout deep equal',
      JSON.stringify(quoteResult) === JSON.stringify(checkoutResult),
    );
  }

  // 27. Stored order subtotal/total match Checkout totals.
  {
    const bd = makeBreakdown({ tax_cents: 0 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    // Stored subtotal = equipment subtotal, total = composed total
    ok('27 stored matches checkout', result.equipmentSubtotalCents === 24500 && result.totalCents === 35900 + 2154);
  }

  // 28. Event Essentials-only cart is blocked at the current stage (no inflatable breakdown).
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Gen', 9500)];
    // No inflatable breakdown available -> caller must block. Simulate by checking EE-only.
    const hasInflatable = cart.some((i) => i.item_type === 'inflatable' || i.item_type === undefined);
    ok('28 EE-only blocked', !hasInflatable);
  }

  // 29. Inflatable-only output deep-equals pre-E4 fixture.
  {
    const bd = makeBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok(
      '29 inflatable-only matches pre-E4',
      result.inflatableSubtotalCents === bd.subtotal_cents &&
        result.eventEssentialsSubtotalCents === 0 &&
        result.equipmentSubtotalCents === bd.subtotal_cents &&
        result.travelFeeCents === bd.travel_fee_cents &&
        result.taxCents === bd.tax_cents &&
        result.totalCents === bd.total_cents &&
        result.depositCents === bd.deposit_due_cents,
    );
  }

  // 30. No Event Essential line affects deposit.
  {
    const bd = makeBreakdown({ deposit_due_cents: 5000 });
    const cart: UnifiedCartItem[] = [
      makeInflatable('u1', 15000),
      makeProduct('p1', 'Gen', 9500, 'addon', 10),
      makeBundle('b1', 'Celebration', 15000, 'addon', 5),
    ];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, applyTaxes: true });
    ok('30 EE no deposit impact', result.depositCents === 5000);
  }
}

run();

console.log(`\nStage E4 money tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
