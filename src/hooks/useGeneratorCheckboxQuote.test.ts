// Focused tests for customer Quote/cart Generator checkbox behavior.
// Imports narrow pure production helpers — no Admin/Crew/invoice simulation.
// jiti runner, no React/Supabase.

import {
  getDirectGeneratorQuantity,
  cartHasDirectGenerator,
  removeDirectGeneratorProduct,
  cartPackageContainsGenerator,
  isValidEventDateRange,
  decideDirectGeneratorAdd,
  shouldRunLegacyConversion,
  decideLegacySync,
  isConversionAllowed,
  type PackageGeneratorConfig,
} from '../lib/generatorUnified';
import {
  normalizeCartLines,
  evaluateProductCandidate,
  deriveCandidateViewModel,
} from '../lib/eventEssentialsCatalogResolver';
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
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

function test(name: string, fn: () => void): void {
  try { fn(); } catch (err) { failed++; console.error(`FAIL: ${name}:`, err); }
}

const GEN_ID = 'gen-product-uuid';
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

function makeProductConfig(productId: string, categoryId: string, standalone: number, addon: number, addonThreshold: number) {
  return {
    id: productId,
    categoryId,
    standalonePriceCents: standalone,
    addonPriceCents: addon,
    standaloneEnabled: true,
    addonEnabled: true,
    addonQualifyingThresholdCents: addonThreshold,
  };
}

function makeResolverContext(cart: UnifiedCartItem[], productConfigs: Record<string, any>, bundleConfigs: Record<string, any> = {}, categories: Record<string, any> = { 'cat-gen': { id: 'cat-gen' } }, units: Record<string, any> = { 'u1': { id: 'u1', active: true }, 'u2': { id: 'u2', active: true } }) {
  const cartLines = normalizeCartLines(cart, productConfigs, bundleConfigs);
  return {
    productConfigs,
    bundleConfigs,
    categories,
    units,
    cartLines,
  };
}

// =========================================================================
// 1. Legacy state sets legacyConversionNeeded while configuration loads
// =========================================================================
test('1. Legacy state sets legacyConversionNeeded while configuration loads', () => {
  // configurationReady is false (loading), but legacy state is present.
  // decideLegacySync must return 'set_needed' regardless of configuration.
  const decision = decideLegacySync({
    isInitialized: true,
    hasLegacyState: true,
    directQty: 0,
    configurationReady: false,
  });
  ok('sets needed while loading', decision.action === 'set_needed');
});

// =========================================================================
// 2. Legacy state remains blocking when configuration fails
// =========================================================================
test('2. Legacy state remains blocking when configuration fails', () => {
  // configurationReady is false (failed), legacy state present.
  // Must still return 'set_needed' — not 'none' or 'clear_needed'.
  const decision = decideLegacySync({
    isInitialized: true,
    hasLegacyState: true,
    directQty: 0,
    configurationReady: false,
  });
  ok('still set_needed when failed', decision.action === 'set_needed');
  ok('not none', decision.action !== 'none');
  ok('not clear_needed', decision.action !== 'clear_needed');
});

// =========================================================================
// 3. No legacy state clears legacyConversionNeeded
// =========================================================================
test('3. No legacy state clears legacyConversionNeeded', () => {
  const decision = decideLegacySync({
    isInitialized: true,
    hasLegacyState: false,
    directQty: 0,
    configurationReady: false,
  });
  ok('clears when no legacy', decision.action === 'clear_needed');
});

// =========================================================================
// 4. Existing direct Generator clears stale legacy state
// =========================================================================
test('4. Existing direct Generator clears stale legacy state', () => {
  // Legacy state present + directQty > 0 + configurationReady → clear stale
  // and complete. Do not add another Generator.
  const decision = decideLegacySync({
    isInitialized: true,
    hasLegacyState: true,
    directQty: 1,
    configurationReady: true,
  });
  ok('clears stale and completes', decision.action === 'clear_stale_and_complete');

  // Without configurationReady, direct Generator alone does not trigger
  // stale-field clearing — legacy state stays as 'set_needed'.
  const notReady = decideLegacySync({
    isInitialized: true,
    hasLegacyState: true,
    directQty: 1,
    configurationReady: false,
  });
  ok('stays set_needed without config ready', notReady.action === 'set_needed');
});

