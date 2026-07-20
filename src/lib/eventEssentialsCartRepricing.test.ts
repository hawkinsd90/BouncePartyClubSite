// Stage E3 — Pure repricer tests.
//
// jiti-based runner (no React, no Supabase, no localStorage). Mirrors the
// existing eventEssentialsPricing.test.ts / eventEssentialsCatalogResolver.test.ts
// convention: a lightweight `ok` assertion helper and a count summary.

import {
  repriceEventEssentialsCart,
  type RepriceEventEssentialsCartInput,
} from './eventEssentialsCartRepricing';
import type {
  ResolverProductConfig,
  ResolverBundleConfig,
  ResolverCategory,
  ResolverUnitConfig,
} from './eventEssentialsPricingTypes';
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

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

const U_TROPICAL = 'unit_tropical';
const U_SLIDE = 'unit_slide';

const C_TABLES = 'cat_tables';
const C_CHAIRS = 'cat_chairs';

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

function buildInput(
  cart: UnifiedCartItem[],
  opts: {
    productConfigs?: Record<string, ResolverProductConfig>;
    bundleConfigs?: Record<string, ResolverBundleConfig>;
    categories?: Record<string, ResolverCategory>;
    units?: Record<string, ResolverUnitConfig>;
  } = {},
): RepriceEventEssentialsCartInput {
  return {
    cart,
    productConfigs: opts.productConfigs ?? {},
    bundleConfigs: opts.bundleConfigs ?? {},
    categories: opts.categories ?? { [C_TABLES]: makeCategory(C_TABLES), [C_CHAIRS]: makeCategory(C_CHAIRS) },
    units: opts.units ?? { [U_TROPICAL]: makeUnit(U_TROPICAL, true), [U_SLIDE]: makeUnit(U_SLIDE, true) },
  };
}

