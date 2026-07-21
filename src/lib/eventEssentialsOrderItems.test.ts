// Stage E4 — Order-item mapping tests (corrected).
// jiti runner, no React/Supabase.

import { mapCartToOrderItems, hasEventEssentialsInCart, hasInflatablesInCart } from './eventEssentialsOrderItems';
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

function run() {
  // 1. Inflatable mapping unchanged.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000, 'dry', 2)];
    const items = mapCartToOrderItems(cart);
    ok('1 inflatable mapping', items.length === 1 && items[0].unit_id === 'u1' && items[0].wet_or_dry === 'dry' && items[0].unit_price_cents === 15000 && items[0].qty === 2 && items[0].product_id === null && items[0].bundle_id === null);
  }

  // 2. Product maps to one Event Essential order item.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Generator', 9500, 'addon')];
    const items = mapCartToOrderItems(cart);
    ok('2 product maps to one item', items.length === 1 && items[0].product_id === 'p1' && items[0].unit_id === null);
  }

  // 3. Product qty and unit price preserved.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Tables', 10000, 'standalone', 3)];
    const items = mapCartToOrderItems(cart);
    ok('3 product qty+price preserved', items[0].qty === 3 && items[0].unit_price_cents === 10000);
  }

  // 4. Product pricing_context preserved.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Gen', 9500, 'addon')];
    const items = mapCartToOrderItems(cart);
    ok('4 product pricing_context preserved', items[0].pricing_context === 'addon');
  }

  // 5. Package maps to one charged order item.
  {
    const cart: UnifiedCartItem[] = [makeBundle('b1', 'Celebration', 15000, 'standalone')];
    const items = mapCartToOrderItems(cart);
    ok('5 package one item', items.length === 1 && items[0].bundle_id === 'b1' && items[0].unit_id === null && items[0].product_id === null);
  }

  // 6. Package is not decomposed into charged product rows.
  {
    const cart: UnifiedCartItem[] = [makeBundle('b1', 'Celebration', 15000, 'standalone', 2)];
    const items = mapCartToOrderItems(cart);
    ok('6 package not decomposed', items.length === 1 && items[0].qty === 2 && items[0].unit_price_cents === 15000);
  }

  // 7. component_snapshot is preserved.
  {
    const cart: UnifiedCartItem[] = [makeBundle('b1', 'Celebration', 15000, 'standalone')];
    const items = mapCartToOrderItems(cart);
    ok('7 component_snapshot preserved', items[0].component_snapshot !== null && items[0].component_snapshot!.components.length === 1);
  }

  // 8. Mixed cart preserves cart order.
  {
    const cart: UnifiedCartItem[] = [
      makeInflatable('u1', 15000),
      makeProduct('p1', 'Gen', 9500, 'addon'),
      makeBundle('b1', 'Celebration', 15000, 'standalone'),
    ];
    const items = mapCartToOrderItems(cart);
    ok('8 mixed cart order preserved', items.length === 3 && items[0].unit_id === 'u1' && items[1].product_id === 'p1' && items[2].bundle_id === 'b1');
  }

  // 9. Duplicate product lines are not silently lost.
  {
    const cart: UnifiedCartItem[] = [
      makeProduct('p1', 'Gen', 9500, 'addon'),
      makeProduct('p1', 'Gen', 9500, 'addon'),
    ];
    const items = mapCartToOrderItems(cart);
    ok('9 duplicate products not lost', items.length === 2 && items[0].product_id === 'p1' && items[1].product_id === 'p1');
  }

  // 10. Duplicate package lines are not silently lost.
  {
    const cart: UnifiedCartItem[] = [
      makeBundle('b1', 'Celebration', 15000, 'standalone'),
      makeBundle('b1', 'Celebration', 15000, 'standalone'),
    ];
    const items = mapCartToOrderItems(cart);
    ok('10 duplicate packages not lost', items.length === 2 && items[0].bundle_id === 'b1' && items[1].bundle_id === 'b1');
  }

  // 11. Existing historical inflatable rows remain readable (no unit_id null for inflatables).
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
    const items = mapCartToOrderItems(cart);
    ok('11 inflatable rows readable', items[0].unit_id !== null && items[0].wet_or_dry !== null);
  }

  // 12. Null unit_id is allowed only for valid Event Essential rows.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Gen', 9500), makeBundle('b1', 'Celebration', 15000)];
    const items = mapCartToOrderItems(cart);
    ok('12 EE rows have null unit_id', items[0].unit_id === null && items[1].unit_id === null && items[0].product_id !== null && items[1].bundle_id !== null);
  }

  // 13. hasEventEssentialsInCart / hasInflatablesInCart helpers.
  {
    ok('13a inflatable-only', hasInflatablesInCart([makeInflatable('u1', 100)]) === true && hasEventEssentialsInCart([makeInflatable('u1', 100)]) === false);
    ok('13b mixed', hasInflatablesInCart([makeInflatable('u1', 100), makeProduct('p1', 'Gen', 95)]) === true && hasEventEssentialsInCart([makeInflatable('u1', 100), makeProduct('p1', 'Gen', 95)]) === true);
    ok('13c EE-only', hasInflatablesInCart([makeProduct('p1', 'Gen', 95)]) === false && hasEventEssentialsInCart([makeProduct('p1', 'Gen', 95)]) === true);
  }

  // 14. Invalid qty=0 rejects the entire cart (returns empty array).
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('p1', 'Bad', 9500, 'addon', 0)];
    const items = mapCartToOrderItems(cart);
    ok('14 qty=0 rejected', items.length === 0);
  }

  // 15. Invalid NaN qty rejects the entire cart.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Bad', 9500, 'addon', NaN)];
    const items = mapCartToOrderItems(cart);
    ok('15 NaN qty rejected', items.length === 0);
  }

  // 16. Product order item has item_name set to product_name.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Generator', 9500, 'addon')];
    const items = mapCartToOrderItems(cart);
    ok('16 product item_name', items[0].item_name === 'Generator');
  }

  // 17. Package order item has item_name set to bundle_name.
  {
    const cart: UnifiedCartItem[] = [makeBundle('b1', 'Celebration Package', 15000, 'standalone')];
    const items = mapCartToOrderItems(cart);
    ok('17 package item_name', items[0].item_name === 'Celebration Package');
  }

  // 18. EE order item has wet_or_dry = null.
  {
    const cart: UnifiedCartItem[] = [makeProduct('p1', 'Generator', 9500, 'addon')];
    const items = mapCartToOrderItems(cart);
    ok('18 EE wet_or_dry null', items[0].wet_or_dry === null);
  }
}

run();

console.log(`\nStage E4 order-item tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