// =========================================================================
// 5. Conversion is blocked when packageConfigs is null
// =========================================================================
test('5. Conversion is blocked when packageConfigs is null', () => {
  // packageConfigs === null means the package-component query failed or is
  // still loading. A null must never be interpreted as zero Generators.
  const allowed = isConversionAllowed({
    configurationReady: true,
    hasGeneratorProduct: true,
    hasResolverConfig: true,
    packageConfigsLoaded: false,
  });
  ok('blocked when packageConfigs null', allowed === false);
});

// =========================================================================
// 6. Conversion is blocked when configuration failed
// =========================================================================
test('6. Conversion is blocked when configuration failed', () => {
  const allowed = isConversionAllowed({
    configurationReady: false,
    hasGeneratorProduct: true,
    hasResolverConfig: true,
    packageConfigsLoaded: true,
  });
  ok('blocked when config failed', allowed === false);
});

// =========================================================================
// 7. Conversion is allowed only when configuration is ready
// =========================================================================
test('7. Conversion is allowed only when configuration is ready', () => {
  // All prerequisites met → allowed.
  const allMet = isConversionAllowed({
    configurationReady: true,
    hasGeneratorProduct: true,
    hasResolverConfig: true,
    packageConfigsLoaded: true,
  });
  ok('allowed when all ready', allMet === true);

  // Missing generatorProduct → blocked.
  const noProduct = isConversionAllowed({
    configurationReady: true,
    hasGeneratorProduct: false,
    hasResolverConfig: true,
    packageConfigsLoaded: true,
  });
  ok('blocked without product', noProduct === false);

  // Missing resolverConfig → blocked.
  const noResolver = isConversionAllowed({
    configurationReady: true,
    hasGeneratorProduct: true,
    hasResolverConfig: false,
    packageConfigsLoaded: true,
  });
  ok('blocked without resolver', noResolver === false);
});

// =========================================================================
// 8. Current package quantity prevents a direct duplicate without waiting
//    for an effect
// =========================================================================
test('8. Current package quantity prevents a direct duplicate without waiting for an effect', () => {
  // packageContainedQty is derived synchronously via useMemo from cart,
  // generatorProduct, and packageConfigs. decideDirectGeneratorAdd uses
  // the current value in the same render — no effect round-trip.
  const cart: UnifiedCartItem[] = [makeBundleWithGenerator('b1', 'Power Bundle', 15000, GEN_ID, 2)];
  const configs: PackageGeneratorConfig[] = [
    { bundle_id: 'b1', product_id: GEN_ID, quantity_per_bundle: 1 },
  ];

  // Synchronous derivation — no state, no effect.
  const packageQty = cartPackageContainsGenerator(cart, configs, GEN_ID);
  ok('package qty = 2', packageQty === 2);

  const decision = decideDirectGeneratorAdd(0, packageQty);
  ok('duplicate prevented synchronously', decision.shouldAdd === false);
  ok('package reason set', !!decision.reason?.includes('package'));
});

// =========================================================================
// Additional pure-helper coverage (no Admin/Crew/invoice tests)
// =========================================================================

test('9. Product identity uses product ID, not display name', () => {
  const cart: UnifiedCartItem[] = [makeProduct('other-id', 'Generator', 9500)];
  ok('not identified by name', getDirectGeneratorQuantity(cart, GEN_ID) === 0);
  ok('not has direct by name', cartHasDirectGenerator(cart, GEN_ID) === false);

  const cart2: UnifiedCartItem[] = [makeProduct(GEN_ID, 'My Custom Gen Name', 9500)];
  ok('identified by ID despite different name', getDirectGeneratorQuantity(cart2, GEN_ID) === 1);
  ok('has direct by ID', cartHasDirectGenerator(cart2, GEN_ID) === true);
});

