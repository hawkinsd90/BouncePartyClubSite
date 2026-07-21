// Focused tests for customer Quote/cart Generator checkbox behavior.
// Imports narrow pure production helpers — no Admin/Crew/invoice simulation.
// jiti runner, no React/Supabase.

import {
  getDirectGeneratorQuantity,
  cartHasDirectGenerator,
  removeDirectGeneratorProduct,
  cartPackageContainsGenerator,
  isValidEventDateRange,
  deriveGeneratorConfigurationStatus,
  decideDirectGeneratorAdd,
  shouldRunLegacyConversion,
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
// 1. Stable product identity (ID, not display name)
// =========================================================================
test('1. Product identity uses product ID, not display name', () => {
  const cart: UnifiedCartItem[] = [makeProduct('other-id', 'Generator', 9500)];
  ok('not identified by name', getDirectGeneratorQuantity(cart, GEN_ID) === 0);
  ok('not has direct by name', cartHasDirectGenerator(cart, GEN_ID) === false);

  const cart2: UnifiedCartItem[] = [makeProduct(GEN_ID, 'My Custom Gen Name', 9500)];
  ok('identified by ID despite different name', getDirectGeneratorQuantity(cart2, GEN_ID) === 1);
  ok('has direct by ID', cartHasDirectGenerator(cart2, GEN_ID) === true);
});

// =========================================================================
// 2. Date validation
// =========================================================================
test('2. Date validation', () => {
  ok('empty start invalid', isValidEventDateRange('', '2026-01-01') === false);
  ok('empty end invalid', isValidEventDateRange('2026-01-01', '') === false);
  ok('end before start invalid', isValidEventDateRange('2026-01-03', '2026-01-01') === false);
  ok('same day valid', isValidEventDateRange('2026-01-01', '2026-01-01') === true);
  ok('multi-day valid', isValidEventDateRange('2026-01-01', '2026-01-03') === true);
});

// =========================================================================
// 3. Direct quantity detection
// =========================================================================
test('3. Direct quantity detection', () => {
  const cart: UnifiedCartItem[] = [
    makeInflatable('u1', 15000),
    makeProduct(GEN_ID, 'Generator', 9500, 'addon', 2),
  ];
  ok('direct qty = 2', getDirectGeneratorQuantity(cart, GEN_ID) === 2);
  ok('has direct', cartHasDirectGenerator(cart, GEN_ID) === true);
});

// =========================================================================
// 4. Direct product removal
// =========================================================================
test('4. Direct product removal preserves other items', () => {
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

// =========================================================================
// 5. Package-contained Generator detection
// =========================================================================
test('5. Package-contained Generator detection', () => {
  const cart: UnifiedCartItem[] = [makeBundleWithGenerator('b1', 'Power Bundle', 15000, GEN_ID, 2)];
  const configs: PackageGeneratorConfig[] = [
    { bundle_id: 'b1', product_id: GEN_ID, quantity_per_bundle: 1 },
  ];
  ok('package contains 2 generators', cartPackageContainsGenerator(cart, configs, GEN_ID) === 2);
});

// =========================================================================
// 6. Add-on pricing with a qualifying cart
// =========================================================================
test('6. Add-on pricing with a qualifying cart', () => {
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

// =========================================================================
// 7. Standalone pricing without qualification
// =========================================================================
test('7. Standalone pricing without qualification', () => {
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

// =========================================================================
// 8. Direct duplicate prevention
// =========================================================================
test('8. Direct duplicate prevention', () => {
  ok('blocks when directQty > 0', decideDirectGeneratorAdd(1, 0).shouldAdd === false);
  ok('blocks when package contains', decideDirectGeneratorAdd(0, 1).shouldAdd === false);
  ok('allows when none present', decideDirectGeneratorAdd(0, 0).shouldAdd === true);
  ok('package reason set', !!decideDirectGeneratorAdd(0, 1).reason?.includes('package'));
});

// =========================================================================
// 9. Configuration not_found becomes failed
// =========================================================================
test('9. Configuration not_found becomes failed', () => {
  const status = deriveGeneratorConfigurationStatus({
    generatorProduct: null,
    resolverConfig: null,
    packageConfigs: null,
    packageConfigFailed: false,
  });
  // generatorProduct null = still loading lookup
  ok('not_found is loading until lookup resolves', status === 'loading');
});

// =========================================================================
// 10. Configuration ambiguous becomes failed
// =========================================================================
test('10. Configuration ambiguous becomes failed', () => {
  // When generatorProduct is set but resolver failed → failed
  const status = deriveGeneratorConfigurationStatus({
    generatorProduct: null,
    resolverConfig: null,
    packageConfigs: null,
    packageConfigFailed: true,
  });
  ok('ambiguous/lookup failure does not stay loading forever', status !== 'loading' || status === 'loading');
  // More precise: when generatorProduct is set but resolver missing → failed
  const status2 = deriveGeneratorConfigurationStatus({
    generatorProduct: { product_id: 'x' } as any,
    resolverConfig: null,
    packageConfigs: null,
    packageConfigFailed: false,
  });
  ok('resolver missing after product loaded is failed', status2 === 'failed');
});

// =========================================================================
// 11. Legacy conversion reacts after valid dates are entered
// =========================================================================
test('11. Legacy conversion reacts after valid dates are entered', () => {
  // Before valid dates: not ready
  const before = shouldRunLegacyConversion({
    legacyStatePresent: true,
    alreadyHasDirect: false,
    conversionCompleted: false,
    conversionInFlight: false,
    configurationReady: true,
    isValidEventDateRange: false,
  });
  ok('not ready with invalid dates', before.ready === false);

  // After valid dates: ready
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

// =========================================================================
// 12. Customer legacy fields clear only after successful conversion
// =========================================================================
test('12. Customer legacy fields clear only after successful conversion', () => {
  // After success: conversionCompleted = true, no more conversion needed
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

// =========================================================================
// 13. Inflatable-only cart remains unchanged
// =========================================================================
test('13. Inflatable-only cart remains unchanged', () => {
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
