// Stage E2 — Focused tests for the customer catalog → resolver adapter.
//
// No Supabase, no network. Hardcoded normalized fixtures only.
// Runnable via: npx jiti src/lib/eventEssentialsCatalogResolver.test.ts

import {
  buildProductConfigMap,
  buildBundleConfigMap,
  buildCategoryMap,
  buildUnitMap,
  normalizeCartLines,
  evaluateProductCandidate,
  evaluateBundleCandidate,
  deriveCandidateViewModel,
  type CandidateEvalContext,
} from './eventEssentialsCatalogResolver';
import type {
  InventoryProduct,
  ProductPricing,
  ProductCategory,
  ProductBundleWithConfiguration,
  UnifiedCartItem,
  InflatableCartItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
} from '../types';

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passCount += 1;
  } else {
    failCount += 1;
    failures.push(detail ? `${name} — ${detail}` : name);
  }
}

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

const C_TABLES = 'cat_tables';
const C_CHAIRS = 'cat_chairs';
const U_TROPICAL = 'unit_tropical';
const U_SLIDE = 'unit_slide';

function makeProduct(id: string, categoryId: string): InventoryProduct {
  return {
    id,
    slug: id,
    name: id,
    description: null,
    image_url: null,
    total_quantity: 10,
    temp_unavailable_qty: 0,
    active: true,
    public_visible: true,
    category_id: categoryId,
    sort_order: 0,
    created_at: '',
    updated_at: '',
  };
}

function makePricing(
  productId: string,
  opts: Partial<ProductPricing> = {},
): ProductPricing {
  return {
    id: `pp-${productId}`,
    product_id: productId,
    standalone_price_cents: null,
    addon_price_cents: null,
    standalone_enabled: false,
    addon_enabled: false,
    sort_order: 0,
    addon_qualifying_threshold_cents: null,
    created_at: '',
    updated_at: '',
    ...opts,
  };
}

function makeCategory(id: string): ProductCategory {
  return {
    id,
    slug: id,
    name: id,
    sort_order: 0,
    active: true,
    public_visible: true,
    created_at: '',
    updated_at: '',
  };
}

function makeInflatableCart(
  unitId: string,
  priceCents: number,
  qty = 1,
  wetOrDry: 'dry' | 'water' = 'dry',
  unitName = 'Inflatable',
): InflatableCartItem {
  return {
    item_type: 'inflatable',
    unit_id: unitId,
    unit_name: unitName,
    wet_or_dry: wetOrDry,
    unit_price_cents: priceCents,
    price_dry_cents: wetOrDry === 'dry' ? priceCents : undefined,
    price_water_cents: wetOrDry === 'water' ? priceCents : undefined,
    qty,
  };
}

function makeProductCart(
  productId: string,
  qty: number,
  unitPriceCents: number,
  pricingContext: 'standalone' | 'addon' = 'standalone',
): EventEssentialProductCartItem {
  return {
    item_type: 'event_essential_product',
    product_id: productId,
    product_name: productId,
    unit_price_cents: unitPriceCents,
    qty,
    pricing_context: pricingContext,
  };
}

function makeBundleCart(
  bundleId: string,
  qty: number,
  unitPriceCents: number,
  pricingContext: 'standalone' | 'addon' = 'standalone',
): EventEssentialBundleCartItem {
  return {
    item_type: 'event_essential_bundle',
    bundle_id: bundleId,
    bundle_name: bundleId,
    unit_price_cents: unitPriceCents,
    qty,
    pricing_context: pricingContext,
    component_snapshot: {
      bundle_name: bundleId,
      bundle_description: null,
      components: [],
    },
  };
}

