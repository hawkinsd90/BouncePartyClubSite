// Stage E4 — Generator conflict guard tests.
// jiti runner, no React/Supabase (pure logic tests only).

import { cartContainsGeneratorProduct, hasLegacyGeneratorSelected } from './generatorConflictGuard';
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

function makeProduct(productId: string, name: string, price: number, context: 'standalone' | 'addon' = 'standalone'): EventEssentialProductCartItem {
  return {
    item_type: 'event_essential_product',
    product_id: productId,
    product_name: name,
    unit_price_cents: price,
    qty: 1,
    pricing_context: context,
  };
}

function makeBundleWithGenerator(bundleId: string, name: string, price: number, generatorProductId: string): EventEssentialBundleCartItem {
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
    qty: 1,
    pricing_context: 'standalone',
    component_snapshot: snapshot,
  };
}

function run() {
  const generatorIds = new Set(['gen-uuid-1']);

  // 1. Legacy generator only — allowed (no conflict).
  {
    ok('1 legacy only allowed', hasLegacyGeneratorSelected({ has_generator: true }) === true);
    ok('1b legacy only no EE', cartContainsGeneratorProduct([makeInflatable('u1', 15000)], generatorIds) === false);
  }

  // 2. EE Generator only — allowed (no conflict).
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('gen-uuid-1', 'Generator', 9500, 'addon')];
    ok('2 EE generator only allowed', cartContainsGeneratorProduct(cart, generatorIds) === true);
    ok('2b no legacy', hasLegacyGeneratorSelected({ has_generator: false }) === false);
  }

  // 3. Both selected — blocked (conflict).
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('gen-uuid-1', 'Generator', 9500, 'addon')];
    const hasLegacy = hasLegacyGeneratorSelected({ has_generator: true, generator_qty: 1 });
    const hasEE = cartContainsGeneratorProduct(cart, generatorIds);
    ok('3 both selected blocked', hasLegacy && hasEE);
  }

  // 4. Unrelated EE product + legacy generator — allowed.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('tables-uuid', 'Tables', 5000, 'addon')];
    const hasEE = cartContainsGeneratorProduct(cart, generatorIds);
    ok('4 unrelated EE + legacy allowed', !hasEE);
  }

  // 5. No product-name matching — only stable product IDs.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('other-uuid', 'Generator', 9500, 'addon')];
    const hasEE = cartContainsGeneratorProduct(cart, generatorIds);
    ok('5 no name matching', !hasEE);
  }

  // 6. Generator inside a package — detected.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeBundleWithGenerator('b1', 'Power Bundle', 15000, 'gen-uuid-1')];
    const hasEE = cartContainsGeneratorProduct(cart, generatorIds);
    ok('6 generator in package detected', hasEE);
  }

  // 7. Empty generator IDs set — no conflict.
  {
    const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeProduct('gen-uuid-1', 'Generator', 9500, 'addon')];
    ok('7 empty gen IDs no conflict', cartContainsGeneratorProduct(cart, new Set()) === false);
  }

  // 8. generator_qty > 0 without has_generator — detected as legacy.
  {
    ok('8 generator_qty detected', hasLegacyGeneratorSelected({ has_generator: false, generator_qty: 2 }) === true);
  }
}

run();

console.log(`\nStage E4 generator conflict tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
