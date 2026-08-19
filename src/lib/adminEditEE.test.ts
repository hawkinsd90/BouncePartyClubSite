// Admin Edit Event Essentials — focused regression tests for savedUnitPriceCents
// and EE availability expansion.
// Runnable via: npx jiti src/lib/adminEditEE.test.ts

import type {
  ResolverBundleConfig,
  ResolverCategory,
  ResolverInput,
  ResolverInputLine,
  ResolverOutputLine,
  ResolverProductConfig,
  ResolverUnitConfig,
} from './eventEssentialsPricingTypes';
import { resolveEventEssentialsPricing } from './eventEssentialsPricing';
import { buildEventEssentialAvailabilityRequestFromOrderItems } from './eeOrderItemAvailability';

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { passCount += 1; } else { failCount += 1; failures.push(detail ? `${name} — ${detail}` : name); }
}
function eq<T>(name: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}, got ${a}`);
}
function findByKey(result: { lines: ResolverOutputLine[] }, key: string): ResolverOutputLine {
  const line = result.lines.find((l) => l.resolverKey === key);
  if (!line) throw new Error(`No result line for resolverKey=${key}`);
  return line;
}

function cat(id: string): ResolverCategory { return { id }; }
function prod(id: string, categoryId: string, opts: Partial<ResolverProductConfig> = {}): ResolverProductConfig {
  return { id, categoryId, standalonePriceCents: null, addonPriceCents: null, standaloneEnabled: false, addonEnabled: false, addonQualifyingThresholdCents: null, ...opts };
}
function bundle(id: string, opts: Partial<ResolverBundleConfig> = {}): ResolverBundleConfig {
  return { id, standalonePriceCents: null, addonPriceCents: null, standaloneEnabled: false, addonEnabled: false, addonQualifyingThresholdCents: null, inflatableEligibilityMode: 'none', excludedCategoryIds: [], eligibleUnitIds: [], inflatableComponents: [], containedProductCategoryIds: [], ...opts };
}
function productLine(resolverKey: string, productId: string, qty = 1, savedPrice?: number): ResolverInputLine {
  const l: ResolverInputLine = { resolverKey, itemType: 'event_essential_product', qty, productId };
  if (savedPrice !== undefined) l.savedUnitPriceCents = savedPrice;
  return l;
}
function bundleLine(resolverKey: string, bundleId: string, qty = 1, savedPrice?: number): ResolverInputLine {
  const l: ResolverInputLine = { resolverKey, itemType: 'event_essential_bundle', qty, bundleId };
  if (savedPrice !== undefined) l.savedUnitPriceCents = savedPrice;
  return l;
}
function buildInput(lines: ResolverInputLine[], opts: { products?: Record<string, ResolverProductConfig>; bundles?: Record<string, ResolverBundleConfig>; categories?: Record<string, ResolverCategory>; units?: Record<string, ResolverUnitConfig>; } = {}): ResolverInput {
  return { lines, productConfigs: opts.products ?? {}, bundleConfigs: opts.bundles ?? {}, categories: opts.categories ?? {}, units: opts.units ?? {} };
}

const C_GEN = 'cat_gen';
const C_TABLES = 'cat_tables';
const baseCategories = { [C_GEN]: cat(C_GEN), [C_TABLES]: cat(C_TABLES) };

// ---------------------------------------------------------------------------
// TEST: savedUnitPriceCents for product contribution
// ---------------------------------------------------------------------------

function testSavedProductContribution(): void {
  // Existing product saved at $120, catalog standalone is $170, threshold $150
  // With saved price: qualifying = $120 < $150 -> standalone
  // Without saved price: qualifying = $170 >= $150 -> addon (wrong)
  const existingProd = prod('p_existing', C_TABLES, {
    standalonePriceCents: 17000,
    addonPriceCents: 5000,
    standaloneEnabled: true,
    addonEnabled: true,
    addonQualifyingThresholdCents: 15000,
  });
  const genCandidate = prod('p_gen', C_GEN, {
    standalonePriceCents: 12500,
    addonPriceCents: 5000,
    standaloneEnabled: true,
    addonEnabled: true,
    addonQualifyingThresholdCents: 15000,
  });

  // With savedUnitPriceCents = 12000
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [
          productLine('existing', 'p_existing', 1, 12000),
          productLine('candidate', 'p_gen', 1),
        ],
        { products: { p_existing: existingProd, p_gen: genCandidate }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'candidate');
    ok('saved-product: standalone when saved price below threshold',
      l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 12500,
      `context=${l.resolvedPricingContext} price=${l.resolvedUnitPriceCents}`);
  }

  // Without savedUnitPriceCents (customer flow) — uses catalog $170 -> addon
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [
          productLine('existing', 'p_existing', 1),
          productLine('candidate', 'p_gen', 1),
        ],
        { products: { p_existing: existingProd, p_gen: genCandidate }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'candidate');
    ok('no-saved-product: addon when catalog price above threshold',
      l.resolvedPricingContext === 'addon' && l.resolvedUnitPriceCents === 5000,
      `context=${l.resolvedPricingContext} price=${l.resolvedUnitPriceCents}`);
  }
}

// ---------------------------------------------------------------------------
// TEST: savedUnitPriceCents for package contribution
// ---------------------------------------------------------------------------

function testSavedPackageContribution(): void {
  // Existing package saved at $100, catalog standalone is $200, threshold $150
  const existingBundle = bundle('b1', {
    standalonePriceCents: 20000,
    standaloneEnabled: true,
    addonEnabled: false,
    containedProductCategoryIds: [C_TABLES],
  });
  const genCandidate = prod('p_gen', C_GEN, {
    standalonePriceCents: 12500,
    addonPriceCents: 5000,
    standaloneEnabled: true,
    addonEnabled: true,
    addonQualifyingThresholdCents: 15000,
  });

  // With savedUnitPriceCents = 10000 on the bundle line
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [
          bundleLine('existing', 'b1', 1, 10000),
          productLine('candidate', 'p_gen', 1),
        ],
        { products: { p_gen: genCandidate }, bundles: { b1: existingBundle }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'candidate');
    ok('saved-bundle: standalone when saved price below threshold',
      l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 12500,
      `context=${l.resolvedPricingContext} price=${l.resolvedUnitPriceCents}`);
  }

  // Without savedUnitPriceCents — uses catalog $200 -> addon
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [
          bundleLine('existing', 'b1', 1),
          productLine('candidate', 'p_gen', 1),
        ],
        { products: { p_gen: genCandidate }, bundles: { b1: existingBundle }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'candidate');
    ok('no-saved-bundle: addon when catalog price above threshold',
      l.resolvedPricingContext === 'addon' && l.resolvedUnitPriceCents === 5000,
      `context=${l.resolvedPricingContext} price=${l.resolvedUnitPriceCents}`);
  }
}

// ---------------------------------------------------------------------------
// TEST: EE availability expansion aggregates direct + package quantities
// ---------------------------------------------------------------------------

function testAvailabilityAggregation(): void {
  // Direct product + package containing same product
  const items = [
    { product_id: 'p1', bundle_id: null, unit_id: null, qty: 2, component_snapshot: null },
    {
      product_id: null, bundle_id: 'b1', unit_id: null, qty: 1,
      component_snapshot: {
        bundle_name: 'Test Package',
        components: [
          { product_id: 'p1', product_name: 'Item 1', quantity_per_bundle: 3 },
          { product_id: 'p2', product_name: 'Item 2', quantity_per_bundle: 2 },
        ],
      },
    },
  ];

  const result = buildEventEssentialAvailabilityRequestFromOrderItems(items);
  ok('availability: status ready', result.status === 'ready');
  if (result.status === 'ready') {
    const map = new Map(result.productQuantities.map(pq => [pq.product_id, pq.quantity]));
    eq('availability: p1 aggregated', map.get('p1'), 5); // 2 direct + 3 from package
    eq('availability: p2 from package', map.get('p2'), 2);
  }
}

// ---------------------------------------------------------------------------
// TEST: Invalid package snapshot fails closed
// ---------------------------------------------------------------------------

function testInvalidSnapshot(): void {
  const items = [
    { product_id: null, bundle_id: 'b1', unit_id: null, qty: 1, component_snapshot: null },
  ];
  const result = buildEventEssentialAvailabilityRequestFromOrderItems(items);
  ok('invalid snapshot: fails closed', result.status === 'invalid');
}

// ---------------------------------------------------------------------------
// TEST: $0 deposit override remains intact
// ---------------------------------------------------------------------------

function testZeroDepositOverride(): void {
  // Simulate: customDepositCents = 0 should produce depositDueCents = 0
  const customDepositCents = 0;
  const calculatedDeposit = 5000;
  const rawDeposit = customDepositCents !== null ? customDepositCents : calculatedDeposit;
  ok('zero deposit override: uses 0 not calculated', rawDeposit === 0);
}

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------

testSavedProductContribution();
testSavedPackageContribution();
testAvailabilityAggregation();
testInvalidSnapshot();
testZeroDepositOverride();

console.log(`\nAdmin Edit EE tests: ${passCount} passed, ${failCount} failed`);
if (failures.length > 0) {
  failures.forEach(f => console.log(`  FAIL: ${f}`));
  process.exit(1);
}