test('10. Date validation', () => {
  ok('empty start invalid', isValidEventDateRange('', '2026-01-01') === false);
  ok('empty end invalid', isValidEventDateRange('2026-01-01', '') === false);
  ok('end before start invalid', isValidEventDateRange('2026-01-03', '2026-01-01') === false);
  ok('same day valid', isValidEventDateRange('2026-01-01', '2026-01-01') === true);
  ok('multi-day valid', isValidEventDateRange('2026-01-01', '2026-01-03') === true);
});

test('11. Direct product removal preserves other items', () => {
  const cart: UnifiedCartItem[] = [
    makeInflatable('u1', 15000),
    makeProduct(GEN_ID, 'Generator', 9500),
    makeProduct(CHAIR_ID, 'Tables', 5000),
  ];
  const result = removeDirectGeneratorProduct(cart, GEN_ID);
  ok('generator removed', !cartHasDirectGenerator(result, GEN_ID));
  ok('inflatable preserved', result.some(i => i.item_type === 'inflatable'));
  ok('chair preserved', result.some(i => (i as EventEssentialProductCartItem).product_id === CHAIR_ID));
});

test('12. Add-on pricing with a qualifying cart', () => {
  const productConfigs: Record<string, any> = {
    [GEN_ID]: makeProductConfig(GEN_ID, 'cat-gen', 9500, 5000, 10000),
  };
  const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
  const ctx = makeResolverContext(cart, productConfigs);
  const candidate = evaluateProductCandidate(ctx, { productId: GEN_ID, qty: 1 });
  const vm = deriveCandidateViewModel(candidate, false);
  ok('addon price state', vm.priceState === 'addon');
  ok('addon price = 5000', vm.resolvedPriceCents === 5000);
});

test('13. Standalone pricing without qualification', () => {
  const productConfigs: Record<string, any> = {
    [GEN_ID]: makeProductConfig(GEN_ID, 'cat-gen', 9500, 5000, 10000),
  };
  const cart: UnifiedCartItem[] = [];
  const ctx = makeResolverContext(cart, productConfigs);
  const candidate = evaluateProductCandidate(ctx, { productId: GEN_ID, qty: 1 });
  const vm = deriveCandidateViewModel(candidate, false);
  ok('standalone price state', vm.priceState === 'standalone');
  ok('standalone price = 9500', vm.resolvedPriceCents === 9500);
});

test('14. Legacy conversion readiness', () => {
  const before = shouldRunLegacyConversion({
    legacyStatePresent: true,
    alreadyHasDirect: false,
    conversionCompleted: false,
    conversionInFlight: false,
    configurationReady: true,
    isValidEventDateRange: false,
  });
  ok('not ready with invalid dates', before.ready === false);

  const after = shouldRunLegacyConversion({
    legacyStatePresent: true,
    alreadyHasDirect: false,
    conversionCompleted: false,
    conversionInFlight: false,
    configurationReady: true,
    isValidEventDateRange: true,
  });
  ok('ready after valid dates', after.ready === true);
});

test('15. decideLegacySync returns none before initialization', () => {
  const decision = decideLegacySync({
    isInitialized: false,
    hasLegacyState: true,
    directQty: 0,
    configurationReady: true,
  });
  ok('none before init', decision.action === 'none');
});

test('16. Inflatable-only cart remains unchanged', () => {
  const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeInflatable('u2', 20000)];
  ok('no direct generator', getDirectGeneratorQuantity(cart, GEN_ID) === 0);
  ok('no has direct', cartHasDirectGenerator(cart, GEN_ID) === false);
  const subtotal = cart
    .filter(i => i.item_type === 'inflatable' || i.item_type === undefined)
    .reduce((s, i) => s + (i as InflatableCartItem).unit_price_cents * (i as InflatableCartItem).qty, 0);
  ok('inflatable subtotal = 35000', subtotal === 35000);
});

// --- Runner ---

console.log('\nCustomer Quote/cart Generator tests:');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
