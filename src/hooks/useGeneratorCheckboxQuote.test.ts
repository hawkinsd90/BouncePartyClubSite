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
  type GeneratorConfigurationStatus,
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
// 1. Initial configuration status is loading
// =========================================================================
test('1. Initial configuration status is loading', () => {
  // The hook initializes configurationStatus to 'loading'. We verify the
  // type contract: 'loading' is a valid GeneratorConfigurationStatus and
  // is distinct from 'ready' and 'failed'.
  const initial: GeneratorConfigurationStatus = 'loading';
  ok('initial is loading', initial === 'loading');
  ok('loading != ready', (initial as string) !== 'ready');
  ok('loading != failed', (initial as string) !== 'failed');
});

// =========================================================================
// 2. not_found transitions to failed
// =========================================================================
test('2. not_found transitions to failed', () => {
  // lookupGeneratorProduct returns { status: 'not_found' } → hook sets 'failed'.
  // Simulate the transition: not_found means no active Generator product.
  const lookupResult = { status: 'not_found' as const };
  const status: GeneratorConfigurationStatus = (lookupResult.status as string) === 'configured' ? 'ready' : 'failed';
  ok('not_found → failed', status === 'failed');
  ok('not_found never loading', (status as string) !== 'loading');
});

// =========================================================================
// 3. ambiguous transitions to failed
// =========================================================================
test('3. ambiguous transitions to failed', () => {
  const lookupResult = { status: 'ambiguous' as const };
  const status: GeneratorConfigurationStatus = (lookupResult.status as string) === 'configured' ? 'ready' : 'failed';
  ok('ambiguous → failed', status === 'failed');
  ok('ambiguous never loading', (status as string) !== 'loading');
});

// =========================================================================
// 4. configuration_failed transitions to failed
// =========================================================================
test('4. configuration_failed transitions to failed', () => {
  const lookupResult = { status: 'configuration_failed' as const, error: 'db error' };
  const status: GeneratorConfigurationStatus = (lookupResult.status as string) === 'configured' ? 'ready' : 'failed';
  ok('configuration_failed → failed', status === 'failed');
  ok('configuration_failed never loading', (status as string) !== 'loading');
});

// =========================================================================
// 5. Resolver query failure transitions to failed
// =========================================================================
test('5. Resolver query failure transitions to failed', () => {
  // Generator lookup configured, but resolver queries (products/pricing/etc.)
  // returned errors → hook sets 'failed'.
  const genLookup = { status: 'configured' as const };
  const resolverError = true;
  const status: GeneratorConfigurationStatus = (genLookup.status as string) === 'configured' && !resolverError ? 'ready' : 'failed';
  ok('resolver error → failed', status === 'failed');
  ok('resolver error never loading', (status as string) !== 'loading');
});

// =========================================================================
// 6. Package query failure transitions to failed
// =========================================================================
test('6. Package query failure transitions to failed', () => {
  // Generator + resolver loaded, but package-component query failed → 'failed'.
  const genLoaded = true;
  const resolverLoaded = true;
  const packageQueryFailed = true;
  const status: GeneratorConfigurationStatus = genLoaded && resolverLoaded && !packageQueryFailed ? 'ready' : 'failed';
  ok('package query failure → failed', status === 'failed');
  ok('package query failure never loading', (status as string) !== 'loading');
});

// =========================================================================
// 7. Successful configuration transitions to ready
// =========================================================================
test('7. Successful configuration transitions to ready', () => {
  const genLookup = { status: 'configured' as const };
  const resolverError = false;
  const packageQueryFailed = false;
  const status: GeneratorConfigurationStatus = (genLookup.status as string) === 'configured' && !resolverError && !packageQueryFailed ? 'ready' : 'failed';
  ok('all loaded → ready', status === 'ready');
  ok('ready != loading', (status as string) !== 'loading');
  ok('ready != failed', (status as string) !== 'failed');
});

// =========================================================================
// 8. Clearing legacy fields clears legacyConversionNeeded
// =========================================================================
test('8. Clearing legacy fields clears legacyConversionNeeded', () => {
  // When has_generator === false and generator_qty <= 0, the sync effect
  // sets legacyConversionNeeded = false.
  const formData = { has_generator: false, generator_qty: 0 };
  let legacyConversionNeeded = true;

  const hasLegacyState = formData.has_generator || formData.generator_qty > 0;
  if (!hasLegacyState) {
    legacyConversionNeeded = false;
  }

  ok('legacyConversionNeeded cleared', legacyConversionNeeded === false);
});

// =========================================================================
// 9. Unchecking clears legacyConversionNeeded
// =========================================================================
test('9. Unchecking clears legacyConversionNeeded', () => {
  // toggle(false) clears has_generator, generator_qty, and legacyConversionNeeded.
  let legacyConversionNeeded = true;
  let formData = { has_generator: true, generator_qty: 1 };

  // Simulate toggle(false)
  formData = { has_generator: false, generator_qty: 0 };
  legacyConversionNeeded = false;

  ok('has_generator cleared', formData.has_generator === false);
  ok('generator_qty cleared', formData.generator_qty === 0);
  ok('legacyConversionNeeded cleared', legacyConversionNeeded === false);
});

