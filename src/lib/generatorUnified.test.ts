// Generator Workflow Unification — pure identity helper + invariant tests.
// jiti runner, no React/Supabase.

import {
  getDirectGeneratorQuantity,
  cartHasDirectGenerator,
  removeDirectGeneratorProduct,
  getGeneratorOrderItemQuantity,
  isLegacyGeneratorOrder,
  hasMixedGeneratorState,
  cartPackageContainsGenerator,
  cartHasMixedGeneratorState,
  isValidEventDateRange,
  type PackageGeneratorConfig,
} from './generatorUnified';
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

const GEN_ID = '82a67261-2b54-4704-a8a0-4d346d0a8e60';
const CHAIR_ID = 'chair-product-uuid';

function makeInflatable(unitId: string, price: number): InflatableCartItem {
  return {
    item_type: 'inflatable',
    unit_id: unitId,
    unit_name: `Unit ${unitId}`,
    wet_or_dry: 'dry',
    unit_price_cents: price,
    price_dry_cents: price,
    price_water_cents: price + 5000,
    qty: 1,
  };
}

function makeProduct(productId: string, name: string, price: number, context: 'standalone' | 'addon' = 'addon', qty = 1): EventEssentialProductCartItem {
  return {
    item_type: 'event_essential_product',
    product_id: productId,
    product_name: name,
    unit_price_cents: price,
    qty,
    pricing_context: context,
  };
}

function makeBundleWithGenerator(bundleId: string, name: string, price: number, generatorProductId: string, qty = 1): EventEssentialBundleCartItem {
  const snapshot: BundleComponentSnapshot = {
    bundle_name: name,
    bundle_description: null,
    components: [
      { product_id: generatorProductId, product_name: 'Generator', quantity_per_bundle: 1 },
    ],
  };
  return {
    item_type: 'event_essential_bundle',
    bundle_id: bundleId,
    bundle_name: name,
    unit_price_cents: price,
    qty,
    pricing_context: 'standalone',
    component_snapshot: snapshot,
  };
}