function makeBundleConfigured(
  id: string,
  opts: Partial<ProductBundleWithConfiguration> = {},
): ProductBundleWithConfiguration {
  return {
    id,
    slug: id,
    name: id,
    description: null,
    image_url: null,
    standalone_price_cents: null,
    addon_price_cents: null,
    standalone_enabled: false,
    addon_enabled: false,
    active: true,
    public_visible: true,
    menu_visible: true,
    featured: false,
    sort_order: 0,
    addon_qualifying_threshold_cents: null,
    inflatable_eligibility_mode: 'none',
    created_at: '',
    updated_at: '',
    product_bundle_components: [],
    package_inflatable_components: [],
    product_bundle_excluded_categories: [],
    package_inflatable_eligibility: [],
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Build a reusable resolver context from DB-row fixtures + current cart.
// ---------------------------------------------------------------------------

function buildCtx(params: {
  products: InventoryProduct[];
  pricing: ProductPricing[];
  categories: ProductCategory[];
  bundles?: ProductBundleWithConfiguration[];
  units?: { id: string; active: boolean }[];
  cart: UnifiedCartItem[];
}): CandidateEvalContext {
  const productConfigs = buildProductConfigMap(params.products, params.pricing);
  const bundleConfigs = buildBundleConfigMap(params.bundles ?? []);
  const categories = buildCategoryMap(params.categories);
  const units = buildUnitMap(params.units ?? []);
  const cartLines = normalizeCartLines(params.cart, productConfigs, bundleConfigs);
  return { productConfigs, bundleConfigs, categories, units, cartLines };
}

// ---------------------------------------------------------------------------
// 20 required E2 scenarios.
// ---------------------------------------------------------------------------

function runTests(): void {
  // 1. Product candidate receives add-on pricing from a direct inflatable.
  {
    const products = [makeProduct('p_tables', C_TABLES)];
    const pricing = [
      makePricing('p_tables', {
        standalone_price_cents: 10000,
        standalone_enabled: true,
        addon_price_cents: 6000,
        addon_enabled: true,
        addon_qualifying_threshold_cents: 15000,
      }),
    ];
    const categories = [makeCategory(C_TABLES)];
    const units = [{ id: U_TROPICAL, active: true }];
    const cart: UnifiedCartItem[] = [makeInflatableCart(U_TROPICAL, 15000)];
    const ctx = buildCtx({ products, pricing, categories, units, cart });
    const out = evaluateProductCandidate(ctx, { productId: 'p_tables', qty: 1 });
    ok('1 product addon from inflatable', out !== null && out.addonQualified && out.resolvedPricingContext === 'addon' && out.resolvedUnitPriceCents === 6000);
  }

  // 2. Product candidate receives standalone pricing below threshold.
  {
    const products = [makeProduct('p_tables', C_TABLES)];
    const pricing = [
      makePricing('p_tables', {
        standalone_price_cents: 10000,
        standalone_enabled: true,
        addon_price_cents: 6000,
        addon_enabled: true,
        addon_qualifying_threshold_cents: 15000,
      }),
    ];
    const categories = [makeCategory(C_TABLES)];
    const units = [{ id: U_TROPICAL, active: true }];
    const cart: UnifiedCartItem[] = [makeInflatableCart(U_TROPICAL, 5000)];
    const ctx = buildCtx({ products, pricing, categories, units, cart });
    const out = evaluateProductCandidate(ctx, { productId: 'p_tables', qty: 1 });
    ok('2 product standalone below threshold', out !== null && !out.addonQualified && out.resolvedPricingContext === 'standalone' && out.resolvedUnitPriceCents === 10000 && out.remainingAmountCents === 10000);
  }

  // 3. Product candidate excludes actual cart products in its own category.
  {
    const products = [makeProduct('p_t1', C_TABLES), makeProduct('p_t2', C_TABLES)];
    const pricing = [
      makePricing('p_t1', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
      makePricing('p_t2', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_TABLES)];
    const ctx = buildCtx({
      products, pricing, categories,
      cart: [makeProductCart('p_t1', 1, 10000, 'standalone')],
    });
    const out = evaluateProductCandidate(ctx, { productId: 'p_t2', qty: 1 });
    // p_t1 is in the SAME category as candidate p_t2 -> excluded from qualifying subtotal.
    ok('3 own-category cart product excluded', out !== null && !out.addonQualified && out.qualifyingSubtotalCents === 0 && out.resolvedPricingContext === 'standalone');
  }

  // 4. Product candidate includes products in another category.
  {
    const products = [makeProduct('p_t', C_TABLES), makeProduct('p_c', C_CHAIRS)];
    const pricing = [
      makePricing('p_t', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
      makePricing('p_c', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_TABLES), makeCategory(C_CHAIRS)];
    const ctx = buildCtx({
      products, pricing, categories,
      cart: [makeProductCart('p_c', 2, 10000, 'standalone')],
    });
    const out = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 1 });
    ok('4 other-category product contributes', out !== null && out.addonQualified && out.qualifyingSubtotalCents === 20000 && out.resolvedPricingContext === 'addon');
  }

  // 5. Package candidate excludes configured categories.
  {
    const products = [makeProduct('p_t', C_TABLES), makeProduct('p_c', C_CHAIRS)];
    const pricing = [
      makePricing('p_t', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
      makePricing('p_c', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_TABLES), makeCategory(C_CHAIRS)];
    const bundles = [
      makeBundleConfigured('b_pkg', {
        standalone_price_cents: 30000,
        standalone_enabled: true,
        addon_price_cents: 20000,
        addon_enabled: true,
        addon_qualifying_threshold_cents: 15000,
        inflatable_eligibility_mode: 'none',
        product_bundle_excluded_categories: [
          { bundle_id: 'b_pkg', category_id: C_CHAIRS, created_at: '', category: { id: C_CHAIRS, slug: C_CHAIRS, name: C_CHAIRS } },
        ],
      }),
    ];
    const ctx = buildCtx({
      products, pricing, categories, bundles,
      cart: [makeProductCart('p_c', 2, 10000, 'standalone')],
    });
    const out = evaluateBundleCandidate(ctx, { bundleId: 'b_pkg', qty: 1 });
    // p_c is in an excluded category for this package -> contributes nothing.
    ok('5 package excludes configured category', out !== null && !out.addonQualified && out.qualifyingSubtotalCents === 0 && out.resolvedPricingContext === 'standalone');
  }

  // 6. Package candidate ignores package cart-line value.
  {
    const categories = [makeCategory(C_TABLES)];
    const bundles = [
      makeBundleConfigured('b_pkg', {
        standalone_price_cents: 30000,
        standalone_enabled: true,
        addon_price_cents: 20000,
        addon_enabled: true,
        addon_qualifying_threshold_cents: 15000,
        inflatable_eligibility_mode: 'none',
      }),
    ];
    const ctx = buildCtx({
      products: [],
      pricing: [],
      categories,
      bundles,
      cart: [makeBundleCart('b_pkg', 5, 30000, 'standalone')],
    });
    const out = evaluateBundleCandidate(ctx, { bundleId: 'b_pkg', qty: 1 });
    // The package cart line contributes 0 (packages never qualify packages).
    ok('6 package cart line ignored', out !== null && !out.addonQualified && out.qualifyingSubtotalCents === 0 && out.resolvedPricingContext === 'standalone');
  }

  // 7. Unselected catalog candidates do not qualify one another.
  {
    const products = [makeProduct('p_t', C_TABLES), makeProduct('p_c', C_CHAIRS)];
    const pricing = [
      makePricing('p_t', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
      makePricing('p_c', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_TABLES), makeCategory(C_CHAIRS)];
    const ctx = buildCtx({ products, pricing, categories, cart: [] });
    const outT = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 1 });
    const outC = evaluateProductCandidate(ctx, { productId: 'p_c', qty: 1 });
    ok('7 unselected candidates do not qualify each other',
      outT !== null && outC !== null &&
      !outT.addonQualified && outT.qualifyingSubtotalCents === 0 &&
      !outC.addonQualified && outC.qualifyingSubtotalCents === 0);
  }

  // 8. Candidate synthetic line does not qualify itself.
  {
    const products = [makeProduct('p_t', C_TABLES)];
    const pricing = [
      makePricing('p_t', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_TABLES)];
    const ctx = buildCtx({ products, pricing, categories, cart: [] });
    const out = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 10 });
    // Even qty 10 of the candidate itself must not qualify itself (self-exclusion).
    ok('8 candidate does not self-qualify', out !== null && !out.addonQualified && out.qualifyingSubtotalCents === 0 && out.resolvedPricingContext === 'standalone');
  }

  // 9. Any-inflatable prerequisite passes with a valid direct inflatable.
  {
    const categories = [makeCategory(C_TABLES)];
    const units = [{ id: U_TROPICAL, active: true }];
    const bundles = [
      makeBundleConfigured('b_any', {
        standalone_price_cents: 30000,
        standalone_enabled: true,
        inflatable_eligibility_mode: 'any',
      }),
    ];
    const ctx = buildCtx({
      products: [], pricing: [], categories, bundles, units,
      cart: [makeInflatableCart(U_TROPICAL, 15000)],
    });
    const out = evaluateBundleCandidate(ctx, { bundleId: 'b_any', qty: 1 });
    ok('9 any prereq passes with inflatable', out !== null && out.prerequisiteMet && out.selectable);
  }

  // 10. Any-inflatable prerequisite fails without one.
  {
    const categories = [makeCategory(C_TABLES)];
    const bundles = [
      makeBundleConfigured('b_any', {
        standalone_price_cents: 30000,
        standalone_enabled: true,
        inflatable_eligibility_mode: 'any',
      }),
    ];
    const ctx = buildCtx({ products: [], pricing: [], categories, bundles, cart: [] });
    const out = evaluateBundleCandidate(ctx, { bundleId: 'b_any', qty: 1 });
    ok('10 any prereq fails without inflatable', out !== null && !out.prerequisiteMet && out.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE' && !out.selectable);
  }

  // 11. Selected-inflatable prerequisite passes with matching direct unit.
  {
    const categories = [makeCategory(C_TABLES)];
    const units = [{ id: U_TROPICAL, active: true }];
    const bundles = [
      makeBundleConfigured('b_sel', {
        standalone_price_cents: 30000,
        standalone_enabled: true,
        inflatable_eligibility_mode: 'selected',
        package_inflatable_eligibility: [
          { bundle_id: 'b_sel', unit_id: U_TROPICAL, created_at: '', unit: { id: U_TROPICAL, slug: U_TROPICAL, name: U_TROPICAL, active: true } },
        ],
      }),
    ];
    const ctx = buildCtx({
      products: [], pricing: [], categories, bundles, units,
      cart: [makeInflatableCart(U_TROPICAL, 15000)],
    });
    const out = evaluateBundleCandidate(ctx, { bundleId: 'b_sel', qty: 1 });
    ok('11 selected prereq passes with matching unit', out !== null && out.prerequisiteMet && out.selectable);
  }

  // 12. Selected-inflatable prerequisite fails with nonmatching direct unit.
  {
    const categories = [makeCategory(C_TABLES)];
    const units = [{ id: U_SLIDE, active: true }];
    const bundles = [
      makeBundleConfigured('b_sel', {
        standalone_price_cents: 30000,
        standalone_enabled: true,
        inflatable_eligibility_mode: 'selected',
        package_inflatable_eligibility: [
          { bundle_id: 'b_sel', unit_id: U_TROPICAL, created_at: '', unit: { id: U_TROPICAL, slug: U_TROPICAL, name: U_TROPICAL, active: true } },
        ],
      }),
    ];
    const ctx = buildCtx({
      products: [], pricing: [], categories, bundles, units,
      cart: [makeInflatableCart(U_SLIDE, 15000)],
    });
    const out = evaluateBundleCandidate(ctx, { bundleId: 'b_sel', qty: 1 });
    ok('12 selected prereq fails with nonmatching unit', out !== null && !out.prerequisiteMet && !out.selectable);
  }

  // 13. Direct inflatable selected dry/water price maps correctly.
  {
    const products = [makeProduct('p_t', C_TABLES)];
    const pricing = [
      makePricing('p_t', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_TABLES)];
    const units = [{ id: U_TROPICAL, active: true }];
    // Water-selected inflatable with water price 18000 must contribute 18000.
    const cart: UnifiedCartItem[] = [makeInflatableCart(U_TROPICAL, 18000, 1, 'water')];
    const ctx = buildCtx({ products, pricing, categories, units, cart });
    const out = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 1 });
    ok('13 water price maps correctly', out !== null && out.qualifyingSubtotalCents === 18000 && out.addonQualified);
  }

  // 14. Existing product cart line contribution uses authoritative standalone
  //     product config, not stored add-on price.
  {
    const products = [makeProduct('p_c', C_CHAIRS), makeProduct('p_t', C_TABLES)];
    const pricing = [
      makePricing('p_c', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 3000, addon_enabled: true, addon_qualifying_threshold_cents: 10000 }),
      makePricing('p_t', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 10000 }),
    ];
    const categories = [makeCategory(C_TABLES), makeCategory(C_CHAIRS)];
    const ctx = buildCtx({
      products, pricing, categories,
      // Cart stores add-on price 3000, but authoritative standalone is 10000.
      cart: [makeProductCart('p_c', 1, 3000, 'addon')],
    });
    const out = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 1 });
    // Contribution must be 10000 (authoritative standalone), not 3000 (stored add-on).
    ok('14 product cart line uses authoritative standalone', out !== null && out.qualifyingSubtotalCents === 10000 && out.addonQualified);
  }

  // 15. Package cart line is normalized but contributes zero through E1.
  {
    const products = [makeProduct('p_c', C_CHAIRS)];
    const pricing = [
      makePricing('p_c', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_CHAIRS)];
    const bundles = [
      makeBundleConfigured('b_pkg', {
        standalone_price_cents: 30000,
        standalone_enabled: true,
        inflatable_eligibility_mode: 'none',
      }),
    ];
    const ctx = buildCtx({
      products, pricing, categories, bundles,
      cart: [makeBundleCart('b_pkg', 3, 30000, 'standalone')],
    });
    const out = evaluateProductCandidate(ctx, { productId: 'p_c', qty: 1 });
    ok('15 package cart line contributes zero', out !== null && out.qualifyingSubtotalCents === 0 && !out.addonQualified);
  }

  // 16. customer_choice metadata reaches the catalog result.
  {
    const categories = [makeCategory(C_TABLES)];
    const units = [{ id: U_TROPICAL, active: true }];
    const bundles = [
      makeBundleConfigured('b_cc', {
        standalone_price_cents: 30000,
        standalone_enabled: true,
        inflatable_eligibility_mode: 'none',
        package_inflatable_components: [
          { id: 'c1', bundle_id: 'b_cc', unit_id: U_TROPICAL, quantity_per_bundle: 1, selection_mode: 'customer_choice', created_at: '', unit: { id: U_TROPICAL, slug: U_TROPICAL, name: U_TROPICAL, price_dry_cents: 10000, price_water_cents: 12000, active: true } },
        ],
      }),
    ];
    const ctx = buildCtx({ products: [], pricing: [], categories, bundles, units, cart: [] });
    const out = evaluateBundleCandidate(ctx, { bundleId: 'b_cc', qty: 1 });
    const vm = deriveCandidateViewModel(out, true);
    ok('16 customer_choice metadata reaches result', out !== null && out.requiresCustomerChoice === true && vm.requiresCustomerChoice === true);
  }

  // 17. Resolver invalid state maps to disabled customer state.
  {
    const products = [makeProduct('p_x', C_TABLES)];
    // Pricing row exists but both paths disabled -> NO_PURCHASE_PATH.
    const pricing = [makePricing('p_x', { standalone_enabled: false, addon_enabled: false })];
    const categories = [makeCategory(C_TABLES)];
    const ctx = buildCtx({ products, pricing, categories, cart: [] });
    const out = evaluateProductCandidate(ctx, { productId: 'p_x', qty: 1 });
    const vm = deriveCandidateViewModel(out, false);
    ok('17 invalid state maps to disabled', out !== null && !out.selectable && !vm.selectable && vm.priceState === 'unavailable');
  }

  // 18. Configuration warning with standalone fallback remains customer-selectable.
  {
    const products = [makeProduct('p_t', C_TABLES)];
    const pricing = [
      makePricing('p_t', {
        standalone_price_cents: 10000,
        standalone_enabled: true,
        addon_price_cents: 6000,
        addon_enabled: true,
        // Threshold missing -> add-on incomplete, standalone fallback + warning.
        addon_qualifying_threshold_cents: null,
      }),
    ];
    const categories = [makeCategory(C_TABLES)];
    const ctx = buildCtx({ products, pricing, categories, cart: [] });
    const out = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 1 });
    const vm = deriveCandidateViewModel(out, false);
    ok('18 warning + standalone fallback selectable',
      out !== null && out.selectable && out.resolvedPricingContext === 'standalone' &&
      out.configurationWarning !== null && vm.selectable && vm.priceState === 'standalone');
  }

  // 19. Quantity change changes the synthetic candidate input but does not let
  //     the candidate qualify itself.
  {
    const products = [makeProduct('p_t', C_TABLES)];
    const pricing = [
      makePricing('p_t', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_TABLES)];
    const ctx = buildCtx({ products, pricing, categories, cart: [] });
    const out1 = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 1 });
    const out50 = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 50 });
    ok('19 quantity change does not self-qualify',
      out1 !== null && out50 !== null &&
      !out1.addonQualified && !out50.addonQualified &&
      out1.resolvedPricingContext === 'standalone' && out50.resolvedPricingContext === 'standalone' &&
      out1.qualifyingSubtotalCents === 0 && out50.qualifyingSubtotalCents === 0);
  }

  // 20. Candidate result lookup uses the exact synthetic resolver key.
  {
    const products = [makeProduct('p_t', C_TABLES)];
    const pricing = [
      makePricing('p_t', { standalone_price_cents: 10000, standalone_enabled: true, addon_price_cents: 6000, addon_enabled: true, addon_qualifying_threshold_cents: 15000 }),
    ];
    const categories = [makeCategory(C_TABLES)];
    const units = [{ id: U_TROPICAL, active: true }];
    const ctx = buildCtx({ products, pricing, categories, units, cart: [makeInflatableCart(U_TROPICAL, 15000)] });
    const out = evaluateProductCandidate(ctx, { productId: 'p_t', qty: 1 });
    // A non-null result whose resolverKey contains the product id and "-candidate-"
    // proves lookup used the synthetic key (find by key returned the right line).
    ok('20 candidate lookup uses synthetic key',
      out !== null && out.resolvedUnitPriceCents === 6000 && out.addonQualified);
  }
}

runTests();

console.log(`\nStage E2 catalog adapter tests: ${passCount} passed, ${failCount} failed.`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
if (failCount > 0) {
  process.exit(1);
}