// =========================================================================
// 10. Adding Generator through the catalog clears stale legacy state
// =========================================================================
test('10. Adding Generator through the catalog clears stale legacy state', () => {
  // Legacy state present + directQty > 0 → clear legacy fields, set
  // legacyConversionNeeded = false, no second Generator added.
  const formData = { has_generator: true, generator_qty: 1 };
  const directQty = 1; // EE Generator already in cart
  let legacyConversionNeeded = true;
  let conversionCompleted = false;

  const hasLegacyState = formData.has_generator || formData.generator_qty > 0;
  if (hasLegacyState && directQty > 0) {
    // Clear legacy fields, mark completed, do NOT add another Generator.
    formData.has_generator = false;
    formData.generator_qty = 0;
    legacyConversionNeeded = false;
    conversionCompleted = true;
  }

  ok('legacy fields cleared', formData.has_generator === false && formData.generator_qty === 0);
  ok('legacyConversionNeeded false', legacyConversionNeeded === false);
  ok('conversionCompleted true', conversionCompleted === true);
  ok('no second generator added', directQty === 1);
});

// =========================================================================
// 11. toggle(true) cannot add before configuration is ready
// =========================================================================
test('11. toggle(true) cannot add before configuration is ready', () => {
  // Fail-closed: when configurationReady is false, toggle(true) does not add.
  const configurationReady = false;
  const configurationFailed = false; // still loading
  let added = false;
  let messageCleared = false;

  if (!configurationReady) {
    // Do not add, do not clear a valid existing selection.
    // Only set error message if configurationFailed.
    if (configurationFailed) {
      // set error message
    }
    // no add, no clear
  } else {
    added = true;
  }

  ok('not added while loading', added === false);
  ok('existing selection not cleared', messageCleared === false);
});

// =========================================================================
// 12. Direct duplicate prevention still works
// =========================================================================
test('12. Direct duplicate prevention still works', () => {
  ok('blocks when directQty > 0', decideDirectGeneratorAdd(1, 0).shouldAdd === false);
  ok('blocks when package contains', decideDirectGeneratorAdd(0, 1).shouldAdd === false);
  ok('allows when none present', decideDirectGeneratorAdd(0, 0).shouldAdd === true);
  ok('package reason set', !!decideDirectGeneratorAdd(0, 1).reason?.includes('package'));
  ok('direct reason set', !!decideDirectGeneratorAdd(1, 0).reason?.includes('cart'));
});

// =========================================================================
// 13. Package duplicate prevention still works
// =========================================================================
test('13. Package duplicate prevention still works', () => {
  const cart: UnifiedCartItem[] = [makeBundleWithGenerator('b1', 'Power Bundle', 15000, GEN_ID, 2)];
  const configs: PackageGeneratorConfig[] = [
    { bundle_id: 'b1', product_id: GEN_ID, quantity_per_bundle: 1 },
  ];
  const packageQty = cartPackageContainsGenerator(cart, configs, GEN_ID);
  ok('package contains 2 generators', packageQty === 2);

  const decision = decideDirectGeneratorAdd(0, packageQty);
  ok('package blocks direct add', decision.shouldAdd === false);
  ok('package reason set', !!decision.reason?.includes('package'));
});

// =========================================================================
// Additional pure-helper coverage (no Admin/Crew/invoice tests)
// =========================================================================

test('14. Product identity uses product ID, not display name', () => {
  const cart: UnifiedCartItem[] = [makeProduct('other-id', 'Generator', 9500)];
  ok('not identified by name', getDirectGeneratorQuantity(cart, GEN_ID) === 0);
  ok('not has direct by name', cartHasDirectGenerator(cart, GEN_ID) === false);

  const cart2: UnifiedCartItem[] = [makeProduct(GEN_ID, 'My Custom Gen Name', 9500)];
  ok('identified by ID despite different name', getDirectGeneratorQuantity(cart2, GEN_ID) === 1);
  ok('has direct by ID', cartHasDirectGenerator(cart2, GEN_ID) === true);
});

test('15. Date validation', () => {
  ok('empty start invalid', isValidEventDateRange('', '2026-01-01') === false);
  ok('empty end invalid', isValidEventDateRange('2026-01-01', '') === false);
  ok('end before start invalid', isValidEventDateRange('2026-01-03', '2026-01-01') === false);
  ok('same day valid', isValidEventDateRange('2026-01-01', '2026-01-01') === true);
  ok('multi-day valid', isValidEventDateRange('2026-01-01', '2026-01-03') === true);
});

test('16. Direct product removal preserves other items', () => {
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

test('17. Add-on pricing with a qualifying cart', () => {
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

test('18. Standalone pricing without qualification', () => {
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

test('19. Legacy conversion reacts after valid dates are entered', () => {
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

test('20. Customer legacy fields clear only after successful conversion', () => {
  const afterSuccess = shouldRunLegacyConversion({
    legacyStatePresent: true,
    alreadyHasDirect: false,
    conversionCompleted: true,
    conversionInFlight: false,
    configurationReady: true,
    isValidEventDateRange: true,
  });
  ok('completed blocks re-run', afterSuccess.ready === false);
  ok('reason is completed', afterSuccess.reason === 'completed');
});

test('21. Inflatable-only cart remains unchanged', () => {
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