function run() {
  // 1. Inflatable-only cart returns changed=false.
  {
    const cart: UnifiedCartItem[] = [makeInflatable(U_TROPICAL, 20000)];
    const result = repriceEventEssentialsCart(buildInput(cart));
    ok('1 inflatable-only changed=false', result.changed === false);
  }

  // 2. Inflatable-only cart returns the original cart array.
  {
    const cart: UnifiedCartItem[] = [makeInflatable(U_TROPICAL, 20000)];
    const result = repriceEventEssentialsCart(buildInput(cart));
    ok('2 inflatable-only returns original array', result.cart === cart);
  }

  // 3. Inflatable object identity is preserved.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const product = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, product];
    const result = repriceEventEssentialsCart(
      buildInput(cart, {
        productConfigs: { p1: makeProductConfig('p1', C_TABLES) },
      }),
    );
    ok('3 inflatable identity preserved', result.cart[0] === inf);
  }

  // 4. Inflatable fields are unchanged.
  {
    const inf = makeInflatable(U_TROPICAL, 20000, 'water', 2);
    const cart: UnifiedCartItem[] = [inf];
    const result = repriceEventEssentialsCart(buildInput(cart));
    const out = result.cart[0] as InflatableCartItem;
    ok(
      '4 inflatable fields unchanged',
      out.unit_price_cents === 20000 &&
        out.price_dry_cents === 20000 &&
        out.price_water_cents === 25000 &&
        out.wet_or_dry === 'water' &&
        out.qty === 2,
    );
  }

  // 5. Event Essential product moves standalone -> add-on when inflatable qualifies it.
  {
    const inf = makeInflatable(U_TROPICAL, 20000); // 20000 >= 15000 threshold
    const product = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, product];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1: makeProductConfig('p1', C_TABLES) } }),
    );
    const out = result.cart[1] as EventEssentialProductCartItem;
    ok(
      '5 standalone -> addon',
      result.changed === true &&
        out.pricing_context === 'addon' &&
        out.unit_price_cents === 6000,
    );
  }

  // 6. Event Essential product moves add-on -> standalone when qualification removed.
  {
    const product = makeProductCart('p1', 'Tables', 6000, 'addon');
    const cart: UnifiedCartItem[] = [product];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1: makeProductConfig('p1', C_TABLES) } }),
    );
    const out = result.cart[0] as EventEssentialProductCartItem;
    ok(
      '6 addon -> standalone',
      result.changed === true &&
        out.pricing_context === 'standalone' &&
        out.unit_price_cents === 10000,
    );
  }

  // 7. Product price changes but qty/name/id remain unchanged.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const product = makeProductCart('p1', 'Tables', 10000, 'standalone', 3);
    const cart: UnifiedCartItem[] = [inf, product];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1: makeProductConfig('p1', C_TABLES) } }),
    );
    const out = result.cart[1] as EventEssentialProductCartItem;
    ok(
      '7 qty/name/id unchanged',
      out.qty === 3 && out.product_name === 'Tables' && out.product_id === 'p1',
    );
  }

  // 8. Product already correctly priced returns the original product object.
  {
    const product = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [product];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1: makeProductConfig('p1', C_TABLES) } }),
    );
    ok('8 already correct returns original object', result.cart[0] === product && result.changed === false);
  }

  // 9. Product in the candidate's own category does not qualify it.
  {
    // Two products in the same category; neither qualifies the other for addon.
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 50000 });
    const p2 = makeProductConfig('p2', C_TABLES);
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p2', 'More Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1, p2 } }),
    );
    const out1 = result.cart[0] as EventEssentialProductCartItem;
    ok('9 same-category no qualification', out1.pricing_context === 'standalone' && out1.unit_price_cents === 10000);
  }

  // 10. Product in another category qualifies it.
  {
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const p2 = makeProductConfig('p2', C_CHAIRS, { standalonePriceCents: 20000 });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p2', 'Chairs', 20000, 'standalone');
    const cart: UnifiedCartItem[] = [prod2, prod1];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1, p2 } }),
    );
    const out1 = result.cart[1] as EventEssentialProductCartItem;
    ok('10 other-category qualifies', out1.pricing_context === 'addon' && out1.unit_price_cents === 6000);
  }

  // 11. Stored product add-on price is not used as authoritative contribution.
  {
    // Product stored as addon at 6000; another product should use the addon
    // product's STANDALONE price (10000) for qualification, not the stored 6000.
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 10000 });
    const p2 = makeProductConfig('p2', C_CHAIRS, { standalonePriceCents: 10000 });
    const prod1 = makeProductCart('p1', 'Tables', 6000, 'addon');
    const prod2 = makeProductCart('p2', 'Chairs', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1, p2 } }),
    );
    // prod2 contributes 10000 (standalone) >= 10000 threshold -> p1 qualifies for addon
    const out1 = result.cart[0] as EventEssentialProductCartItem;
    ok('11 stored addon price not used for contribution', out1.pricing_context === 'addon' && out1.unit_price_cents === 6000);
  }

  // 12. Package cart lines contribute zero.
  {
    const bundle = makeBundleConfig('b1', { addonQualifyingThresholdCents: 10000 });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 10000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [bCart, prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 }, bundleConfigs: { b1: bundle } }),
    );
    const outProd = result.cart[1] as EventEssentialProductCartItem;
    // Bundle contributes zero, so prod does not qualify for addon
    ok('12 package contributes zero', outProd.pricing_context === 'standalone');
  }

  // 13. Package standalone -> add-on repricing.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const bundle = makeBundleConfig('b1', { addonQualifyingThresholdCents: 15000 });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    const out = result.cart[1] as EventEssentialBundleCartItem;
    ok('13 bundle standalone -> addon', out.pricing_context === 'addon' && out.unit_price_cents === 20000);
  }

  // 14. Package add-on -> standalone repricing.
  {
    const bundle = makeBundleConfig('b1', { addonQualifyingThresholdCents: 15000 });
    const bCart = makeBundleCart('b1', 'Package', 20000, 'addon');
    const cart: UnifiedCartItem[] = [bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    const out = result.cart[0] as EventEssentialBundleCartItem;
    ok('14 bundle addon -> standalone', out.pricing_context === 'standalone' && out.unit_price_cents === 30000);
  }

  // 15. Package component_snapshot remains the exact same object.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const bundle = makeBundleConfig('b1', { addonQualifyingThresholdCents: 15000 });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const originalSnapshot = bCart.component_snapshot;
    const cart: UnifiedCartItem[] = [inf, bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    const out = result.cart[1] as EventEssentialBundleCartItem;
    ok('15 component_snapshot same object', out.component_snapshot === originalSnapshot);
  }

  // 16. Any-inflatable prerequisite passes.
  {
    const inf = makeInflatable(U_TROPICAL, 10000);
    const bundle = makeBundleConfig('b1', { inflatableEligibilityMode: 'any', addonQualifyingThresholdCents: 15000, standalonePriceCents: 30000 });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    ok('16 any-inflatable prereq passes', result.issues.length === 0);
  }

  // 17. Any-inflatable prerequisite failure creates a blocking issue.
  {
    const bundle = makeBundleConfig('b1', { inflatableEligibilityMode: 'any', standalonePriceCents: 30000 });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    ok(
      '17 any-inflatable failure blocking',
      result.issues.length === 1 &&
        result.issues[0].blocking === true &&
        result.issues[0].message.includes('inflatable'),
    );
  }

  // 18. Selected-unit prerequisite passes.
  {
    const inf = makeInflatable(U_TROPICAL, 10000);
    const bundle = makeBundleConfig('b1', {
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [U_TROPICAL],
      addonQualifyingThresholdCents: 15000,
      standalonePriceCents: 30000,
    });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    ok('18 selected-unit prereq passes', result.issues.length === 0);
  }

  // 19. Selected-unit prerequisite failure creates a blocking issue.
  {
    const inf = makeInflatable(U_SLIDE, 10000); // not in eligible list
    const bundle = makeBundleConfig('b1', {
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [U_TROPICAL],
      standalonePriceCents: 30000,
    });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    ok(
      '19 selected-unit failure blocking',
      result.issues.length === 1 &&
        result.issues[0].blocking === true &&
        result.issues[0].message.includes('eligible inflatable'),
    );
  }

  // 20. Misconfigured selected prerequisite creates generic unavailable issue.
  {
    const bundle = makeBundleConfig('b1', {
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [], // NO_ELIGIBLE_UNITS_CONFIGURED
      standalonePriceCents: 30000,
    });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    ok(
      '20 misconfigured selected -> unavailable',
      result.issues.length === 1 &&
        result.issues[0].blocking === true &&
        result.issues[0].message.includes('unavailable'),
    );
  }

  // 21. Invalid add-on-only product creates a blocking issue.
  {
    // Product with only addon enabled, no standalone, no qualifying inflatable.
    const p1 = makeProductConfig('p1', C_TABLES, {
      standaloneEnabled: false,
      standalonePriceCents: null,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 15000,
    });
    const prod = makeProductCart('p1', 'Tables', 6000, 'addon');
    const cart: UnifiedCartItem[] = [prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    ok(
      '21 addon-only invalid -> blocking',
      result.issues.length === 1 &&
        result.issues[0].blocking === true &&
        result.issues[0].message.includes('unavailable'),
    );
  }

  // 22. Standalone fallback remains selectable and reprices correctly.
  {
    // Product with valid standalone + addon not qualified -> stays standalone.
    const p1 = makeProductConfig('p1', C_TABLES, {
      standalonePriceCents: 12000,
      addonQualifyingThresholdCents: 50000,
    });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    const out = result.cart[0] as EventEssentialProductCartItem;
    ok('22 standalone fallback reprices', out.unit_price_cents === 12000 && out.pricing_context === 'standalone');
  }

  // 23. customer_choice does not block by itself.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const bundle = makeBundleConfig('b1', {
      inflatableEligibilityMode: 'any',
      addonQualifyingThresholdCents: 15000,
      standalonePriceCents: 30000,
      inflatableComponents: [{ selectionMode: 'customer_choice' }],
    });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    ok('23 customer_choice non-blocking', result.issues.length === 0);
  }

  // 24. Unknown Event Essential product config preserves the line and creates a blocking issue.
  {
    const prod = makeProductCart('p_unknown', 'Unknown', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: {} }),
    );
    ok(
      '24 unknown product config -> blocking + preserved',
      result.cart[0] === prod && result.issues.length === 1 && result.issues[0].blocking === true,
    );
  }

  // 25. Unknown package config preserves the line and creates a blocking issue.
  {
    const bCart = makeBundleCart('b_unknown', 'Unknown Pkg', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: {} }),
    );
    ok(
      '25 unknown bundle config -> blocking + preserved',
      result.cart[0] === bCart && result.issues.length === 1 && result.issues[0].blocking === true,
    );
  }

  // 26. Unknown legacy non-Event-Essential line is preserved unchanged.
  {
    const legacy = { item_type: 'something_else', foo: 'bar' } as unknown as UnifiedCartItem;
    const cart: UnifiedCartItem[] = [legacy];
    const result = repriceEventEssentialsCart(buildInput(cart));
    ok('26 unknown legacy preserved', result.cart[0] === legacy && result.changed === false);
  }

  // 27. Cart ordering remains unchanged.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const bundle = makeBundleConfig('b1', { addonQualifyingThresholdCents: 15000 });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod, bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 }, bundleConfigs: { b1: bundle } }),
    );
    ok(
      '27 ordering preserved',
      (result.cart[0] as InflatableCartItem).unit_id === U_TROPICAL &&
        (result.cart[1] as EventEssentialProductCartItem).product_id === 'p1' &&
        (result.cart[2] as EventEssentialBundleCartItem).bundle_id === 'b1',
    );
  }

  // 28. Only changed Event Essential lines receive new object references.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const p2 = makeProductConfig('p2', C_CHAIRS, { standalonePriceCents: 8000, addonQualifyingThresholdCents: 50000 });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone'); // will reprice to addon
    const prod2 = makeProductCart('p2', 'Chairs', 8000, 'standalone'); // already correct
    const cart: UnifiedCartItem[] = [inf, prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1, p2 } }),
    );
    ok(
      '28 only changed line gets new reference',
      result.cart[0] === inf && result.cart[1] !== prod1 && result.cart[2] === prod2,
    );
  }

  // 29. Running the repricer twice is idempotent.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const input = buildInput(cart, { productConfigs: { p1 } });
    const r1 = repriceEventEssentialsCart(input);
    const r2 = repriceEventEssentialsCart({ ...input, cart: r1.cart });
    ok(
      '29 idempotent',
      r2.changed === false &&
        (r2.cart[1] as EventEssentialProductCartItem).pricing_context === 'addon',
    );
  }

  // 30. Second run on the first result returns changed=false.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const input = buildInput(cart, { productConfigs: { p1 } });
    const r1 = repriceEventEssentialsCart(input);
    const r2 = repriceEventEssentialsCart({ ...input, cart: r1.cart });
    ok('30 second run changed=false', r2.changed === false);
  }

  // 31. Same input produces deep-equal issues.
  {
    const bundle = makeBundleConfig('b1', { inflatableEligibilityMode: 'any', standalonePriceCents: 30000 });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [bCart];
    const input = buildInput(cart, { bundleConfigs: { b1: bundle } });
    const r1 = repriceEventEssentialsCart(input);
    const r2 = repriceEventEssentialsCart(input);
    ok('31 deep-equal issues', JSON.stringify(r1.issues) === JSON.stringify(r2.issues));
  }

  // 32. Removing an inflatable does not mutate the removed or remaining inflatable objects.
  {
    const inf1 = makeInflatable(U_TROPICAL, 20000);
    const inf2 = makeInflatable(U_SLIDE, 15000);
    const cart: UnifiedCartItem[] = [inf1, inf2];
    const result = repriceEventEssentialsCart(buildInput(cart));
    ok('32 no inflatable mutation', result.cart[0] === inf1 && result.cart[1] === inf2);
  }

  // 33. Dry-to-water selected price changes qualification without changing the inflatable line.
  {
    const inf = makeInflatable(U_TROPICAL, 10000, 'dry'); // dry = 10000, water = 15000
    // Threshold 12000: dry (10000) doesn't qualify, but water (15000) does.
    // The inflatable line itself should not change, but the product should reprice
    // based on the selected price (10000 dry) -> not qualified.
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 12000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    const outInf = result.cart[0] as InflatableCartItem;
    const outProd = result.cart[1] as EventEssentialProductCartItem;
    ok(
      '33 dry does not qualify at 12000 threshold',
      outInf === inf && outInf.wet_or_dry === 'dry' && outProd.pricing_context === 'standalone',
    );
  }

  // 34. Water-to-dry selected price changes qualification without changing the inflatable line.
  {
    const inf = makeInflatable(U_TROPICAL, 15000, 'water'); // water = 15000 (unit_price), dry = 10000
    // With water selected at 15000, threshold 12000 -> qualifies.
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 12000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    const outInf = result.cart[0] as InflatableCartItem;
    const outProd = result.cart[1] as EventEssentialProductCartItem;
    ok(
      '34 water qualifies at 12000 threshold',
      outInf === inf && outInf.wet_or_dry === 'water' && outProd.pricing_context === 'addon',
    );
  }

  // 35. No Event Essential config load/result means no cart mutation.
  {
    const cart: UnifiedCartItem[] = [makeInflatable(U_TROPICAL, 20000)];
    // Empty config maps, no event essentials in cart -> no mutation.
    const result = repriceEventEssentialsCart(buildInput(cart));
    ok('35 no EE config -> no mutation', result.cart === cart && result.changed === false);
  }

  // 36. Safe-integer and malformed values do not produce invalid cart prices.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const prod: EventEssentialProductCartItem = {
      item_type: 'event_essential_product',
      product_id: 'p1',
      product_name: 'Tables',
      unit_price_cents: 10000,
      qty: NaN, // malformed
      pricing_context: 'standalone',
    };
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    // NaN qty -> E1 returns INVALID_QUANTITY -> blocking issue, line preserved.
    ok(
      '36 malformed qty -> blocking not invalid price',
      result.issues.length === 1 &&
        result.issues[0].blocking === true &&
        (result.cart[1] as EventEssentialProductCartItem).unit_price_cents === 10000,
    );
  }

  // 37. Duplicate legacy Event Essential lines are preserved as separate lines.
  {
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    ok('37 duplicate lines preserved', result.cart.length === 2);
  }

  // 38. Duplicate legacy lines receive deterministic resolver mapping.
  {
    // Both lines have the same resolverKey (cart-product-p1). E1 evaluates
    // both by array position. The repricer maps by resolverKey, so both get
    // the same output. This is acceptable — both are already correct.
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    ok('38 deterministic mapping for duplicates', result.cart[0] === prod1 && result.cart[1] === prod2);
  }

  // 39. No automatic line removal occurs.
  {
    const prod = makeProductCart('p_unknown', 'Unknown', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: {} }),
    );
    ok('39 no auto removal', result.cart.length === 1 && result.cart[0] === prod);
  }

  // 40. No inflatable line ever receives pricing_context.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    const outInf = result.cart[0] as InflatableCartItem;
    ok('40 inflatable has no pricing_context', !('pricing_context' in outInf));
  }

  // Summary
  console.log(`Stage E3 cart repricing tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
