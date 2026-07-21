// Focused tests for Event Essentials card-level removal helpers.
//
// jiti-based runner (no React, no Supabase, no localStorage). Mirrors the
// existing eventEssentialsCartRepricing.test.ts convention: a lightweight `ok`
// assertion helper and a count summary.
//
// Tests the pure filter helpers (filterOutEventEssentialProduct /
// filterOutEventEssentialBundle) that back useQuoteCart's atomic removal
// methods, plus the E3 repricing interaction that fires after removal.

import {
  filterOutEventEssentialProduct,
  filterOutEventEssentialBundle,
} from './unifiedCart';
import {
  repriceEventEssentialsCart,
} from './eventEssentialsCartRepricing';
import type {
  UnifiedCartItem,
  InflatableCartItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
  BundleComponentSnapshot,
} from '../types';
import type {
  ResolverProductConfig,
  ResolverBundleConfig,
  ResolverCategory,
  ResolverUnitConfig,
} from './eventEssentialsPricingTypes';

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

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

const U_TROPICAL = 'unit_tropical';
const C_TABLES = 'cat_tables';
const C_CHAIRS = 'cat_chairs';
const C_GENERATORS = 'cat_generators';

function makeUnit(id: string, active: boolean): ResolverUnitConfig {
  return { id, active };
}

function makeCategory(id: string): ResolverCategory {
  return { id };
}

function makeProductConfig(
  id: string,
  categoryId: string,
  opts: Partial<ResolverProductConfig> = {},
): ResolverProductConfig {
  return {
    id,
    categoryId,
    standalonePriceCents: 10000,
    addonPriceCents: 6000,
    standaloneEnabled: true,
    addonEnabled: true,
    addonQualifyingThresholdCents: 15000,
    ...opts,
  };
}

function makeBundleConfig(
  id: string,
  opts: Partial<ResolverBundleConfig> = {},
): ResolverBundleConfig {
  return {
    id,
    standalonePriceCents: 30000,
    addonPriceCents: 20000,
    standaloneEnabled: true,
    addonEnabled: true,
    addonQualifyingThresholdCents: 15000,
    inflatableEligibilityMode: 'none',
    excludedCategoryIds: [],
    eligibleUnitIds: [],
    inflatableComponents: [],
    containedProductCategoryIds: [],
    ...opts,
  };
}

function makeInflatable(
  unitId: string,
  price: number,
  wetOrDry: 'dry' | 'water' = 'dry',
  qty = 1,
): InflatableCartItem {
  return {
    unit_id: unitId,
    unit_name: `Inflatable ${unitId}`,
    wet_or_dry: wetOrDry,
    unit_price_cents: price,
    price_dry_cents: price,
    price_water_cents: price + 5000,
    qty,
  };
}