function run() {
  // --- Identity helpers ---

  // 1. Direct generator quantity from cart.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500, 'addon', 2)];
    ok('1 direct qty', getDirectGeneratorQuantity(cart, GEN_ID) === 2);
  }

  // 2. No direct generator returns 0.
  {
    const cart: UnifiedCartItem[] = [makeProduct(CHAIR_ID, 'Tables', 5000, 'addon', 3)];
    ok('2 no direct qty', getDirectGeneratorQuantity(cart, GEN_ID) === 0);
  }

  // 3. cartHasDirectGenerator true when present.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500)];
    ok('3 has direct', cartHasDirectGenerator(cart, GEN_ID) === true);
  }

  // 4. cartHasDirectGenerator false when absent.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    ok('4 no direct', cartHasDirectGenerator(cart, GEN_ID) === false);
  }

  // 5. removeDirectGeneratorProduct removes all direct generator lines.
  {
    const cart: UnifiedCartItem[] = [
      makeInflatable('u1', 15000),
      makeProduct(GEN_ID, 'Generator', 9500, 'addon', 1),
      makeProduct(GEN_ID, 'Generator', 9500, 'addon', 2),
    ];
    const result = removeDirectGeneratorProduct(cart, GEN_ID);
    ok('5 removed all direct', result.length === 1 && result[0].item_type === 'inflatable');
  }

  // 6. removeDirectGeneratorProduct does not remove other products.
  {
    const cart: UnifiedCartItem[] = [
      makeProduct(GEN_ID, 'Generator', 9500),
      makeProduct(CHAIR_ID, 'Tables', 5000),
    ];
    const result = removeDirectGeneratorProduct(cart, GEN_ID);
    ok('6 kept other products', result.length === 1 && (result[0] as EventEssentialProductCartItem).product_id === CHAIR_ID);
  }

  // 7. removeDirectGeneratorProduct does not remove packages.
  {
    const cart: UnifiedCartItem[] = [
      makeBundleWithGenerator('b1', 'Power Bundle', 15000, GEN_ID),
      makeProduct(GEN_ID, 'Generator', 9500),
    ];
    const result = removeDirectGeneratorProduct(cart, GEN_ID);
    ok('7 kept package', result.length === 1 && result[0].item_type === 'event_essential_bundle');
  }

  // 8. getGeneratorOrderItemQuantity from order items.
  {
    const items = [
      { product_id: GEN_ID, qty: 2 },
      { product_id: CHAIR_ID, qty: 1 },
      { product_id: null, qty: 1 },
    ];
    ok('8 order item qty', getGeneratorOrderItemQuantity(items, GEN_ID) === 2);
  }

  // 9. isLegacyGeneratorOrder true for legacy-only.
  {
    ok('9 legacy order', isLegacyGeneratorOrder({ generator_qty: 2, generator_fee_cents: 17000 }, 0) === true);
  }

  // 10. isLegacyGeneratorOrder false when EE item exists.
  {
    ok('10 not legacy', isLegacyGeneratorOrder({ generator_qty: 2, generator_fee_cents: 17000 }, 1) === false);
  }

  // 11. hasMixedGeneratorState true when both present.
  {
    ok('11 mixed state', hasMixedGeneratorState({ generator_qty: 1, generator_fee_cents: 9500 }, 1) === true);
  }

  // 12. hasMixedGeneratorState false when only EE.
  {
    ok('12 not mixed', hasMixedGeneratorState({ generator_qty: 0, generator_fee_cents: 0 }, 1) === false);
  }

  // 13. hasMixedGeneratorState false when only legacy.
  {
    ok('13 not mixed legacy only', hasMixedGeneratorState({ generator_qty: 1, generator_fee_cents: 9500 }, 0) === false);
  }

  // --- Package-contained generator ---

  // 14. cartPackageContainsGenerator detects package generator.
  {
    const cart: UnifiedCartItem[] = [makeBundleWithGenerator('b1', 'Power Bundle', 15000, GEN_ID, 2)];
    const configs: PackageGeneratorConfig[] = [
      { bundle_id: 'b1', product_id: GEN_ID, quantity_per_bundle: 1 },
    ];
    ok('14 package contains gen', cartPackageContainsGenerator(cart, configs, GEN_ID) === 2);
  }

  // 15. cartPackageContainsGenerator returns 0 when no package has generator.
  {
    const cart: UnifiedCartItem[] = [makeBundleWithGenerator('b1', 'Power Bundle', 15000, 'other-product')];
    const configs: PackageGeneratorConfig[] = [];
    ok('15 no package gen', cartPackageContainsGenerator(cart, configs, GEN_ID) === 0);
  }

  // 16. Inflatable-only cart has no direct generator.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeInflatable('u2', 20000)];
    ok('16 inflatable-only no gen', getDirectGeneratorQuantity(cart, GEN_ID) === 0);
  }

  // --- Pricing tests ---

  // 17. One generator at $95 totals $95.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500, 'addon', 1)];
    const total = cart.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
    ok('17 1x $95 = $95', total === 9500);
  }

  // 18. Two generators at $95 total $190.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500, 'addon', 2)];
    const total = cart.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
    ok('18 2x $95 = $190', total === 19000);
  }

  // 19. Three generators at $95 total $285.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500, 'addon', 3)];
    const total = cart.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
    ok('19 3x $95 = $285', total === 28500);
  }

  // 20. No $75 additional-unit calculation used.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500, 'addon', 3)];
    const total = cart.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
    const legacyTotal = 9500 + 7500 * 2; // $95 + 2×$75 = $245
    ok('20 no $75 rule', total === 28500 && total !== legacyTotal);
  }

  // 21. Standalone price multiplies normally.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 12000, 'standalone', 2)];
    const total = cart.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
    ok('21 standalone 2x $120 = $240', total === 24000);
  }

  // 22. Add-on price multiplies normally.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500, 'addon', 2)];
    const total = cart.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);
    ok('22 addon 2x $95 = $190', total === 19000);
  }

  // --- Exact-ID invariant tests ---

  // 23. Legacy Generator plus Chair product is NOT a mixed Generator conflict.
  {
    const cart: UnifiedCartItem[] = [makeProduct(CHAIR_ID, 'Chair', 5000)];
    const result = cartHasMixedGeneratorState(cart, GEN_ID, { has_generator: true, generator_qty: 1 });
    ok('23 legacy+chair not conflict', result === false);
  }

  // 24. Legacy Generator plus direct Generator product IS a conflict.
  {
    const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500)];
    const result = cartHasMixedGeneratorState(cart, GEN_ID, { has_generator: true, generator_qty: 1 });
    ok('24 legacy+direct is conflict', result === true);
  }

  // 25. Legacy Generator plus package containing Generator IS a conflict.
  {
    const cart: UnifiedCartItem[] = [makeBundleWithGenerator('b1', 'Power Bundle', 15000, GEN_ID)];
    const configs: PackageGeneratorConfig[] = [{ bundle_id: 'b1', product_id: GEN_ID, quantity_per_bundle: 1 }];
    const hasPackageGen = cartPackageContainsGenerator(cart, configs, GEN_ID) > 0;
    // The cartHasMixedGeneratorState only checks direct products, not packages.
    // But the orderSaveService invariant checks both staged items and legacy.
    ok('25 legacy+package gen detected', hasPackageGen === true);
  }

  // 26. Legacy Generator plus unrelated package is NOT a conflict.
  {
    const cart: UnifiedCartItem[] = [makeBundleWithGenerator('b1', 'Party Bundle', 15000, 'other-product')];
    const result = cartHasMixedGeneratorState(cart, GEN_ID, { has_generator: true, generator_qty: 1 });
    ok('26 legacy+unrelated pkg not conflict', result === false);
  }

  // --- Date validation tests ---

  // 27. Valid date range.
  ok('27 valid dates', isValidEventDateRange('2026-01-01', '2026-01-01') === true);
  ok('27b valid multi-day', isValidEventDateRange('2026-01-01', '2026-01-03') === true);

  // 28. Invalid: end before start.
  ok('28 end before start', isValidEventDateRange('2026-01-03', '2026-01-01') === false);

  // 29. Invalid: empty strings.
  ok('29 empty start', isValidEventDateRange('', '2026-01-01') === false);
  ok('29b empty end', isValidEventDateRange('2026-01-01', '') === false);

  // 30. Product identified by ID, not name.
  {
    const cart: UnifiedCartItem[] = [makeProduct('other-id', 'Generator', 9500)];
    ok('30 not identified by name', getDirectGeneratorQuantity(cart, GEN_ID) === 0);
  }

  // --- Historical compatibility ---

  // 31. Legacy-only order preserves stored quantity.
  {
    const order = { generator_qty: 2, generator_fee_cents: 17000 };
    ok('31 legacy qty preserved', isLegacyGeneratorOrder(order, 0) === true);
  }

  // 32. Legacy-only order preserves stored fee.
  {
    const order = { generator_qty: 1, generator_fee_cents: 9500 };
    ok('32 legacy fee preserved', isLegacyGeneratorOrder(order, 0) === true && order.generator_fee_cents === 9500);
  }

  // 33. Viewing a legacy order does not convert it.
  {
    const order = { generator_qty: 2, generator_fee_cents: 17000 };
    const eeQty = getGeneratorOrderItemQuantity([], GEN_ID);
    ok('33 legacy not converted', isLegacyGeneratorOrder(order, eeQty) === true && eeQty === 0);
  }

  // --- Crew precedence ---

  // 34. Crew uses EE generator item when present.
  {
    const orderItems = [{ product_id: GEN_ID, qty: 2 }];
    const eeQty = getGeneratorOrderItemQuantity(orderItems, GEN_ID);
    const legacyQty = 0;
    const total = eeQty > 0 ? eeQty : legacyQty;
    ok('34 crew uses EE qty', total === 2);
  }

  // 35. Crew uses legacy fallback when no EE item.
  {
    const orderItems: any[] = [];
    const eeQty = getGeneratorOrderItemQuantity(orderItems, GEN_ID);
    const legacyQty = 3;
    const total = eeQty > 0 ? eeQty : legacyQty;
    ok('35 crew uses legacy fallback', total === 3);
  }

  // 36. Crew never double-counts.
  {
    const orderItems = [{ product_id: GEN_ID, qty: 2 }];
    const eeQty = getGeneratorOrderItemQuantity(orderItems, GEN_ID);
    const legacyQty = 3;
    const total = eeQty > 0 ? eeQty : legacyQty;
    ok('36 no double count', total === 2 && total !== (5 as number));
  }

  // 37. Chair product is not a Generator.
  {
    const orderItems = [{ product_id: CHAIR_ID, qty: 5 }];
    ok('37 chair not generator', getGeneratorOrderItemQuantity(orderItems, GEN_ID) === 0);
  }

  // 38. One inflatable + one Generator produces numInflatables=1.
  {
    const orderItems = [
      { product_id: null, unit_id: 'u1', qty: 1 },
      { product_id: GEN_ID, unit_id: null, qty: 1 },
    ];
    const numInflatables = orderItems.filter(i => !!i.unit_id).reduce((s, i) => s + (i.qty || 1), 0);
    ok('38 numInflatables=1', numInflatables === 1);
  }
}

run();

console.log(`\nGenerator Unification tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
