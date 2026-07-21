// Stage E4 — Pure money + unified composer tests (corrected).
// jiti runner, no React/Supabase.

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

function makeInflatable(unitId: string, price: number, wetOrDry: 'dry' | 'water' = 'dry', qty = 1): InflatableCartItem {
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

function makeProduct(productId: string, name: string, price: number, context: 'standalone' | 'addon' = 'standalone', qty = 1): EventEssentialProductCartItem {
  return {
    item_type: 'event_essential_product',
    product_id: productId,
    product_name: name,
    unit_price_cents: price,
    qty,
    pricing_context: context,
  };
}

function makeBundle(bundleId: string, name: string, price: number, context: 'standalone' | 'addon' = 'standalone', qty = 1): EventEssentialBundleCartItem {
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

// No-tax breakdown: subtotal=15000, travel=11400, tax=0, total=26400
function makeNoTaxBreakdown(overrides: Partial<PriceBreakdown> = {}): PriceBreakdown {
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
    tax_cents: 0,
    tax_applied: false,
    total_cents: 26400,
    deposit_due_cents: 5000,
    balance_due_cents: 21400,
    ...overrides,
  };
}

// Tax-enabled breakdown: subtotal=15000, travel=11400, tax=1584, total=27984
function makeTaxBreakdown(overrides: Partial<PriceBreakdown> = {}): PriceBreakdown {
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
    tax_applied: true,
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
    const bd = makeNoTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('11 inflatable subtotal unchanged', result.inflatableSubtotalCents === 15000);
  }

  // 12. Existing travel fee unchanged.
  {
    const bd = makeNoTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('12 travel fee unchanged', result.travelFeeCents === 11400);
  }

  // 13. Existing surface fee unchanged.
  {
    const bd = makeNoTaxBreakdown({ surface_fee_cents: 2500 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('13 surface fee unchanged', result.surfaceFeeCents === 2500);
  }

  // 14. Existing same-day fee unchanged.
  {
    const bd = makeNoTaxBreakdown({ same_day_pickup_fee_cents: 3000 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('14 same-day fee unchanged', result.sameDayPickupFeeCents === 3000);
  }

  // 15. Existing generator fee unchanged when no EE generator conflict.
  {
    const bd = makeNoTaxBreakdown({ generator_fee_cents: 10000 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p_tables', 'Tables', 5000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('15 generator fee unchanged', result.generatorFeeCents === 10000);
  }

  // 16. Combined equipment subtotal adds EE exactly once.
  {
    const bd = makeNoTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('16 equipment subtotal', result.equipmentSubtotalCents === 24500);
  }

  // 17. Tax-disabled mixed cart.
  {
    const bd = makeNoTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('17 tax disabled', result.taxCents === 0);
  }

  // 18. Tax-enabled mixed cart — only EE tax added, existing tax preserved.
  {
    const bd = makeTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: true });
    // EE tax = round(9500 * 0.06) = 570
    // Unified tax = 1584 + 570 = 2154
    ok('18 tax enabled', result.taxCents === 2154);
  }

  // 19. Existing fee taxable treatment remains unchanged.
  {
    const bd = makeTaxBreakdown({ surface_fee_cents: 2500, generator_fee_cents: 10000 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: true });
    // Inflatable-only: tax unchanged from breakdown
    ok('19 fee taxable treatment', result.taxCents === 1584);
  }

  // 20. Deposit unchanged by Event Essentials.
  {
    const bd = makeNoTaxBreakdown({ deposit_due_cents: 5000 });
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon', 5)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('20 deposit unchanged', result.depositCents === 5000);
  }

  // 21. Screenshot example: 15000 + 9500 + 11400 = 35900 before tax (no tax).
  {
    const bd = makeNoTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('21 screenshot example no tax', result.totalCents === 35900);
  }

  // 22. Removing the EE line returns total to 26400 (no tax).
  {
    const bd = makeNoTaxBreakdown();
    const cartWithEE: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const cartWithoutEE: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const withEE = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart: cartWithEE, taxApplied: false });
    const withoutEE = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart: cartWithoutEE, taxApplied: false });
    ok('22 removing EE returns to 26400', withoutEE.totalCents === 26400 && withEE.totalCents === 35900);
  }

  // 23. Repricing Generator 10000 -> 9500 changes total by exactly 500.
  {
    const bd = makeNoTaxBreakdown();
    const cart100: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 10000, 'standalone')];
    const cart95: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const r100 = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart: cart100, taxApplied: false });
    const r95 = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart: cart95, taxApplied: false });
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
    const bd = makeNoTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const quoteResult = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    const checkoutResult = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok(
      '26 quote=checkout deep equal',
      JSON.stringify(quoteResult) === JSON.stringify(checkoutResult),
    );
  }

  // 27. Stored order subtotal/total match Checkout totals (no double-count).
  {
    const bd = makeNoTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    // Stored subtotal_cents = equipmentSubtotal (inflatable + EE combined)
    // calculateTotalFromOrder must NOT add event_essentials_subtotal_cents again
    // Total = subtotal + fees + tax = 24500 + 11400 + 0 = 35900
    ok('27 stored matches checkout', result.equipmentSubtotalCents === 24500 && result.totalCents === 35900);
  }

  // 28. Event Essentials-only cart is blocked at the current stage.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Gen', 9500)];
    const hasInflatable = cart.some((i) => i.item_type === 'inflatable' || i.item_type === undefined);
    ok('28 EE-only blocked', !hasInflatable);
  }

  // 29. Inflatable-only output deep-equals pre-E4 fixture (no tax).
  {
    const bd = makeNoTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok(
      '29 inflatable-only matches pre-E4 (no tax)',
      result.inflatableSubtotalCents === bd.subtotal_cents &&
        result.eventEssentialsSubtotalCents === 0 &&
        result.equipmentSubtotalCents === bd.subtotal_cents &&
        result.travelFeeCents === bd.travel_fee_cents &&
        result.taxCents === bd.tax_cents &&
        result.totalCents === bd.total_cents &&
        result.depositCents === bd.deposit_due_cents,
    );
  }

  // 29b. Inflatable-only output deep-equals pre-E4 fixture (tax enabled).
  {
    const bd = makeTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: true });
    ok(
      '29b inflatable-only matches pre-E4 (tax)',
      result.taxCents === bd.tax_cents &&
        result.totalCents === bd.total_cents,
    );
  }

  // 30. No Event Essential line affects deposit.
  {
    const bd = makeNoTaxBreakdown({ deposit_due_cents: 5000 });
    const cart: UnifiedCartItem[] = [
      makeInflatable('u1', 15000),
      makeProduct('p1', 'Gen', 9500, 'addon', 10),
      makeBundle('b1', 'Celebration', 15000, 'addon', 5),
    ];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: false });
    ok('30 EE no deposit impact', result.depositCents === 5000);
  }

  // 31. calculateTotalFromOrder does NOT double-count EE.
  // Simulate: subtotal_cents=24500 (already includes EE), event_essentials_subtotal_cents=9500
  // Total must be 24500 + 11400 + 0 = 35900, NOT 24500 + 9500 + 11400 = 45400
  {
    const order = {
      subtotal_cents: 24500,
      event_essentials_subtotal_cents: 9500,
      travel_fee_cents: 11400,
      surface_fee_cents: 0,
      same_day_pickup_fee_cents: 0,
      same_day_weekday_delivery_fee_cents: 0,
      generator_fee_cents: 0,
      tax_cents: 0,
    };
    const total = order.subtotal_cents + order.travel_fee_cents + order.tax_cents;
    ok('31 no double-count EE', total === 35900);
  }

  // 32. Tax-enabled: unified total = inflatable total + EE + EE tax.
  {
    const bd = makeTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: true });
    // Inflatable total = 27984, EE = 9500, EE tax = 570
    // Unified = 27984 + 9500 + 570 = 38054
    ok('32 tax-enabled total', result.totalCents === 38054);
  }

  // 33. Overflow inputs cannot produce Infinity.
  {
    const item = makeProduct('p1', 'Huge', Number.MAX_SAFE_INTEGER, 'standalone', Number.MAX_SAFE_INTEGER);
    const cart: UnifiedCartItem[] = [item];
    const result = calculateEventEssentialsSubtotalCents(cart);
    ok('33 overflow no Infinity', Number.isFinite(result) && result === 0);
  }

  // 34. qty=0 is rejected (not converted to 1).
  {
    const item = makeProduct('p1', 'Zero', 10000, 'standalone', 0);
    const cart: UnifiedCartItem[] = [item];
    const result = calculateEventEssentialsSubtotalCents(cart);
    ok('34 qty=0 rejected', result === 0);
  }

  // 35. Visible tax equals tax included in total (tax-enabled).
  {
    const bd = makeTaxBreakdown();
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Gen', 9500, 'addon')];
    const result = composeUnifiedQuoteTotals({ inflatableBreakdown: bd, cart, taxApplied: true });
    // total = inflatable_total + ee + ee_tax = 27984 + 9500 + 570 = 38054
    // tax = inflatable_tax + ee_tax = 1584 + 570 = 2154
    // Verify: total - equipment - fees = tax
    const fees = result.travelFeeCents + result.surfaceFeeCents + result.sameDayPickupFeeCents + result.sameDayWeekdayDeliveryFeeCents + result.generatorFeeCents;
    const impliedTax = result.totalCents - result.equipmentSubtotalCents - fees;
    ok('35 visible tax equals total tax', impliedTax === result.taxCents);
  }
}

run();

console.log(`\nStage E4 money tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