function makeProductCart(
  productId: string,
  name: string,
  price: number,
  context: 'standalone' | 'addon',
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

function makeBundleCart(
  bundleId: string,
  name: string,
  price: number,
  context: 'standalone' | 'addon',
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

function buildRepriceInput(
  cart: UnifiedCartItem[],
  opts: {
    productConfigs?: Record<string, ResolverProductConfig>;
    bundleConfigs?: Record<string, ResolverBundleConfig>;
    categories?: Record<string, ResolverCategory>;
    units?: Record<string, ResolverUnitConfig>;
  } = {},
) {
  return {
    cart,
    productConfigs: opts.productConfigs ?? {},
    bundleConfigs: opts.bundleConfigs ?? {},
    categories: opts.categories ?? {
      [C_TABLES]: makeCategory(C_TABLES),
      [C_CHAIRS]: makeCategory(C_CHAIRS),
      [C_GENERATORS]: makeCategory(C_GENERATORS),
    },
    units: opts.units ?? { [U_TROPICAL]: makeUnit(U_TROPICAL, true) },
  };
}

function run() {
  // 1. Remove product identity with one matching line.
  {
    const p1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [p1];
    const next = filterOutEventEssentialProduct(cart, 'p1');
    ok('1 single product removed', next.length === 0);
  }

  // 2. Remove product identity with standalone and add-on lines for same product.
  {
    const standalone = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const addon = makeProductCart('p1', 'Tables', 6000, 'addon');
    const cart: UnifiedCartItem[] = [standalone, addon];
    const next = filterOutEventEssentialProduct(cart, 'p1');
    ok('2 both product lines removed', next.length === 0);
  }

  // 3. Both product lines removed in one result (explicit count).
  {
    const standalone = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const addon = makeProductCart('p1', 'Tables', 6000, 'addon');
    const cart: UnifiedCartItem[] = [standalone, addon];
    const next = filterOutEventEssentialProduct(cart, 'p1');
    ok('3 two lines removed in one pass', next.length === 0 && cart.length === 2);
  }

  // 4. Another product remains unchanged.
  {
    const p1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const p2 = makeProductCart('p2', 'Chairs', 8000, 'standalone');
    const cart: UnifiedCartItem[] = [p1, p2];
    const next = filterOutEventEssentialProduct(cart, 'p1');
    ok('4 other product remains', next.length === 1 && next[0] === p2);
  }

  // 5. Inflatable before, between, and after matching lines remains the exact same object.
  {
    const infBefore = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const infBetween = makeInflatable('unit_slide', 15000);
    const p1Addon = makeProductCart('p1', 'Tables', 6000, 'addon');
    const infAfter = makeInflatable('unit_bounce', 12000);
    const cart: UnifiedCartItem[] = [infBefore, p1, infBetween, p1Addon, infAfter];
    const next = filterOutEventEssentialProduct(cart, 'p1');
    ok(
      '5 inflatables preserved by identity and order',
      next.length === 3 &&
        next[0] === infBefore &&
        next[1] === infBetween &&
        next[2] === infAfter,
    );
  }

  // 6. Remove package identity with multiple duplicate package lines.
  {
    const b1a = makeBundleCart('b1', 'Celebration Seating', 15000, 'standalone');
    const b1b = makeBundleCart('b1', 'Celebration Seating', 15000, 'standalone');
    const cart: UnifiedCartItem[] = [b1a, b1b];
    const next = filterOutEventEssentialBundle(cart, 'b1');
    ok('6 duplicate package lines removed', next.length === 0);
  }

  // 7. All matching package lines are removed.
  {
    const b1a = makeBundleCart('b1', 'Celebration Seating', 15000, 'standalone');
    const b1b = makeBundleCart('b1', 'Celebration Seating', 15000, 'standalone');
    const b1c = makeBundleCart('b1', 'Celebration Seating', 15000, 'standalone');
    const cart: UnifiedCartItem[] = [b1a, b1b, b1c];
    const next = filterOutEventEssentialBundle(cart, 'b1');
    ok('7 three package lines removed', next.length === 0 && cart.length === 3);
  }

  // 8. Another package remains unchanged.
  {
    const b1 = makeBundleCart('b1', 'Celebration Seating', 15000, 'standalone');
    const b2 = makeBundleCart('b2', 'Party Package', 20000, 'standalone');
    const cart: UnifiedCartItem[] = [b1, b2];
    const next = filterOutEventEssentialBundle(cart, 'b1');
    ok('8 other package remains', next.length === 1 && next[0] === b2);
  }

  // 9. Cart order of all remaining lines is preserved.
  {
    const inf1 = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const b1 = makeBundleCart('b1', 'Celebration Seating', 15000, 'standalone');
    const p2 = makeProductCart('p2', 'Chairs', 8000, 'standalone');
    const b2 = makeBundleCart('b2', 'Party Package', 20000, 'standalone');
    const cart: UnifiedCartItem[] = [inf1, p1, b1, p2, b2];
    const afterProduct = filterOutEventEssentialProduct(cart, 'p1');
    const afterBundle = filterOutEventEssentialBundle(afterProduct, 'b1');
    ok(
      '9 order preserved after removals',
      afterBundle.length === 3 &&
        afterBundle[0] === inf1 &&
        afterBundle[1] === p2 &&
        afterBundle[2] === b2,
    );
  }

  // 10. No match returns unchanged cart (same length, no write needed).
  {
    const p1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [p1];
    const next = filterOutEventEssentialProduct(cart, 'p_nonexistent');
    ok('10 no match returns unchanged', next.length === 1 && next[0] === p1);
  }

  // 11. Removing Celebration Seating causes Generator to reprice from add-on to standalone through E3.
  {
    const genConfig = makeProductConfig('p_gen', C_GENERATORS, {
      standalonePriceCents: 10000,
      addonPriceCents: 9500,
      addonQualifyingThresholdCents: 15000,
    });
    const celebrationConfig = makeBundleConfig('b_celebration', {
      standalonePriceCents: 15000,
      containedProductCategoryIds: [C_TABLES, C_CHAIRS],
    });
    const tablesConfig = makeProductConfig('p_tables', C_TABLES);
    const chairsConfig = makeProductConfig('p_chairs', C_CHAIRS);

    const gen = makeProductCart('p_gen', 'Generator', 9500, 'addon');
    const celebration = makeBundleCart('b_celebration', 'Celebration Seating', 15000, 'standalone');
    const cart: UnifiedCartItem[] = [celebration, gen];

    // Remove Celebration Seating.
    const afterRemoval = filterOutEventEssentialBundle(cart, 'b_celebration');
    ok('11a celebration removed', afterRemoval.length === 1 && afterRemoval[0] === gen);

    // Reprice the remaining cart.
    const result = repriceEventEssentialsCart(
      buildRepriceInput(afterRemoval, {
        productConfigs: { p_gen: genConfig, p_tables: tablesConfig, p_chairs: chairsConfig },
        bundleConfigs: { b_celebration: celebrationConfig },
      }),
    );
    const outGen = result.cart[0] as EventEssentialProductCartItem;
    ok(
      '11b generator repriced to standalone',
      result.changed === true &&
        outGen.pricing_context === 'standalone' &&
        outGen.unit_price_cents === 10000,
    );
  }

  // 12. Removing a qualifying inflatable through the existing Quote flow still behaves unchanged.
  // (Pure filter does not touch inflatables; E3 preserves inflatable identity.)
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductCart('p1', 'Tables', 6000, 'addon');
    const cart: UnifiedCartItem[] = [inf, p1];
    // Filter only removes EE products/bundles — inflatables are never matched.
    const next = filterOutEventEssentialProduct(cart, 'p1');
    ok('12 inflatable remains after EE removal', next.length === 1 && next[0] === inf);
  }

  // 13. Removing an EE item never changes inflatable dry/water mode or price.
  {
    const inf = makeInflatable(U_TROPICAL, 20000, 'water', 2);
    const p1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, p1];
    const next = filterOutEventEssentialProduct(cart, 'p1');
    const outInf = next[0] as InflatableCartItem;
    ok(
      '13 inflatable fields unchanged after EE removal',
      outInf === inf &&
        outInf.wet_or_dry === 'water' &&
        outInf.unit_price_cents === 20000 &&
        outInf.price_dry_cents === 20000 &&
        outInf.price_water_cents === 25000 &&
        outInf.qty === 2,
    );
  }
}

run();

console.log(`\nEvent Essentials removal tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
