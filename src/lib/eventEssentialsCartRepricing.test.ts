// Stage E3 — Pure repricer tests.
//
// jiti-based runner (no React, no Supabase, no localStorage). Mirrors the
// existing eventEssentialsPricing.test.ts / eventEssentialsCatalogResolver.test.ts
// convention: a lightweight `ok` assertion helper and a count summary.

import {
  repriceEventEssentialsCart,
  hasBlockingIssues,
  canApplyRepricedCart,
  productLineKey,
  bundleLineKey,
  inflatableLineKey,
  deriveEventEssentialsValidationState,
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
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 10000 });
    const p2 = makeProductConfig('p2', C_CHAIRS, { standalonePriceCents: 10000 });
    const prod1 = makeProductCart('p1', 'Tables', 6000, 'addon');
    const prod2 = makeProductCart('p2', 'Chairs', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1, p2 } }),
    );
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
      eligibleUnitIds: [],
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
      qty: NaN,
      pricing_context: 'standalone',
    };
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    ok(
      '36 malformed qty -> blocking not invalid price',
      result.issues.length === 1 &&
        result.issues[0].blocking === true &&
        (result.cart[1] as EventEssentialProductCartItem).unit_price_cents === 10000,
    );
  }

  // 37. Duplicate product lines receive DIFFERENT resolver keys (index-based).
  {
    ok(
      '37 dup products different keys',
      productLineKey(0, 'p1') !== productLineKey(1, 'p1'),
    );
  }

  // 38. Duplicate package lines receive DIFFERENT resolver keys (index-based).
  {
    ok(
      '38 dup bundles different keys',
      bundleLineKey(0, 'b1') !== bundleLineKey(1, 'b1'),
    );
  }

  // 39. Duplicate inflatable lines receive DIFFERENT resolver keys (index-based).
  {
    ok(
      '39 dup inflatables different keys',
      inflatableLineKey(0, U_TROPICAL) !== inflatableLineKey(1, U_TROPICAL),
    );
  }

  // 40. Duplicate product lines with DIFFERENT quantities map to their exact outputs.
  {
    // Two DIFFERENT products in different categories so they can qualify each other.
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonPriceCents: 6000, addonQualifyingThresholdCents: 10000 });
    const p2 = makeProductConfig('p2', C_CHAIRS, { standalonePriceCents: 10000, addonPriceCents: 6000, addonQualifyingThresholdCents: 10000 });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone', 1); // qty 1
    const prod2 = makeProductCart('p2', 'Chairs', 10000, 'standalone', 3); // qty 3
    // prod1 sees prod2's 30000 >= 10000 -> addon. prod2 sees prod1's 10000 >= 10000 -> addon.
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1, p2 } }),
    );
    const out0 = result.cart[0] as EventEssentialProductCartItem;
    const out1 = result.cart[1] as EventEssentialProductCartItem;
    ok(
      '40 dup products different qty map independently',
      out0.qty === 1 && out1.qty === 3 &&
        out0.pricing_context === 'addon' && out1.pricing_context === 'addon' &&
        out0.unit_price_cents === 6000 && out1.unit_price_cents === 6000,
    );
  }

  // 41. Duplicate product lines with different stored pricing contexts remain separate and are each corrected independently.
  {
    // No qualifying inflatable: addon-stored line must return to standalone.
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonPriceCents: 6000, addonQualifyingThresholdCents: 15000 });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone'); // already correct
    const prod2 = makeProductCart('p1', 'Tables', 6000, 'addon'); // stale, must correct to standalone
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    const out0 = result.cart[0] as EventEssentialProductCartItem;
    const out1 = result.cart[1] as EventEssentialProductCartItem;
    ok(
      '41 dup products different context corrected independently',
      out0.pricing_context === 'standalone' && out0.unit_price_cents === 10000 &&
        out1.pricing_context === 'standalone' && out1.unit_price_cents === 10000 &&
        result.cart[0] === prod1 && result.cart[1] !== prod2,
    );
  }

  // 42. One invalid duplicate line creates an issue for its EXACT cart index.
  {
    // prod1 valid (config exists), prod2 invalid (config missing for p2).
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p2', 'Chairs', 10000, 'standalone'); // p2 config missing
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    const issueFor1 = result.issues.find((i) => i.cartIndex === 0);
    const issueFor2 = result.issues.find((i) => i.cartIndex === 1);
    ok(
      '42 invalid duplicate -> issue for exact index',
      !issueFor1 && !!issueFor2 && issueFor2.blocking === true && issueFor2.itemId === 'p2',
    );
  }

  // 43. The other valid duplicate line does NOT inherit that issue.
  {
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p2', 'Chairs', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    ok(
      '43 valid duplicate no inherited issue',
      result.issues.length === 1 && result.issues[0].cartIndex === 1,
    );
  }

  // 44. Running the repricer twice remains idempotent with duplicates.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod1, prod2];
    const input = buildInput(cart, { productConfigs: { p1 } });
    const r1 = repriceEventEssentialsCart(input);
    const r2 = repriceEventEssentialsCart({ ...input, cart: r1.cart });
    ok(
      '44 idempotent with duplicates',
      r2.changed === false &&
        (r2.cart[1] as EventEssentialProductCartItem).pricing_context === 'addon' &&
        (r2.cart[2] as EventEssentialProductCartItem).pricing_context === 'addon',
    );
  }

  // 45. No duplicates are merged or removed.
  {
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod3 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, prod2, prod3];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    ok('45 no merge/removal of duplicates', result.cart.length === 3);
  }

  // 46. Cart order remains unchanged with duplicates.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000, addonEnabled: false, addonPriceCents: null, standalonePriceCents: 10000 });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, inf, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    ok(
      '46 order unchanged with duplicates',
      (result.cart[0] as EventEssentialProductCartItem).product_id === 'p1' &&
        (result.cart[1] as InflatableCartItem).unit_id === U_TROPICAL &&
        (result.cart[2] as EventEssentialProductCartItem).product_id === 'p1',
    );
  }

  // 47. Stale-write guard: same reference returns true.
  {
    const cart: UnifiedCartItem[] = [makeInflatable(U_TROPICAL, 20000)];
    ok('47 canApply same ref -> true', canApplyRepricedCart(cart, cart) === true);
  }

  // 48. Stale-write guard: different reference returns false.
  {
    const cart: UnifiedCartItem[] = [makeInflatable(U_TROPICAL, 20000)];
    const newerCart: UnifiedCartItem[] = [...cart];
    ok('48 canApply different ref -> false', canApplyRepricedCart(newerCart, cart) === false);
  }

  // 49. Stale-write guard: a newer cart (dry -> water) is not overwritten by an older repricing result.
  {
    // Simulate: repricer reads dry cart, then user switches to water before
    // the repriced result is applied. The compare-and-apply must reject.
    const dryCart: UnifiedCartItem[] = [makeInflatable(U_TROPICAL, 10000, 'dry')];
    const waterCart: UnifiedCartItem[] = [
      { ...makeInflatable(U_TROPICAL, 15000, 'water') },
    ];
    // Repricer produced a result based on dryCart. Current cart is now waterCart.
    ok(
      '49 stale dry repricing rejected for water cart',
      canApplyRepricedCart(waterCart, dryCart) === false,
    );
  }

  // 50. Removing an earlier cart item shifts issue mapping correctly.
  {
    // Cart: [invalidProd, validProd]. Issue at index 0.
    // After removing index 0: [validProd]. No issue should remain.
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const invalidProd = makeProductCart('p_unknown', 'Unknown', 10000, 'standalone');
    const validProd = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cartBefore: UnifiedCartItem[] = [invalidProd, validProd];
    const resultBefore = repriceEventEssentialsCart(
      buildInput(cartBefore, { productConfigs: { p1 } }),
    );
    // Remove index 0 (the invalid line).
    const cartAfter = cartBefore.filter((_, i) => i !== 0);
    const resultAfter = repriceEventEssentialsCart(
      buildInput(cartAfter, { productConfigs: { p1 } }),
    );
    ok(
      '50 issue mapping shifts after removal',
      resultBefore.issues.length === 1 && resultBefore.issues[0].cartIndex === 0 &&
        resultAfter.issues.length === 0,
    );
  }

  // 51. Duplicate items display only their own issues.
  {
    // prod1 valid, prod2 invalid (p2 missing config). Only prod2 gets an issue.
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p2', 'Chairs', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod1, prod2];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    const issuesFor0 = result.issues.filter((i) => i.cartIndex === 0);
    const issuesFor1 = result.issues.filter((i) => i.cartIndex === 1);
    ok(
      '51 duplicates show only own issues',
      issuesFor0.length === 0 && issuesFor1.length === 1,
    );
  }

  // 52. An inflatable at the same former index never receives an EE issue.
  {
    // Cart: [prod(invalid), inflatable]. Issue at index 0 only.
    // Inflatable at index 1 must never receive an issue.
    const inf = makeInflatable(U_TROPICAL, 20000);
    const invalidProd = makeProductCart('p_unknown', 'Unknown', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [invalidProd, inf];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: {} }),
    );
    const issueForInflatable = result.issues.find((i) => i.cartIndex === 1);
    ok(
      '52 inflatable never receives EE issue',
      !issueForInflatable && result.issues.length === 1 && result.issues[0].cartIndex === 0,
    );
  }

  // 53. hasBlockingIssues returns true when at least one blocking issue exists.
  {
    const bundle = makeBundleConfig('b1', { inflatableEligibilityMode: 'any', standalonePriceCents: 30000 });
    const bCart = makeBundleCart('b1', 'Package', 30000, 'standalone');
    const cart: UnifiedCartItem[] = [bCart];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { bundleConfigs: { b1: bundle } }),
    );
    ok('53 hasBlockingIssues true', hasBlockingIssues(result.issues) === true);
  }

  // 54. hasBlockingIssues returns false when no blocking issues exist.
  {
    const p1 = makeProductConfig('p1', C_TABLES);
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    ok('54 hasBlockingIssues false', hasBlockingIssues(result.issues) === false);
  }

  // 55. No inflatable line ever receives pricing_context.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(
      buildInput(cart, { productConfigs: { p1 } }),
    );
    const outInf = result.cart[0] as InflatableCartItem;
    ok('55 inflatable has no pricing_context', !('pricing_context' in outInf));
  }

  // ---------------------------------------------------------------------------
  // Validation-state precedence tests (deriveEventEssentialsValidationState).
  // These call the real exported production helper so pending/failed mutual
  // exclusivity, write-pending, and config-ready are verified against the
  // actual contract — not a duplicate implementation.
  // ---------------------------------------------------------------------------

  // 56. EE cart + config error: pending=false, failed=true, canContinue=false.
  //     A config failure is terminal, not pending — must NOT show the waiting
  //     message. This is the core mutual-exclusivity assertion.
  {
    const s = deriveEventEssentialsValidationState({
      cartHasEE: true, configLoading: false, configError: true, configReady: false,
      currentResult: null, hasBlockingIssues: false,
    });
    ok(
      '56 EE+configError: pending=false, failed=true, canContinue=false',
      s.validationPending === false && s.validationFailed === true &&
        s.repricingWritePending === false && s.canContinue === false,
    );
  }

  // 57. EE cart + loading: pending=true, failed=false.
  {
    const s = deriveEventEssentialsValidationState({
      cartHasEE: true, configLoading: true, configError: false, configReady: false,
      currentResult: null, hasBlockingIssues: false,
    });
    ok(
      '57 EE+loading: pending=true, failed=false',
      s.validationPending === true && s.validationFailed === false && s.canContinue === false,
    );
  }

  // 58. EE cart + not ready and no error: pending=true, failed=false.
  {
    const s = deriveEventEssentialsValidationState({
      cartHasEE: true, configLoading: false, configError: false, configReady: false,
      currentResult: null, hasBlockingIssues: false,
    });
    ok(
      '58 EE+not ready: pending=true, failed=false',
      s.validationPending === true && s.validationFailed === false && s.canContinue === false,
    );
  }

  // 59. EE cart + changed result: writePending=true, pending=true, failed=false.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000, addonPriceCents: 6000, standalonePriceCents: 10000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    const s = deriveEventEssentialsValidationState({
      cartHasEE: true, configLoading: false, configError: false, configReady: true,
      currentResult: result, hasBlockingIssues: false,
    });
    ok(
      '59 EE+changed: writePending=true, pending=true, failed=false',
      s.repricingWritePending === true && s.validationPending === true &&
        s.validationFailed === false && s.canContinue === false,
    );
  }

  // 60. EE cart + unchanged valid result: pending=false, failed=false, canContinue=true.
  {
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod];
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    const s = deriveEventEssentialsValidationState({
      cartHasEE: true, configLoading: false, configError: false, configReady: true,
      currentResult: result, hasBlockingIssues: false,
    });
    ok(
      '60 EE+unchanged valid: pending=false, failed=false, canContinue=true',
      s.validationPending === false && s.validationFailed === false &&
        s.repricingWritePending === false && s.canContinue === true,
    );
  }

  // 61. Inflatable-only + config error: pending=false, failed=false, canContinue=true.
  {
    const s = deriveEventEssentialsValidationState({
      cartHasEE: false, configLoading: false, configError: true, configReady: false,
      currentResult: null, hasBlockingIssues: false,
    });
    ok(
      '61 inflatable-only+configError: not blocked',
      s.validationPending === false && s.validationFailed === false &&
        s.repricingWritePending === false && s.canContinue === true,
    );
  }

  // 61b. Inflatable-only + loading: pending=false, failed=false, canContinue=true.
  {
    const s = deriveEventEssentialsValidationState({
      cartHasEE: false, configLoading: true, configError: false, configReady: false,
      currentResult: null, hasBlockingIssues: false,
    });
    ok(
      '61b inflatable-only+loading: not blocked',
      s.validationPending === false && s.validationFailed === false && s.canContinue === true,
    );
  }

  // 61c. Inflatable-only + blocking argument true: canContinue=true because EE
  //      state must never block an inflatable-only cart.
  {
    const s = deriveEventEssentialsValidationState({
      cartHasEE: false, configLoading: true, configError: true, configReady: false,
      currentResult: null, hasBlockingIssues: true,
    });
    ok(
      '61c inflatable-only+blocking arg: canContinue=true',
      s.validationPending === false && s.validationFailed === false && s.canContinue === true,
    );
  }

  // =====================================================================
  // New E3 tests — current-render derivation, write-pending, config reuse,
  // duplicate issue mapping, resolverKey validation, add-on heuristic removal.
  // =====================================================================

  // 62. New cart becomes invalid and blocking issues are derived for that
  //     current cart without waiting for an issue-state effect.
  {
    const prod = makeProductCart('p_unknown', 'Unknown', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod];
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: {} }));
    ok(
      '62 current-cart blocking issues derived synchronously',
      result.issues.length === 1 && result.issues[0].blocking === true && result.issues[0].cartIndex === 0,
    );
  }

  // 63. Removing a qualifying inflatable produces either a current blocking
  //     issue OR currentResult.changed=true during the same render calculation.
  {
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000, addonPriceCents: 6000, standalonePriceCents: 10000 });
    const prod = makeProductCart('p1', 'Tables', 6000, 'addon'); // was add-on, now no qualifier
    const cart: UnifiedCartItem[] = [prod]; // inflatable removed
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    const out = result.cart[0] as EventEssentialProductCartItem;
    ok(
      '63 removing qualifier -> changed or blocking',
      result.changed === true && out.pricing_context === 'standalone',
    );
  }

  // 64. A changed currentResult causes validationPending=true.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000, addonPriceCents: 6000, standalonePriceCents: 10000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    const s = deriveEventEssentialsValidationState({
      cartHasEE: true, configLoading: false, configError: false, configReady: true,
      currentResult: result, hasBlockingIssues: hasBlockingIssues(result.issues),
    });
    ok('64 changed result -> validationPending', s.repricingWritePending === true && s.validationPending === true && s.canContinue === false);
  }

  // 65. An unchanged currentResult does not cause validationPending.
  {
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod];
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    const s = deriveEventEssentialsValidationState({
      cartHasEE: true, configLoading: false, configError: false, configReady: true,
      currentResult: result, hasBlockingIssues: hasBlockingIssues(result.issues),
    });
    ok('65 unchanged result -> no validationPending', s.repricingWritePending === false && s.validationPending === false && s.canContinue === true);
  }

  // 66. Adding a qualifying inflatable causes standalone-to-addon write pending.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000, addonPriceCents: 6000, standalonePriceCents: 10000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    ok(
      '66 adding qualifier -> standalone->addon write pending',
      result.changed === true &&
        (result.cart[1] as EventEssentialProductCartItem).pricing_context === 'addon' &&
        deriveEventEssentialsValidationState({
          cartHasEE: true, configLoading: false, configError: false, configReady: true,
          currentResult: result, hasBlockingIssues: false,
        }).repricingWritePending === true,
    );
  }

  // 67. Dry-to-water qualification change creates write pending.
  {
    const inf = makeInflatable(U_TROPICAL, 10000, 'dry'); // dry=10000 < 12000 threshold
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 12000, addonPriceCents: 6000, standalonePriceCents: 10000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const resultDry = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    ok(
      '67a dry does not qualify',
      (resultDry.cart[1] as EventEssentialProductCartItem).pricing_context === 'standalone',
    );
    // Now switch to water (15000 >= 12000)
    const waterCart: UnifiedCartItem[] = [
      makeInflatable(U_TROPICAL, 15000, 'water'),
      prod,
    ];
    const resultWater = repriceEventEssentialsCart(buildInput(waterCart, { productConfigs: { p1 } }));
    ok(
      '67b dry->water creates write pending',
      resultWater.changed === true &&
        (resultWater.cart[1] as EventEssentialProductCartItem).pricing_context === 'addon',
    );
  }

  // 68. Water-to-dry qualification change creates write pending.
  {
    const inf = makeInflatable(U_TROPICAL, 15000, 'water'); // water=15000 >= 12000
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 12000, addonPriceCents: 6000, standalonePriceCents: 10000 });
    const prod = makeProductCart('p1', 'Tables', 6000, 'addon');
    const cart: UnifiedCartItem[] = [inf, prod];
    const resultWater = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    ok(
      '68a water qualifies (already addon)',
      (resultWater.cart[1] as EventEssentialProductCartItem).pricing_context === 'addon',
    );
    // Switch to dry (10000 < 12000) -> should revert to standalone
    const dryCart: UnifiedCartItem[] = [
      makeInflatable(U_TROPICAL, 10000, 'dry'),
      prod,
    ];
    const resultDry = repriceEventEssentialsCart(buildInput(dryCart, { productConfigs: { p1 } }));
    ok(
      '68b water->dry creates write pending',
      resultDry.changed === true &&
        (resultDry.cart[1] as EventEssentialProductCartItem).pricing_context === 'standalone',
    );
  }

  // 69. Old issues are not reused after the cart reference changes.
  {
    // Cart A has an invalid product at index 0. Cart B (new reference) has
    // only a valid product. The repricer must compute fresh issues for B,
    // never reuse A's issues.
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const cartA: UnifiedCartItem[] = [makeProductCart('p_unknown', 'Unknown', 10000, 'standalone')];
    const resultA = repriceEventEssentialsCart(buildInput(cartA, { productConfigs: { p1 } }));
    const cartB: UnifiedCartItem[] = [makeProductCart('p1', 'Tables', 10000, 'standalone')];
    const resultB = repriceEventEssentialsCart(buildInput(cartB, { productConfigs: { p1 } }));
    ok(
      '69 old issues not reused after cart ref change',
      resultA.issues.length === 1 && resultB.issues.length === 0,
    );
  }

  // 70. Removing an earlier duplicate does not place the previous issue beside
  //     another duplicate occurrence.
  {
    // Three duplicate product lines, middle one invalid (p2).
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const cart: UnifiedCartItem[] = [
      makeProductCart('p1', 'Tables', 10000, 'standalone'),
      makeProductCart('p2', 'Chairs', 10000, 'standalone'), // invalid, index 1
      makeProductCart('p1', 'Tables', 10000, 'standalone'),
    ];
    const resultBefore = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    // Remove index 1 (the invalid line).
    const cartAfter = cart.filter((_, i) => i !== 1);
    const resultAfter = repriceEventEssentialsCart(buildInput(cartAfter, { productConfigs: { p1 } }));
    ok(
      '70 removing earlier duplicate does not misplace issue',
      resultBefore.issues.length === 1 && resultBefore.issues[0].cartIndex === 1 &&
        resultAfter.issues.length === 0,
    );
  }

  // 71. Exact resolverKey validation distinguishes duplicate occurrences.
  {
    // Two duplicate product lines. Line 0 valid, line 1 invalid (different id).
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const cart: UnifiedCartItem[] = [
      makeProductCart('p1', 'Tables', 10000, 'standalone'),
      makeProductCart('p2', 'Chairs', 10000, 'standalone'),
    ];
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1 } }));
    const issue0 = result.issues.find((i) => i.cartIndex === 0);
    const issue1 = result.issues.find((i) => i.cartIndex === 1);
    ok(
      '71 resolverKey distinguishes duplicate occurrences',
      !issue0 && !!issue1 &&
        issue1.resolverKey === productLineKey(1, 'p2') &&
        issue1.resolverKey !== productLineKey(0, 'p1'),
    );
  }

  // 72. A valid add-on product qualified by another Event Essential category
  //     does not produce a "Requires Inflatable" warning. E1 is the sole
  //     source of qualification-invalid messages; the old local heuristic is
  //     removed. Here a product in category B qualifies a product in category A
  //     with NO inflatable present, and no issue is produced.
  {
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 10000, addonPriceCents: 6000, standalonePriceCents: 10000 });
    const p2 = makeProductConfig('p2', C_CHAIRS, { standalonePriceCents: 10000 });
    const prod1 = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const prod2 = makeProductCart('p2', 'Chairs', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [prod2, prod1]; // no inflatable
    const result = repriceEventEssentialsCart(buildInput(cart, { productConfigs: { p1, p2 } }));
    const out1 = result.cart[1] as EventEssentialProductCartItem;
    ok(
      '72 cross-category add-on valid without inflatable -> no Requires Inflatable',
      out1.pricing_context === 'addon' && result.issues.length === 0,
    );
  }

  // 73. Re-adding EE after successful config load reuses ready configuration.
  //     (Pure verification: configReady stays true once maps exist; the
  //     loading guard prevents a second fetch. Simulated with a stable
  //     configMaps reference.)
  {
    const p1 = makeProductConfig('p1', C_TABLES, { standalonePriceCents: 10000, addonEnabled: false, addonPriceCents: null });
    const maps = {
      productConfigs: { p1 },
      bundleConfigs: {},
      categories: { [C_TABLES]: makeCategory(C_TABLES), [C_CHAIRS]: makeCategory(C_CHAIRS) },
      units: { [U_TROPICAL]: makeUnit(U_TROPICAL, true), [U_SLIDE]: makeUnit(U_SLIDE, true) },
    };
    const eeCart = [makeProductCart('p1', 'Tables', 10000, 'standalone')] as UnifiedCartItem[];
    // First computation with config ready.
    const r1 = repriceEventEssentialsCart({ cart: eeCart, ...maps });
    // Simulate EE removed then re-added: same maps object reused.
    const emptyCart: UnifiedCartItem[] = [];
    const rEmpty = repriceEventEssentialsCart({ cart: emptyCart, ...maps });
    const r2 = repriceEventEssentialsCart({ cart: eeCart, ...maps });
    ok(
      '73 config reused when EE re-added',
      r1.changed === false && rEmpty.changed === false && r2.changed === false,
    );
  }

  // 74. Inflatable-only cart remains immediately continuable.
  {
    const s = deriveEventEssentialsValidationState({
      cartHasEE: false, configLoading: true, configError: true, configReady: false,
      currentResult: null, hasBlockingIssues: false,
    });
    ok(
      '74 inflatable-only continuable regardless of EE state',
      s.validationPending === false && s.validationFailed === false && s.canContinue === true,
    );
  }

  // 75. Compare-and-apply rejection leaves the newer cart untouched.
  //     Retain an exact reference to the newer water item, run the stale
  //     reference comparison, and confirm the newer cart still contains that
  //     exact reference with its water fields intact. (This is a pure
  //     reference-comparison test; the actual compare-and-apply source is the
  //     evidence that the mismatch path returns before setCart/persistCart.)
  {
    const dryCart: UnifiedCartItem[] = [makeInflatable(U_TROPICAL, 10000, 'dry')];
    const repricedDry: UnifiedCartItem[] = [...dryCart];
    const waterItem = makeInflatable(U_TROPICAL, 15000, 'water');
    const waterCart: UnifiedCartItem[] = [waterItem];
    const applied = canApplyRepricedCart(waterCart, repricedDry);
    const out = waterCart[0] as InflatableCartItem;
    ok(
      '75 stale rejection leaves newer cart untouched',
      applied === false &&
        waterCart[0] === waterItem &&
        out.wet_or_dry === 'water' &&
        out.unit_price_cents === 15000,
    );
  }

  // 76. Successful compare-and-apply leads to a subsequent changed=false result.
  {
    const inf = makeInflatable(U_TROPICAL, 20000);
    const p1 = makeProductConfig('p1', C_TABLES, { addonQualifyingThresholdCents: 15000, addonPriceCents: 6000, standalonePriceCents: 10000 });
    const prod = makeProductCart('p1', 'Tables', 10000, 'standalone');
    const cart: UnifiedCartItem[] = [inf, prod];
    const input = buildInput(cart, { productConfigs: { p1 } });
    const r1 = repriceEventEssentialsCart(input);
    // Simulate successful apply: the repriced cart becomes the new cart.
    const r2 = repriceEventEssentialsCart({ ...input, cart: r1.cart });
    ok(
      '76 successful apply -> subsequent changed=false',
      r1.changed === true && r2.changed === false,
    );
  }

  // Summary
  console.log(`Stage E3 cart repricing tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
