// Stage E1 — Deterministic test harness for the Event Essentials resolver.
//
// No Supabase. No Dev database. No browser. No network. Hardcoded fixtures
// only. Runnable via: npx jiti src/lib/eventEssentialsPricing.test.ts
//
// The harness is a tiny custom runner (no vitest/jest dependency) that records
// pass/fail per scenario and exits non-zero on any failure.

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

// ---------------------------------------------------------------------------
// Tiny test harness.
// ---------------------------------------------------------------------------

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

function eq<T>(name: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}, got ${a}`);
}

function findByKey(result: { lines: ResolverOutputLine[] }, key: string): ResolverOutputLine {
  const line = result.lines.find((l) => l.resolverKey === key);
  if (!line) throw new Error(`No result line for resolverKey=${key}`);
  return line;
}

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

function cat(id: string): ResolverCategory {
  return { id };
}

function unit(id: string, active = true): ResolverUnitConfig {
  return { id, active };
}

function prod(
  id: string,
  categoryId: string,
  opts: Partial<ResolverProductConfig> = {},
): ResolverProductConfig {
  return {
    id,
    categoryId,
    standalonePriceCents: null,
    addonPriceCents: null,
    standaloneEnabled: false,
    addonEnabled: false,
    addonQualifyingThresholdCents: null,
    ...opts,
  };
}

function bundle(
  id: string,
  opts: Partial<ResolverBundleConfig> = {},
): ResolverBundleConfig {
  return {
    id,
    standalonePriceCents: null,
    addonPriceCents: null,
    standaloneEnabled: false,
    addonEnabled: false,
    addonQualifyingThresholdCents: null,
    inflatableEligibilityMode: 'none',
    excludedCategoryIds: [],
    eligibleUnitIds: [],
    inflatableComponents: [],
    containedProductCategoryIds: [],
    ...opts,
  };
}

function inflatableLine(
  resolverKey: string,
  unitId: string,
  selectedUnitPriceCents: number,
  qty = 1,
  wetOrDry: 'dry' | 'water' = 'dry',
): ResolverInputLine {
  return {
    resolverKey,
    itemType: 'inflatable',
    qty,
    unitId,
    selectedUnitPriceCents,
    wetOrDry,
  };
}

/** Build an inflatable line with explicit field overrides (for malformed fixtures).
 *  Defaults use U_TROPICAL (present in baseUnits) so overrides can target a
 *  single field without triggering an unrelated UNIT_UNKNOWN failure. */
function inflateRaw(resolverKey: string, overrides: Partial<ResolverInputLine>): ResolverInputLine {
  return { resolverKey, itemType: 'inflatable', qty: 1, unitId: U_TROPICAL, selectedUnitPriceCents: 1000, wetOrDry: 'dry', ...overrides };
}

function productLine(resolverKey: string, productId: string, qty = 1): ResolverInputLine {
  return { resolverKey, itemType: 'event_essential_product', qty, productId };
}

function bundleLine(resolverKey: string, bundleId: string, qty = 1): ResolverInputLine {
  return { resolverKey, itemType: 'event_essential_bundle', qty, bundleId };
}

function buildInput(
  lines: ResolverInputLine[],
  opts: {
    products?: Record<string, ResolverProductConfig>;
    bundles?: Record<string, ResolverBundleConfig>;
    categories?: Record<string, ResolverCategory>;
    units?: Record<string, ResolverUnitConfig>;
  } = {},
): ResolverInput {
  return {
    lines,
    productConfigs: opts.products ?? {},
    bundleConfigs: opts.bundles ?? {},
    categories: opts.categories ?? {},
    units: opts.units ?? {},
  };
}

// ---------------------------------------------------------------------------
// Fixtures used across scenarios.
// ---------------------------------------------------------------------------

const C_TABLES = 'cat_tables';
const C_CHAIRS = 'cat_chairs';
const C_MISC = 'cat_misc';

const U_TROPICAL = 'unit_tropical';
const U_SLIDE = 'unit_slide';

const P_TABLES = prod('p_tables', C_TABLES, {
  standalonePriceCents: 10000,
  addonPriceCents: 7000,
  standaloneEnabled: true,
  addonEnabled: true,
  addonQualifyingThresholdCents: 15000,
});
const P_CHAIRS = prod('p_chairs', C_CHAIRS, {
  standalonePriceCents: 5000,
  addonPriceCents: 3000,
  standaloneEnabled: true,
  addonEnabled: true,
  addonQualifyingThresholdCents: 10000,
});
const baseCategories = {
  [C_TABLES]: cat(C_TABLES),
  [C_CHAIRS]: cat(C_CHAIRS),
  [C_MISC]: cat(C_MISC),
};
const baseUnits = {
  [U_TROPICAL]: unit(U_TROPICAL, true),
  [U_SLIDE]: unit(U_SLIDE, true),
};

// ===========================================================================
// PRODUCT PRICING
// ===========================================================================

function testProductPricing(): void {
  // 1. Add-on disabled, standalone valid.
  {
    const cfg = prod('p1', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: false,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k1', 'p1')], { products: { p1: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k1');
    ok('1 addon-disabled standalone', l.selectable === true && l.selectableReason === 'OK' && l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 10000 && l.addonQualified === false);
  }

  // 2. Standalone-only product.
  {
    const cfg = prod('p2', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: false,
      addonPriceCents: 6000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k2', 'p2')], { products: { p2: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k2');
    ok('2 standalone-only', l.resolvedPricingContext === 'standalone' && !l.addonQualified && l.selectableReason === 'OK');
  }

  // 3. Add-on enabled, threshold NULL, standalone valid -> standalone + warning.
  {
    const cfg = prod('p3', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: null,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k3', 'p3')], { products: { p3: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k3');
    ok('3 null-threshold standalone fallback', l.selectable && l.selectableReason === 'OK' && l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 10000 && l.configurationWarning === 'ADDON_THRESHOLD_MISSING' && !l.addonQualified);
  }

  // 4. Add-on enabled, threshold NULL, no standalone -> invalid.
  {
    const cfg = prod('p4', C_TABLES, {
      standalonePriceCents: null,
      standaloneEnabled: false,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: null,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k4', 'p4')], { products: { p4: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k4');
    ok('4 null-threshold no-standalone invalid', !l.selectable && l.selectableReason === 'ADDON_THRESHOLD_MISSING_NO_STANDALONE' && l.invalidReason === 'ADDON_THRESHOLD_MISSING_NO_STANDALONE' && l.resolvedPricingContext === null);
  }

  // 5. Explicit threshold 0.
  {
    const cfg = prod('p5', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 0,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k5', 'p5')], { products: { p5: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k5');
    ok('5 threshold-zero qualifies', l.addonQualified && l.resolvedPricingContext === 'addon' && l.resolvedUnitPriceCents === 6000 && l.remainingAmountCents === 0);
  }

  // 6. Below threshold.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k6', 'p_tables', 1), inflatableLine('k6inf', U_TROPICAL, 5000)],
        { products: { p_tables: P_TABLES }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k6');
    ok('6 below threshold -> standalone', !l.addonQualified && l.resolvedPricingContext === 'standalone' && l.remainingAmountCents === 10000 && l.qualifyingSubtotalCents === 5000);
  }

  // 7. Exactly at threshold.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k7', 'p_tables', 1), inflatableLine('k7inf', U_TROPICAL, 15000)],
        { products: { p_tables: P_TABLES }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k7');
    ok('7 exactly at threshold -> addon', l.addonQualified && l.resolvedPricingContext === 'addon' && l.remainingAmountCents === 0 && l.qualifyingSubtotalCents === 15000);
  }

  // 8. Above threshold.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k8', 'p_tables', 1), inflatableLine('k8inf', U_TROPICAL, 20000)],
        { products: { p_tables: P_TABLES }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k8');
    ok('8 above threshold -> addon', l.addonQualified && l.resolvedPricingContext === 'addon' && l.remainingAmountCents === 0);
  }

  // 9. Own-category spending excluded.
  {
    const sameCat = prod('p_same', C_TABLES, {
      standalonePriceCents: 5000,
      standaloneEnabled: true,
      addonEnabled: false,
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k9', 'p_tables', 1), productLine('k9other', 'p_same', 3)],
        { products: { p_tables: P_TABLES, p_same: sameCat }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k9');
    ok('9 own-category excluded', l.qualifyingSubtotalCents === 0 && !l.addonQualified && l.remainingAmountCents === 15000);
  }

  // 10. Cross-category product spending included.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k10', 'p_tables', 1), productLine('k10chairs', 'p_chairs', 3)],
        { products: { p_tables: P_TABLES, p_chairs: P_CHAIRS }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k10');
    ok('10 cross-category included', l.qualifyingSubtotalCents === 15000 && l.addonQualified);
  }

  // 11. Candidate does not qualify itself.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k11', 'p_tables', 10)], { products: { p_tables: P_TABLES }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k11');
    ok('11 no self-qualification', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 12. Quantity multiplication.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k12', 'p_tables', 1), productLine('k12chairs', 'p_chairs', 3)],
        { products: { p_tables: P_TABLES, p_chairs: P_CHAIRS }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k12');
    ok('12 qty multiplication', l.qualifyingSubtotalCents === 15000);
  }

  // 13. Direct inflatable contribution.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k13', 'p_tables', 1), inflatableLine('k13inf', U_TROPICAL, 15000)],
        { products: { p_tables: P_TABLES }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k13');
    ok('13 inflatable contributes', l.qualifyingSubtotalCents === 15000 && l.addonQualified);
  }

  // 14. Package contribution excluded.
  {
    const b = bundle('b14', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14', 'p_tables', 1), bundleLine('k14b', 'b14', 1)],
        { products: { p_tables: P_TABLES }, bundles: { b14: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k14');
    ok('14 package excluded', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 14a. Package with unrelated component categories qualifies a normal product.
  // Celebration Seating (contains Tables+Chairs) qualifies a Generator candidate.
  {
    const b = bundle('b14a', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [C_TABLES, C_CHAIRS],
    });
    const genCat = 'cat_generators';
    const gen = prod('p_gen', genCat, {
      standalonePriceCents: 20000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 10000,
      addonQualifyingThresholdCents: 15000,
    });
    const cats = { ...baseCategories, [genCat]: { id: genCat } as ResolverCategory };
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14a', 'p_gen', 1), bundleLine('k14ab', 'b14a', 1)],
        { products: { p_gen: gen }, bundles: { b14a: b }, categories: cats },
      ),
    );
    const l = findByKey(r, 'k14a');
    ok('14a package qualifies product', l.qualifyingSubtotalCents === 15000 && l.addonQualified && l.resolvedPricingContext === 'addon' && l.resolvedUnitPriceCents === 10000);
  }

  // 14b. Package qty multiplication — 2 packages contribute 2x standalone price.
  {
    const b = bundle('b14b', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [C_TABLES, C_CHAIRS],
    });
    const genCat = 'cat_generators';
    const gen = prod('p_gen2', genCat, {
      standalonePriceCents: 20000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 10000,
      addonQualifyingThresholdCents: 25000,
    });
    const cats = { ...baseCategories, [genCat]: { id: genCat } as ResolverCategory };
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14b', 'p_gen2', 1), bundleLine('k14bb', 'b14b', 2)],
        { products: { p_gen2: gen }, bundles: { b14b: b }, categories: cats },
      ),
    );
    const l = findByKey(r, 'k14b');
    ok('14b package qty multiplication', l.qualifyingSubtotalCents === 30000 && l.addonQualified);
  }

  // 14c. Package containing candidate's category does NOT qualify it.
  // Package contains Tables; candidate is a Tables product -> contributes $0.
  {
    const b = bundle('b14c', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [C_TABLES, C_CHAIRS],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14c', 'p_tables', 1), bundleLine('k14cb', 'b14c', 1)],
        { products: { p_tables: P_TABLES }, bundles: { b14c: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k14c');
    ok('14c package same-category excluded', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 14d. Package with only unrelated categories qualifies a Chairs product.
  {
    const b = bundle('b14d', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [C_TABLES, 'cat_generators'],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14d', 'p_chairs', 1), bundleLine('k14db', 'b14d', 1)],
        { products: { p_chairs: P_CHAIRS }, bundles: { b14d: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k14d');
    ok('14d package unrelated categories qualifies chairs', l.qualifyingSubtotalCents === 15000 && l.addonQualified);
  }

  // 14e. Add-on-priced stored package still contributes authoritative standalone value.
  {
    const b = bundle('b14e', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 8000,
      addonQualifyingThresholdCents: 10000,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [C_TABLES, C_CHAIRS],
    });
    const genCat = 'cat_generators';
    const gen = prod('p_gen3', genCat, {
      standalonePriceCents: 20000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 10000,
      addonQualifyingThresholdCents: 15000,
    });
    const cats = { ...baseCategories, [genCat]: { id: genCat } as ResolverCategory };
    // Bundle stored at add-on price 8000; must contribute 15000 (standalone), not 8000.
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14e', 'p_gen3', 1), bundleLine('k14eb', 'b14e', 1)],
        { products: { p_gen3: gen }, bundles: { b14e: b }, categories: cats },
      ),
    );
    const l = findByKey(r, 'k14e');
    ok('14e addon-priced package contributes standalone', l.qualifyingSubtotalCents === 15000 && l.addonQualified);
  }

  // 14f. Malformed package component category (empty array) contributes zero.
  {
    const b = bundle('b14f', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [], // malformed/missing
    });
    const genCat = 'cat_generators';
    const gen = prod('p_gen4', genCat, {
      standalonePriceCents: 20000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 10000,
      addonQualifyingThresholdCents: 15000,
    });
    const cats = { ...baseCategories, [genCat]: { id: genCat } as ResolverCategory };
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14f', 'p_gen4', 1), bundleLine('k14fb', 'b14f', 1)],
        { products: { p_gen4: gen }, bundles: { b14f: b }, categories: cats },
      ),
    );
    const l = findByKey(r, 'k14f');
    ok('14f malformed package contributes zero', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 14g. Package still contributes zero toward a package candidate.
  {
    const bContrib = bundle('b14g_contrib', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [C_TABLES, C_CHAIRS],
    });
    const bCand = bundle('b14g_cand', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k14g', 'b14g_cand', 1), bundleLine('k14gcontrib', 'b14g_contrib', 1)],
        { bundles: { b14g_cand: bCand, b14g_contrib: bContrib }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k14g');
    ok('14g package zero toward package candidate', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 14h. No package self-qualification (package line cannot qualify itself as product).
  {
    const b = bundle('b14h', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [C_TABLES],
    });
    // Only the package itself in cart, no product candidate — but verify
    // a product in the SAME category as the package components is not qualified
    // by the package (self-qualification guard is the candidate-skip by position).
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14h', 'p_tables', 1), bundleLine('k14hb', 'b14h', 1)],
        { products: { p_tables: P_TABLES }, bundles: { b14h: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k14h');
    // Package contains Tables, candidate is Tables -> excluded.
    ok('14h no package self-qualification', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 14i. Existing inflatable qualification unchanged when package also present.
  {
    const b = bundle('b14i', {
      standalonePriceCents: 15000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      containedProductCategoryIds: [C_TABLES, C_CHAIRS],
    });
    const genCat = 'cat_generators';
    const gen = prod('p_gen5', genCat, {
      standalonePriceCents: 20000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 10000,
      addonQualifyingThresholdCents: 30000,
    });
    const cats = { ...baseCategories, [genCat]: { id: genCat } as ResolverCategory };
    // Inflatable 15000 + package 15000 = 30000, meets threshold 30000.
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k14i', 'p_gen5', 1), inflatableLine('k14inf', U_TROPICAL, 15000), bundleLine('k14ib', 'b14i', 1)],
        { products: { p_gen5: gen }, bundles: { b14i: b }, categories: cats, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k14i');
    ok('14i inflatable+package combined qualification', l.qualifyingSubtotalCents === 30000 && l.addonQualified);
  }

  // 15. Loss of qualification falls back to standalone.
  {
    const withInf = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k15', 'p_tables', 1), inflatableLine('k15inf', U_TROPICAL, 15000)],
        { products: { p_tables: P_TABLES }, categories: baseCategories, units: baseUnits },
      ),
    );
    const withoutInf = resolveEventEssentialsPricing(
      buildInput([productLine('k15', 'p_tables', 1)], { products: { p_tables: P_TABLES }, categories: baseCategories }),
    );
    ok('15a with-inflatable addon', findByKey(withInf, 'k15').addonQualified);
    const l = findByKey(withoutInf, 'k15');
    ok('15b fallback to standalone', !l.addonQualified && l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 10000);
  }

  // 16. Loss of qualification without standalone becomes invalid.
  {
    const cfg = prod('p16', C_TABLES, {
      standalonePriceCents: null,
      standaloneEnabled: false,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 15000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k16', 'p16', 1)], { products: { p16: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k16');
    ok('16 no-standalone invalid', !l.selectable && l.selectableReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED' && l.invalidReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED' && l.remainingAmountCents === 15000);
  }

  // 17. Two cross-category products mutually qualify using fixed standalone values.
  {
    const cfgA = prod('p_a', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 8000,
    });
    const cfgB = prod('p_b', C_CHAIRS, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 8000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k17a', 'p_a', 1), productLine('k17b', 'p_b', 1)],
        { products: { p_a: cfgA, p_b: cfgB }, categories: baseCategories },
      ),
    );
    const a = findByKey(r, 'k17a');
    const b = findByKey(r, 'k17b');
    ok('17a A qualified by B', a.addonQualified && a.resolvedPricingContext === 'addon');
    ok('17b B qualified by A', b.addonQualified && b.resolvedPricingContext === 'addon');
  }

  // 18. Discounted resolved value does not reduce the fixed qualification contribution.
  {
    const cfgA = prod('p_a2', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 0,
    });
    const cfgB = prod('p_b2', C_CHAIRS, {
      standalonePriceCents: 20000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 14000,
      addonQualifyingThresholdCents: 10000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k18a', 'p_a2', 1), productLine('k18b', 'p_b2', 1)],
        { products: { p_a2: cfgA, p_b2: cfgB }, categories: baseCategories },
      ),
    );
    const a = findByKey(r, 'k18a');
    const b = findByKey(r, 'k18b');
    ok('18a A resolved addon', a.addonQualified && a.resolvedUnitPriceCents === 6000);
    ok('18b B sees A standalone value', b.qualifyingSubtotalCents === 10000 && b.addonQualified);
  }

  // 18c. Malformed contributing product (missing category) does not count toward product qualification.
  {
    const bad = prod('p_bad', 'cat_missing', {
      standalonePriceCents: 20000,
      standaloneEnabled: true,
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k18c', 'p_tables', 1), productLine('k18cbad', 'p_bad', 1)],
        { products: { p_tables: P_TABLES, p_bad: bad }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k18c');
    ok('18c malformed product contributor excluded', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 18d. Malformed contributing product (mismatched category id) does not count.
  {
    const bad = prod('p_bad2', C_CHAIRS, { standalonePriceCents: 20000, standaloneEnabled: true });
    const cats = { ...baseCategories, [C_CHAIRS]: { id: 'wrong_id' } as ResolverCategory };
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k18d', 'p_tables', 1), productLine('k18dbad', 'p_bad2', 1)],
        { products: { p_tables: P_TABLES, p_bad2: bad }, categories: cats },
      ),
    );
    const l = findByKey(r, 'k18d');
    ok('18d mismatched-category contributor excluded', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 18e. Malformed contributing product (invalid standalone price) does not count.
  {
    const bad = prod('p_bad3', C_CHAIRS, { standalonePriceCents: -5, standaloneEnabled: true });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k18e', 'p_tables', 1), productLine('k18ebad', 'p_bad3', 1)],
        { products: { p_tables: P_TABLES, p_bad3: bad }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k18e');
    ok('18e invalid-price contributor excluded', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }
}

// ===========================================================================
// PACKAGE PRICING
// ===========================================================================

function testPackagePricing(): void {
  // 19. Package add-on disabled.
  {
    const b = bundle('b19', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: false,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k19', 'b19', 1)], { bundles: { b19: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k19');
    ok('19 addon-disabled standalone', l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 30000 && !l.addonQualified && l.selectableReason === 'OK');
  }

  // 20. Explicit package threshold 0.
  {
    const b = bundle('b20', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 0,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k20', 'b20', 1)], { bundles: { b20: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k20');
    ok('20 threshold-zero qualifies', l.addonQualified && l.resolvedPricingContext === 'addon' && l.remainingAmountCents === 0);
  }

  // 21. Package threshold NULL with standalone fallback.
  {
    const b = bundle('b21', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: null,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k21', 'b21', 1)], { bundles: { b21: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k21');
    ok('21 null-threshold standalone fallback', l.selectable && l.resolvedPricingContext === 'standalone' && l.configurationWarning === 'ADDON_THRESHOLD_MISSING');
  }

  // 22. Package threshold NULL without standalone.
  {
    const b = bundle('b22', {
      standalonePriceCents: null,
      standaloneEnabled: false,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: null,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k22', 'b22', 1)], { bundles: { b22: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k22');
    ok('22 null-threshold no-standalone invalid', !l.selectable && l.selectableReason === 'ADDON_THRESHOLD_MISSING_NO_STANDALONE' && l.invalidReason === 'ADDON_THRESHOLD_MISSING_NO_STANDALONE');
  }

  // 23. Below threshold.
  {
    const b = bundle('b23', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k23', 'b23', 1), inflatableLine('k23inf', U_TROPICAL, 10000)], { bundles: { b23: b }, categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k23');
    ok('23 below threshold -> standalone', !l.addonQualified && l.resolvedPricingContext === 'standalone' && l.remainingAmountCents === 5000);
  }

  // 24. Exactly at threshold.
  {
    const b = bundle('b24', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k24', 'b24', 1), inflatableLine('k24inf', U_TROPICAL, 15000)], { bundles: { b24: b }, categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k24');
    ok('24 at threshold -> addon', l.addonQualified && l.remainingAmountCents === 0);
  }

  // 25. Excluded categories ignored.
  {
    const b = bundle('b25', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
      excludedCategoryIds: [C_CHAIRS],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k25', 'b25', 1), productLine('k25chairs', 'p_chairs', 5)],
        { products: { p_chairs: P_CHAIRS }, bundles: { b25: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k25');
    ok('25 excluded category ignored', l.qualifyingSubtotalCents === 0 && !l.addonQualified && l.remainingAmountCents === 15000);
  }

  // 26. Non-excluded categories included.
  {
    const b = bundle('b26', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
      excludedCategoryIds: [C_CHAIRS],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k26', 'b26', 1), productLine('k26tables', 'p_tables', 2)],
        { products: { p_tables: P_TABLES }, bundles: { b26: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k26');
    ok('26 non-excluded included', l.qualifyingSubtotalCents === 20000 && l.addonQualified);
  }

  // 27. Candidate package does not qualify itself.
  {
    const b = bundle('b27', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 5000,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k27', 'b27', 5)], { bundles: { b27: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k27');
    ok('27 no self-qualification', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 28. Other packages do not qualify package.
  {
    const b = bundle('b28', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const other = bundle('b28other', {
      standalonePriceCents: 50000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k28', 'b28', 1), bundleLine('k28other', 'b28other', 1)],
        { bundles: { b28: b, b28other: other }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k28');
    ok('28 packages do not qualify packages', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 29. Packages do not qualify products.
  {
    const b = bundle('b29', {
      standalonePriceCents: 50000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k29', 'p_tables', 1), bundleLine('k29b', 'b29', 1)],
        { products: { p_tables: P_TABLES }, bundles: { b29: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k29');
    ok('29 packages do not qualify products', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 30. Product quantity contributes correctly.
  {
    const b = bundle('b30', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 30000,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k30', 'b30', 1), productLine('k30tables', 'p_tables', 3)],
        { products: { p_tables: P_TABLES }, bundles: { b30: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k30');
    ok('30 product qty contributes', l.qualifyingSubtotalCents === 30000 && l.addonQualified);
  }

  // 31. Direct inflatable contributes.
  {
    const b = bundle('b31', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k31', 'b31', 1), inflatableLine('k31inf', U_TROPICAL, 15000)],
        { bundles: { b31: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k31');
    ok('31 inflatable contributes', l.qualifyingSubtotalCents === 15000 && l.addonQualified);
  }

  // 32. Package lines are never decomposed by E1.
  // E1 does not receive decomposed package component lines. Package lines
  // contribute zero toward qualification. Package inflatable component
  // metadata is used only for customer_choice detection. Package
  // decomposition remains deferred to a later stage.
  {
    const b2 = bundle('b32b', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const r2 = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k32x', 'b32b', 1), productLine('k32prod', 'p_tables', 1)],
        { products: { p_tables: P_TABLES }, bundles: { b32b: b2 }, categories: baseCategories },
      ),
    );
    const prodLine = findByKey(r2, 'k32prod');
    ok('32 package line contributes zero toward product', prodLine.qualifyingSubtotalCents === 0 && !prodLine.addonQualified);
  }

  // 32b. Malformed contributing product (missing category) does not count toward package qualification.
  {
    const b = bundle('b32b2', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const bad = prod('p_bad_pkg', 'cat_missing', { standalonePriceCents: 20000, standaloneEnabled: true });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k32b2', 'b32b2', 1), productLine('k32b2bad', 'p_bad_pkg', 1)],
        { products: { p_bad_pkg: bad }, bundles: { b32b2: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k32b2');
    ok('32b malformed product contributor excluded from package', l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 33. Loss of qualification falls back to standalone.
  {
    const b = bundle('b33', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const withInf = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k33', 'b33', 1), inflatableLine('k33inf', U_TROPICAL, 15000)],
        { bundles: { b33: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const withoutInf = resolveEventEssentialsPricing(
      buildInput([bundleLine('k33', 'b33', 1)], { bundles: { b33: b }, categories: baseCategories }),
    );
    ok('33a with-inflatable addon', findByKey(withInf, 'k33').addonQualified);
    const l = findByKey(withoutInf, 'k33');
    ok('33b fallback standalone', !l.addonQualified && l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 30000);
  }

  // 34. Loss without standalone becomes invalid.
  {
    const b = bundle('b34', {
      standalonePriceCents: null,
      standaloneEnabled: false,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k34', 'b34', 1)], { bundles: { b34: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k34');
    ok('34 no-standalone invalid', !l.selectable && l.selectableReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED' && l.invalidReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED' && l.remainingAmountCents === 15000);
  }
}

// ===========================================================================
// PACKAGE PREREQUISITES
// ===========================================================================

function testPackagePrerequisites(): void {
  // 35. none with no inflatable -> met.
  {
    const b = bundle('b35', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k35', 'b35', 1)], { bundles: { b35: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k35');
    ok('35 none met', l.prerequisiteMet && l.selectable && l.resolvedPricingContext === 'standalone');
  }

  // 36. any with no direct inflatable -> not met.
  {
    const b = bundle('b36', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k36', 'b36', 1)], { bundles: { b36: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k36');
    ok('36 any no-inflatable not met', !l.prerequisiteMet && !l.selectable && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE' && l.resolvedPricingContext === null);
  }

  // 37. any with valid direct inflatable qty > 0 -> met.
  {
    const b = bundle('b37', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k37', 'b37', 1), inflatableLine('k37inf', U_TROPICAL, 15000)],
        { bundles: { b37: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k37');
    ok('37 any with-valid-inflatable met', l.prerequisiteMet && l.selectable);
  }

  // 38. any with direct inflatable qty 0 -> not met (qty 0 invalid as candidate; not valid as prereq satisfier).
  {
    const b = bundle('b38', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k38', 'b38', 1), inflatableLine('k38inf', U_TROPICAL, 15000, 0)],
        { bundles: { b38: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k38');
    ok('38 any qty-zero not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }

  // 39. selected with nonmatching direct inflatable -> not met.
  {
    const b = bundle('b39', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k39', 'b39', 1), inflatableLine('k39inf', U_SLIDE, 15000)],
        { bundles: { b39: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k39');
    ok('39 selected nonmatching not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_MATCHING_UNIT');
  }

  // 40. selected with matching active direct inflatable -> met.
  {
    const b = bundle('b40', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k40', 'b40', 1), inflatableLine('k40inf', U_TROPICAL, 15000)],
        { bundles: { b40: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k40');
    ok('40 selected matching active met', l.prerequisiteMet && l.selectable);
  }

  // 41. selected with multiple direct inflatables and one match -> met.
  {
    const b = bundle('b41', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k41', 'b41', 1), inflatableLine('k41a', U_SLIDE, 15000), inflatableLine('k41b', U_TROPICAL, 15000)],
        { bundles: { b41: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k41');
    ok('41 selected one-match met', l.prerequisiteMet);
  }

  // 42. selected with matching inactive unit -> not met + inactive warning.
  {
    const b = bundle('b42', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k42', 'b42', 1), inflatableLine('k42inf', U_TROPICAL, 15000)],
        { bundles: { b42: b }, categories: baseCategories, units: { [U_TROPICAL]: unit(U_TROPICAL, false) } },
      ),
    );
    const l = findByKey(r, 'k42');
    ok('42 selected inactive not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'UNIT_INACTIVE' && l.configurationWarning === 'SELECTED_MODE_UNIT_INACTIVE' && !l.selectable);
  }

  // 43. selected with no configured unit IDs -> not met + no-units warning.
  {
    const b = bundle('b43', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k43', 'b43', 1), inflatableLine('k43inf', U_TROPICAL, 15000)],
        { bundles: { b43: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k43');
    ok('43 selected no-units not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_ELIGIBLE_UNITS_CONFIGURED' && l.configurationWarning === 'SELECTED_MODE_NO_UNITS' && !l.selectable);
  }

  // 44. Unknown eligible unit.
  {
    const b = bundle('b44', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: ['unit_does_not_exist'],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k44', 'b44', 1), inflatableLine('k44inf', U_TROPICAL, 15000)],
        { bundles: { b44: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k44');
    ok('44 unknown eligible unit not met', !l.prerequisiteMet && l.configurationWarning === 'SELECTED_MODE_UNKNOWN_UNIT');
  }

  // 45. Package included inflatable does not satisfy its own any prerequisite.
  {
    const b = bundle('b45', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
      inflatableComponents: [{ selectionMode: 'dry' }],
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k45', 'b45', 1)], { bundles: { b45: b }, categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k45');
    ok('45 own component does not satisfy any', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE' && !l.selectable);
  }

  // 46. Package included inflatable does not satisfy its own selected prerequisite.
  {
    const b = bundle('b46', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'selected',
      eligibleUnitIds: [U_TROPICAL],
      inflatableComponents: [{ selectionMode: 'dry' }],
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k46', 'b46', 1)], { bundles: { b46: b }, categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k46');
    ok('46 own component does not satisfy selected', !l.prerequisiteMet && !l.selectable);
  }

  // 47. Inflatable inside another package does not satisfy prerequisite.
  {
    const b = bundle('b47', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const other = bundle('b47other', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      inflatableComponents: [{ selectionMode: 'dry' }],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k47', 'b47', 1), bundleLine('k47other', 'b47other', 1)],
        { bundles: { b47: b, b47other: other }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k47');
    ok('47 other-package inflatable does not satisfy', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }

  // 48. Failed prerequisite blocks package despite valid standalone price.
  {
    const b = bundle('b48', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 0,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k48', 'b48', 1)], { bundles: { b48: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k48');
    ok('48 failed prereq blocks despite standalone', !l.selectable && l.resolvedPricingContext === null && l.resolvedUnitPriceCents === null && l.prerequisiteMet === false);
  }

  // 48a. any with unknown unit -> prerequisite not met.
  {
    const b = bundle('b48a', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k48a', 'b48a', 1), inflatableLine('k48ainf', 'unit_unknown', 15000)],
        { bundles: { b48a: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k48a');
    ok('48a any unknown-unit inflatable not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }

  // 48b. any with inactive unit -> prerequisite not met.
  {
    const b = bundle('b48b', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k48b', 'b48b', 1), inflatableLine('k48binf', U_TROPICAL, 15000)],
        { bundles: { b48b: b }, categories: baseCategories, units: { [U_TROPICAL]: unit(U_TROPICAL, false) } },
      ),
    );
    const l = findByKey(r, 'k48b');
    ok('48b any inactive-unit inflatable not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }

  // 48c. any with missing unitId -> prerequisite not met.
  {
    const b = bundle('b48c', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k48c', 'b48c', 1), inflateRaw('k48cinf', { unitId: undefined })],
        { bundles: { b48c: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k48c');
    ok('48c any missing-unitId inflatable not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }

  // 48d. any with invalid price -> prerequisite not met.
  {
    const b = bundle('b48d', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k48d', 'b48d', 1), inflateRaw('k48dinf', { selectedUnitPriceCents: -5 })],
        { bundles: { b48d: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k48d');
    ok('48d any invalid-price inflatable not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }

  // 48e. any with missing wetOrDry -> prerequisite not met.
  {
    const b = bundle('b48e', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k48e', 'b48e', 1), inflateRaw('k48einf', { wetOrDry: undefined })],
        { bundles: { b48e: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k48e');
    ok('48e any missing-mode inflatable not met', !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }
}

// ===========================================================================
// CONFIGURATION AND METADATA
// ===========================================================================

function testConfigurationAndMetadata(): void {
  // 49. Missing add-on price with standalone fallback.
  {
    const cfg = prod('p49', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: null,
      addonQualifyingThresholdCents: 15000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k49', 'p49', 1)], { products: { p49: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k49');
    ok('49 missing addon price -> standalone warning', l.selectable && l.resolvedPricingContext === 'standalone' && l.configurationWarning === 'ADDON_PRICE_MISSING');
  }

  // 50. Missing add-on price without standalone.
  {
    const cfg = prod('p50', C_TABLES, {
      standalonePriceCents: null,
      standaloneEnabled: false,
      addonEnabled: true,
      addonPriceCents: null,
      addonQualifyingThresholdCents: 15000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k50', 'p50', 1)], { products: { p50: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k50');
    ok('50 missing addon price no-standalone invalid', !l.selectable && l.selectableReason === 'ADDON_PRICE_MISSING_NO_STANDALONE' && l.invalidReason === 'ADDON_PRICE_MISSING_NO_STANDALONE');
  }

  // 51. No purchase path.
  {
    const cfg = prod('p51', C_TABLES, {
      standalonePriceCents: null,
      standaloneEnabled: false,
      addonEnabled: false,
      addonPriceCents: null,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k51', 'p51', 1)], { products: { p51: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k51');
    ok('51 no purchase path', !l.selectable && l.selectableReason === 'NO_PURCHASE_PATH' && l.invalidReason === 'NO_PURCHASE_PATH');
  }

  // 52. Missing product config.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k52', 'p_missing', 1)], { categories: baseCategories }),
    );
    const l = findByKey(r, 'k52');
    ok('52 missing product config', !l.selectable && l.selectableReason === 'PRODUCT_CONFIG_MISSING' && l.invalidReason === 'PRODUCT_CONFIG_MISSING');
  }

  // 53. Missing bundle config.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k53', 'b_missing', 1)], { categories: baseCategories }),
    );
    const l = findByKey(r, 'k53');
    ok('53 missing bundle config', !l.selectable && l.selectableReason === 'BUNDLE_CONFIG_MISSING' && l.invalidReason === 'BUNDLE_CONFIG_MISSING');
  }

  // 54. Missing category.
  {
    const cfg = prod('p54', 'cat_missing', {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k54', 'p54', 1)], { products: { p54: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k54');
    ok('54 missing category', !l.selectable && l.selectableReason === 'CATEGORY_MISSING' && l.invalidReason === 'CATEGORY_MISSING');
  }

  // 55. Negative quantity.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k55', 'p_tables', -1)], { products: { p_tables: P_TABLES }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k55');
    ok('55 negative qty invalid', !l.selectable && l.selectableReason === 'INVALID_QUANTITY' && l.invalidReason === 'INVALID_QUANTITY');
  }

  // 56. Zero quantity is now INVALID (was previously selectable).
  {
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k56', 'p_tables', 0), inflatableLine('k56inf', U_TROPICAL, 15000)], { products: { p_tables: P_TABLES }, categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k56');
    ok('56 zero-qty product invalid', !l.selectable && l.selectableReason === 'INVALID_QUANTITY' && l.invalidReason === 'INVALID_QUANTITY');
  }

  // 56b. Zero-qty bundle invalid.
  {
    const b56b = bundle('b56b', { standalonePriceCents: 30000, standaloneEnabled: true, inflatableEligibilityMode: 'none' });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k56b', 'b56b', 0)], { bundles: { b56b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k56b');
    ok('56b zero-qty bundle invalid', !l.selectable && l.invalidReason === 'INVALID_QUANTITY');
  }

  // 56c. Zero-qty inflatable invalid (and does not contribute/satisfy prereq).
  {
    const b56c = bundle('b56c', { standalonePriceCents: 30000, standaloneEnabled: true, inflatableEligibilityMode: 'any' });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k56c', 'b56c', 1), inflatableLine('k56cinf', U_TROPICAL, 15000, 0)], { bundles: { b56c }, categories: baseCategories, units: baseUnits }),
    );
    const inf = findByKey(r, 'k56cinf');
    const pkg = findByKey(r, 'k56c');
    ok('56c zero-qty inflatable invalid', !inf.selectable && inf.invalidReason === 'INVALID_QUANTITY');
    ok('56c2 zero-qty inflatable does not satisfy prereq', !pkg.prerequisiteMet && pkg.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }

  // 57. Unknown item type.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([{ resolverKey: 'k57', itemType: 'something_else' as never, qty: 1 }], { categories: baseCategories }),
    );
    const l = findByKey(r, 'k57');
    ok('57 unknown item type', !l.selectable && l.selectableReason === 'UNKNOWN_ITEM_TYPE' && l.invalidReason === 'UNKNOWN_ITEM_TYPE');
  }

  // 58. customer_choice produces requiresCustomerChoice true.
  {
    const b = bundle('b58', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      inflatableComponents: [{ selectionMode: 'customer_choice' as const }],
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k58', 'b58', 1)], { bundles: { b58: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k58');
    ok('58 customer_choice flag', l.requiresCustomerChoice === true && l.selectable && l.customerMessageCode === 'CUSTOMER_CHOICE_REQUIRED');
  }

  // 59. dry/water-only components produce requiresCustomerChoice false.
  {
    const b = bundle('b59', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      inflatableEligibilityMode: 'none',
      inflatableComponents: [{ selectionMode: 'dry' as const }, { selectionMode: 'water' as const }],
    });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k59', 'b59', 1)], { bundles: { b59: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k59');
    ok('59 no customer_choice', l.requiresCustomerChoice === false);
  }

  // 60. Inflatable validation: unknown unit.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([inflatableLine('k60', 'unit_unknown', 15000)], { categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k60');
    ok('60 inflatable unknown unit invalid', !l.selectable && l.selectableReason === 'INFLATABLE_UNIT_UNKNOWN' && l.invalidReason === 'INFLATABLE_UNIT_UNKNOWN');
  }

  // 61. Inflatable validation: inactive unit.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([inflatableLine('k61', U_TROPICAL, 15000)], { categories: baseCategories, units: { [U_TROPICAL]: unit(U_TROPICAL, false) } }),
    );
    const l = findByKey(r, 'k61');
    ok('61 inflatable inactive unit invalid', !l.selectable && l.selectableReason === 'INFLATABLE_UNIT_INACTIVE' && l.invalidReason === 'INFLATABLE_UNIT_INACTIVE');
  }

  // 62. Inflatable validation: missing unitId.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([inflateRaw('k62', { unitId: undefined })], { categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k62');
    ok('62 inflatable missing unitId invalid', !l.selectable && l.selectableReason === 'INFLATABLE_UNIT_MISSING' && l.invalidReason === 'INFLATABLE_UNIT_MISSING');
  }

  // 63. Inflatable validation: invalid price.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([inflateRaw('k63', { selectedUnitPriceCents: -5 })], { categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k63');
    ok('63 inflatable invalid price invalid', !l.selectable && l.selectableReason === 'INFLATABLE_PRICE_INVALID' && l.invalidReason === 'INFLATABLE_PRICE_INVALID');
  }

  // 64. Inflatable validation: missing wetOrDry.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([inflateRaw('k64', { wetOrDry: undefined })], { categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k64');
    ok('64 inflatable missing mode invalid', !l.selectable && l.selectableReason === 'INFLATABLE_MODE_MISSING' && l.invalidReason === 'INFLATABLE_MODE_MISSING');
  }

  // 65. Product config id mismatch with map key.
  {
    const cfg = prod('wrong_id', C_TABLES, { standalonePriceCents: 10000, standaloneEnabled: true });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k65', 'p_mismatch', 1)], { products: { p_mismatch: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k65');
    ok('65 product config id mismatch', !l.selectable && l.selectableReason === 'PRODUCT_CONFIG_ID_MISMATCH' && l.invalidReason === 'PRODUCT_CONFIG_ID_MISMATCH');
  }

  // 66. Bundle config id mismatch with map key.
  {
    const b = bundle('wrong_id', { standalonePriceCents: 30000, standaloneEnabled: true, inflatableEligibilityMode: 'none' });
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k66', 'b_mismatch', 1)], { bundles: { b_mismatch: b }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k66');
    ok('66 bundle config id mismatch', !l.selectable && l.selectableReason === 'BUNDLE_CONFIG_ID_MISMATCH' && l.invalidReason === 'BUNDLE_CONFIG_ID_MISMATCH');
  }

  // 67. Category id mismatch with map key.
  {
    const cfg = prod('p67', C_CHAIRS, { standalonePriceCents: 10000, standaloneEnabled: true });
    const cats = { ...baseCategories, [C_CHAIRS]: { id: 'wrong_id' } as ResolverCategory };
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k67', 'p67', 1)], { products: { p67: cfg }, categories: cats }),
    );
    const l = findByKey(r, 'k67');
    ok('67 category id mismatch', !l.selectable && l.selectableReason === 'CATEGORY_ID_MISMATCH' && l.invalidReason === 'CATEGORY_ID_MISMATCH');
  }

  // 68. Invalid (non-missing) add-on threshold with standalone fallback.
  {
    const cfg = prod('p68', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: -100,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k68', 'p68', 1)], { products: { p68: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k68');
    ok('68 invalid threshold -> standalone warning', l.selectable && l.resolvedPricingContext === 'standalone' && l.configurationWarning === 'ADDON_THRESHOLD_INVALID');
  }

  // 69. Invalid add-on threshold without standalone -> fatal.
  {
    const cfg = prod('p69', C_TABLES, {
      standalonePriceCents: null,
      standaloneEnabled: false,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: -100,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k69', 'p69', 1)], { products: { p69: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k69');
    ok('69 invalid threshold no-standalone fatal', !l.selectable && l.selectableReason === 'ADDON_THRESHOLD_INVALID_NO_STANDALONE' && l.invalidReason === 'ADDON_THRESHOLD_INVALID_NO_STANDALONE');
  }

  // 70. Invalid add-on price with standalone fallback.
  {
    const cfg = prod('p70', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: -5,
      addonQualifyingThresholdCents: 15000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k70', 'p70', 1)], { products: { p70: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k70');
    ok('70 invalid addon price -> standalone warning', l.selectable && l.resolvedPricingContext === 'standalone' && l.configurationWarning === 'ADDON_PRICE_INVALID');
  }

  // 71. Invalid standalone price (enabled, malformed) -> fatal.
  {
    const cfg = prod('p71', C_TABLES, {
      standalonePriceCents: -5,
      standaloneEnabled: true,
      addonEnabled: false,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k71', 'p71', 1)], { products: { p71: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k71');
    ok('71 invalid standalone price fatal', !l.selectable && l.selectableReason === 'STANDALONE_PRICE_INVALID' && l.invalidReason === 'STANDALONE_PRICE_INVALID');
  }

  // 72. Unsafe quantity (> Number.MAX_SAFE_INTEGER) invalid.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k72', 'p_tables', Number.MAX_SAFE_INTEGER + 2)], { products: { p_tables: P_TABLES }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k72');
    ok('72 unsafe quantity invalid', !l.selectable && l.invalidReason === 'INVALID_QUANTITY');
  }

  // 73. Unsafe price invalid.
  {
    const cfg = prod('p73', C_TABLES, {
      standalonePriceCents: Number.MAX_SAFE_INTEGER + 2,
      standaloneEnabled: true,
      addonEnabled: false,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k73', 'p73', 1)], { products: { p73: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k73');
    ok('73 unsafe price invalid', !l.selectable && (l.invalidReason === 'STANDALONE_PRICE_INVALID' || l.invalidReason === 'NO_PURCHASE_PATH'));
  }

  // 74. Multiplication overflow is a fatal QUALIFYING_SUBTOTAL_OVERFLOW (not zero).
  {
    const huge = prod('p_huge', C_CHAIRS, {
      standalonePriceCents: Number.MAX_SAFE_INTEGER,
      standaloneEnabled: true,
      addonEnabled: false,
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k74', 'p_tables', 1), productLine('k74huge', 'p_huge', 2)],
        { products: { p_tables: P_TABLES, p_huge: huge }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'k74');
    ok('74 multiplication overflow fatal', !l.selectable && l.selectableReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' && l.invalidReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' && l.resolvedPricingContext === null && l.resolvedUnitPriceCents === null && l.qualifyingSubtotalCents === null && !l.addonQualified && l.customerMessageCode === 'NOT_AVAILABLE');
  }
}

// ===========================================================================
// CORRECTED BEHAVIORS — overflow, invalid-standalone/add-on ordering,
// selected prerequisite diagnostics, unit map-id mismatch.
// ===========================================================================

function testCorrectedBehaviors(): void {
  // ---- 1. QUALIFYING_SUBTOTAL_OVERFLOW ----

  // A. One product contribution multiplication overflow.
  {
    const huge = prod('p_huge_a', C_CHAIRS, {
      standalonePriceCents: Number.MAX_SAFE_INTEGER,
      standaloneEnabled: true,
      addonEnabled: false,
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('kA', 'p_tables', 1), productLine('kAhuge', 'p_huge_a', 2)],
        { products: { p_tables: P_TABLES, p_huge_a: huge }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'kA');
    ok('overflow-A product mul overflow fatal',
      !l.selectable && l.selectableReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' &&
      l.invalidReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' &&
      l.resolvedPricingContext === null && l.resolvedUnitPriceCents === null &&
      l.qualifyingSubtotalCents === null && !l.addonQualified &&
      l.customerMessageCode === 'NOT_AVAILABLE');
  }

  // B. One inflatable contribution multiplication overflow.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('kB', 'p_tables', 1),
         inflatableLine('kBinf', U_TROPICAL, Number.MAX_SAFE_INTEGER, 2)],
        { products: { p_tables: P_TABLES }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'kB');
    ok('overflow-B inflatable mul overflow fatal',
      !l.selectable && l.selectableReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' &&
      l.invalidReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' &&
      l.qualifyingSubtotalCents === null);
  }

  // C. Two individually safe contributions whose sum overflows.
  {
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 10;
    const big1 = prod('p_big1', C_CHAIRS, { standalonePriceCents: half, standaloneEnabled: true, addonEnabled: false });
    const big2 = prod('p_big2', C_MISC, { standalonePriceCents: half, standaloneEnabled: true, addonEnabled: false });
    const cats = { ...baseCategories, [C_MISC]: cat(C_MISC) };
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('kC', 'p_tables', 1), productLine('kC1', 'p_big1', 1), productLine('kC2', 'p_big2', 1)],
        { products: { p_tables: P_TABLES, p_big1: big1, p_big2: big2 }, categories: cats },
      ),
    );
    const l = findByKey(r, 'kC');
    ok('overflow-C sum overflow fatal',
      !l.selectable && l.selectableReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' &&
      l.invalidReason === 'QUALIFYING_SUBTOTAL_OVERFLOW');
  }

  // D. Package qualifying-subtotal overflow.
  {
    const b = bundle('b_ovl_d', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'none',
    });
    const huge = prod('p_huge_d', C_CHAIRS, {
      standalonePriceCents: Number.MAX_SAFE_INTEGER,
      standaloneEnabled: true,
      addonEnabled: false,
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('kD', 'b_ovl_d', 1), productLine('kDhuge', 'p_huge_d', 2)],
        { products: { p_huge_d: huge }, bundles: { b_ovl_d: b }, categories: baseCategories },
      ),
    );
    const l = findByKey(r, 'kD');
    ok('overflow-D package subtotal overflow fatal',
      !l.selectable && l.selectableReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' &&
      l.invalidReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' &&
      l.resolvedPricingContext === null && l.qualifyingSubtotalCents === null);
  }

  // E. Product qualifying-subtotal overflow via inflatable contribution.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('kE', 'p_tables', 1),
         inflatableLine('kEinf', U_TROPICAL, Number.MAX_SAFE_INTEGER, 2),
         productLine('kE2', 'p_chairs', 1)],
        { products: { p_tables: P_TABLES, p_chairs: P_CHAIRS }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'kE');
    ok('overflow-E product via inflatable overflow fatal',
      !l.selectable && l.selectableReason === 'QUALIFYING_SUBTOTAL_OVERFLOW' &&
      l.invalidReason === 'QUALIFYING_SUBTOTAL_OVERFLOW');
  }

  // ---- 2. VALID ADD-ON PATH MUST NOT BE BLOCKED BY INVALID STANDALONE ----

  // A. Standalone enabled but invalid, add-on valid, threshold met -> addon + warning.
  {
    const cfg = prod('p_isv_a', C_TABLES, {
      standalonePriceCents: -5,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 15000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('kISV_A', 'p_isv_a', 1), inflatableLine('kISV_Ainf', U_TROPICAL, 15000)],
        { products: { p_isv_a: cfg }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'kISV_A');
    ok('isv-A invalid standalone + qualified addon -> addon',
      l.selectable && l.addonQualified && l.resolvedPricingContext === 'addon' &&
      l.resolvedUnitPriceCents === 6000 && l.configurationWarning === 'STANDALONE_PRICE_INVALID' &&
      l.invalidReason === null && l.selectableReason === 'OK');
  }

  // B. Standalone enabled but invalid, add-on valid, threshold not met, no valid standalone -> fatal.
  {
    const cfg = prod('p_isv_b', C_TABLES, {
      standalonePriceCents: -5,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 15000,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('kISV_B', 'p_isv_b', 1)], { products: { p_isv_b: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'kISV_B');
    ok('isv-B invalid standalone + unmet threshold -> fatal STANDALONE_PRICE_INVALID',
      !l.selectable && !l.addonQualified && l.resolvedPricingContext === null &&
      l.resolvedUnitPriceCents === null && l.remainingAmountCents === 15000 &&
      l.invalidReason === 'STANDALONE_PRICE_INVALID' && l.selectableReason === 'STANDALONE_PRICE_INVALID');
  }

  // C. Standalone enabled but invalid, add-on valid, explicit threshold 0 -> addon + warning.
  {
    const cfg = prod('p_isv_c', C_TABLES, {
      standalonePriceCents: -5,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 0,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('kISV_C', 'p_isv_c', 1)], { products: { p_isv_c: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'kISV_C');
    ok('isv-C invalid standalone + threshold-0 -> addon',
      l.selectable && l.addonQualified && l.resolvedPricingContext === 'addon' &&
      l.resolvedUnitPriceCents === 6000 && l.configurationWarning === 'STANDALONE_PRICE_INVALID' &&
      l.invalidReason === null);
  }

  // D. Standalone enabled but invalid, add-on disabled -> fatal STANDALONE_PRICE_INVALID.
  {
    const cfg = prod('p_isv_d', C_TABLES, {
      standalonePriceCents: -5,
      standaloneEnabled: true,
      addonEnabled: false,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('kISV_D', 'p_isv_d', 1)], { products: { p_isv_d: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'kISV_D');
    ok('isv-D invalid standalone + addon disabled -> fatal',
      !l.selectable && l.invalidReason === 'STANDALONE_PRICE_INVALID' &&
      l.selectableReason === 'STANDALONE_PRICE_INVALID');
  }

  // D2. Standalone enabled but invalid, add-on enabled but threshold missing, no standalone -> fatal.
  {
    const cfg = prod('p_isv_d2', C_TABLES, {
      standalonePriceCents: -5,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: null,
    });
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('kISV_D2', 'p_isv_d2', 1)], { products: { p_isv_d2: cfg }, categories: baseCategories }),
    );
    const l = findByKey(r, 'kISV_D2');
    ok('isv-D2 invalid standalone + addon threshold missing -> fatal STANDALONE_PRICE_INVALID',
      !l.selectable && l.invalidReason === 'STANDALONE_PRICE_INVALID' &&
      l.selectableReason === 'STANDALONE_PRICE_INVALID');
  }

  // ---- 3. RESTORED INACTIVE-SELECTED-UNIT DIAGNOSTICS ----

  // 3a. Selected matching line with inactive unit -> UNIT_INACTIVE (even though line invalid).
  {
    const b = bundle('b_prereq_3a', {
      standalonePriceCents: 30000, standaloneEnabled: true,
      inflatableEligibilityMode: 'selected', eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k3a', 'b_prereq_3a', 1),
         inflatableLine('k3ainf', U_TROPICAL, 15000)],
        { bundles: { b_prereq_3a: b }, categories: baseCategories, units: { [U_TROPICAL]: unit(U_TROPICAL, false) } },
      ),
    );
    const l = findByKey(r, 'k3a');
    ok('prereq-3a inactive matching unit -> UNIT_INACTIVE',
      !l.prerequisiteMet && l.prerequisiteFailureReason === 'UNIT_INACTIVE' &&
      l.configurationWarning === 'SELECTED_MODE_UNIT_INACTIVE' && !l.selectable);
  }

  // 3b. Selected matching line with invalid price -> NO_MATCHING_UNIT (line invalid, not satisfying).
  {
    const b = bundle('b_prereq_3b', {
      standalonePriceCents: 30000, standaloneEnabled: true,
      inflatableEligibilityMode: 'selected', eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k3b', 'b_prereq_3b', 1),
         inflateRaw('k3binf', { selectedUnitPriceCents: -5 })],
        { bundles: { b_prereq_3b: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k3b');
    ok('prereq-3b matching line invalid price -> not met',
      !l.prerequisiteMet && !l.selectable);
  }

  // 3c. Selected matching line with missing mode -> not met.
  {
    const b = bundle('b_prereq_3c', {
      standalonePriceCents: 30000, standaloneEnabled: true,
      inflatableEligibilityMode: 'selected', eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k3c', 'b_prereq_3c', 1),
         inflateRaw('k3cinf', { wetOrDry: undefined })],
        { bundles: { b_prereq_3c: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k3c');
    ok('prereq-3c matching line missing mode -> not met',
      !l.prerequisiteMet && !l.selectable);
  }

  // 3d. Selected matching line with unknown unit -> UNKNOWN_ELIGIBLE_UNIT if eligible id unknown,
  //     else NO_MATCHING_UNIT (line's unitId not in eligible set).
  {
    const b = bundle('b_prereq_3d', {
      standalonePriceCents: 30000, standaloneEnabled: true,
      inflatableEligibilityMode: 'selected', eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k3d', 'b_prereq_3d', 1),
         inflatableLine('k3dinf', 'unit_unknown', 15000)],
        { bundles: { b_prereq_3d: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    const l = findByKey(r, 'k3d');
    ok('prereq-3d unknown-unit matching line -> not met',
      !l.prerequisiteMet && !l.selectable);
  }

  // 3e. Selected eligible unit id with map-id mismatch -> UNKNOWN_ELIGIBLE_UNIT.
  {
    const b = bundle('b_prereq_3e', {
      standalonePriceCents: 30000, standaloneEnabled: true,
      inflatableEligibilityMode: 'selected', eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k3e', 'b_prereq_3e', 1),
         inflatableLine('k3einf', U_TROPICAL, 15000)],
        { bundles: { b_prereq_3e: b }, categories: baseCategories,
          units: { [U_TROPICAL]: { id: 'wrong_id', active: true } } },
      ),
    );
    const l = findByKey(r, 'k3e');
    ok('prereq-3e eligible unit map-id mismatch -> UNKNOWN_ELIGIBLE_UNIT',
      !l.prerequisiteMet && l.prerequisiteFailureReason === 'UNKNOWN_ELIGIBLE_UNIT' &&
      l.configurationWarning === 'SELECTED_MODE_UNKNOWN_UNIT' && !l.selectable);
  }

  // 3f. any-mode with an inactive matching unit (line invalid) -> NO_DIRECT_INFLATABLE
  //     (any mode only counts valid lines; inactive line is not valid).
  {
    const b = bundle('b_prereq_3f', {
      standalonePriceCents: 30000, standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k3f', 'b_prereq_3f', 1),
         inflatableLine('k3finf', U_TROPICAL, 15000)],
        { bundles: { b_prereq_3f: b }, categories: baseCategories, units: { [U_TROPICAL]: unit(U_TROPICAL, false) } },
      ),
    );
    const l = findByKey(r, 'k3f');
    ok('prereq-3f any + inactive line -> NO_DIRECT_INFLATABLE',
      !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE' && !l.selectable);
  }

  // ---- 5. UNIT MAP-ID-MISMATCH COVERAGE ----

  // 5a. Direct inflatable with map-id-mismatched unit is unselectable.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [inflatableLine('k5a', U_TROPICAL, 15000)],
        { categories: baseCategories, units: { [U_TROPICAL]: { id: 'wrong_id', active: true } } },
      ),
    );
    const l = findByKey(r, 'k5a');
    ok('unitmismatch-5a inflatable unselectable',
      !l.selectable && l.selectableReason === 'INFLATABLE_UNIT_UNKNOWN' &&
      l.resolvedUnitPriceCents === null);
  }

  // 5b. Map-mismatched inflatable does not contribute toward product qualification.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k5b', 'p_tables', 1),
         inflatableLine('k5binf', U_TROPICAL, 15000)],
        { products: { p_tables: P_TABLES }, categories: baseCategories,
          units: { [U_TROPICAL]: { id: 'wrong_id', active: true } } },
      ),
    );
    const l = findByKey(r, 'k5b');
    ok('unitmismatch-5b does not contribute',
      l.qualifyingSubtotalCents === 0 && !l.addonQualified);
  }

  // 5c. Map-mismatched inflatable does not satisfy any prerequisite.
  {
    const b = bundle('b_5c', {
      standalonePriceCents: 30000, standaloneEnabled: true,
      inflatableEligibilityMode: 'any',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k5c', 'b_5c', 1),
         inflatableLine('k5cinf', U_TROPICAL, 15000)],
        { bundles: { b_5c: b }, categories: baseCategories,
          units: { [U_TROPICAL]: { id: 'wrong_id', active: true } } },
      ),
    );
    const l = findByKey(r, 'k5c');
    ok('unitmismatch-5c does not satisfy any prereq',
      !l.prerequisiteMet && l.prerequisiteFailureReason === 'NO_DIRECT_INFLATABLE');
  }

  // 5d. Map-mismatched inflatable does not satisfy selected prerequisite.
  {
    const b = bundle('b_5d', {
      standalonePriceCents: 30000, standaloneEnabled: true,
      inflatableEligibilityMode: 'selected', eligibleUnitIds: [U_TROPICAL],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k5d', 'b_5d', 1),
         inflatableLine('k5dinf', U_TROPICAL, 15000)],
        { bundles: { b_5d: b }, categories: baseCategories,
          units: { [U_TROPICAL]: { id: 'wrong_id', active: true } } },
      ),
    );
    const l = findByKey(r, 'k5d');
    ok('unitmismatch-5d does not satisfy selected prereq',
      !l.prerequisiteMet && !l.selectable);
  }
}

// ===========================================================================
// DETERMINISM
// ===========================================================================

function testDeterminism(): void {
  const cfgA = prod('pA', C_TABLES, {
    standalonePriceCents: 10000,
    standaloneEnabled: true,
    addonEnabled: true,
    addonPriceCents: 6000,
    addonQualifyingThresholdCents: 8000,
  });
  const cfgB = prod('pB', C_CHAIRS, {
    standalonePriceCents: 10000,
    standaloneEnabled: true,
    addonEnabled: true,
    addonPriceCents: 6000,
    addonQualifyingThresholdCents: 8000,
  });
  const b1 = bundle('b1', {
    standalonePriceCents: 30000,
    standaloneEnabled: true,
    addonEnabled: true,
    addonPriceCents: 20000,
    addonQualifyingThresholdCents: 15000,
    inflatableEligibilityMode: 'any',
  });
  const lines: ResolverInputLine[] = [
    productLine('kA', 'pA', 1),
    productLine('kB', 'pB', 1),
    bundleLine('kB1', 'b1', 1),
    inflatableLine('kInf', U_TROPICAL, 15000),
  ];
  const sharedInput = buildInput(lines, {
    products: { pA: cfgA, pB: cfgB },
    bundles: { b1 },
    categories: baseCategories,
    units: baseUnits,
  });

  // 75. Reordering input lines produces equivalent keyed results.
  {
    const order1 = resolveEventEssentialsPricing(sharedInput);
    const shuffled: ResolverInput = {
      ...sharedInput,
      lines: [...sharedInput.lines].reverse(),
    };
    const order2 = resolveEventEssentialsPricing(shuffled);
    const map1 = new Map(order1.lines.map((l) => [l.resolverKey, l]));
    const map2 = new Map(order2.lines.map((l) => [l.resolverKey, l]));
    let same = map1.size === map2.size;
    for (const [k, v1] of map1) {
      const v2 = map2.get(k);
      if (!v2 || JSON.stringify(v1) !== JSON.stringify(v2)) {
        same = false;
        break;
      }
    }
    ok('75 reorder equivalent', same);
  }

  // 76. Repeating resolver with same input produces deep-equal output.
  {
    const r1 = resolveEventEssentialsPricing(sharedInput);
    const r2 = resolveEventEssentialsPricing(sharedInput);
    eq('76 idempotent deep-equal', r1, r2);
  }

  // 77. Results preserve resolverKey.
  {
    const r = resolveEventEssentialsPricing(sharedInput);
    const keys = r.lines.map((l) => l.resolverKey).sort();
    const expected = ['kA', 'kB', 'kB1', 'kInf'].sort();
    eq('77 resolverKey preserved', keys, expected);
  }

  // 78. Duplicate product input lines are resolved independently.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k78', 'pA', 1), productLine('k78', 'pA', 1)],
        { products: { pA: cfgA, pB: cfgB }, categories: baseCategories },
      ),
    );
    ok('78 duplicate resolverKey both resolved', r.lines.length === 2 && r.lines.every((l) => l.resolverKey === 'k78'));
    // Same product same category -> neither qualifies the other. Both standalone.
    ok('78b duplicate independent standalone', r.lines.every((l) => !l.addonQualified && l.resolvedPricingContext === 'standalone'));
  }

  // 79. Distinct lines sharing resolverKey: self-exclusion by position, not key.
  // Two distinct products sharing a resolverKey must each still be evaluated
  // against the other (cross-category) without incorrectly excluding both.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k79', 'pA', 1), productLine('k79', 'pB', 1)],
        { products: { pA: cfgA, pB: cfgB }, categories: baseCategories },
      ),
    );
    // Both share resolverKey 'k79' but are different products (cross-category).
    // Each should see the other's contribution and qualify (threshold 8000,
    // standalone 10000 >= 8000). Position-based self-exclusion means line 0
    // excludes only line 0, and line 1 excludes only line 1.
    ok('79 shared-key cross-category both qualify', r.lines.length === 2 && r.lines.every((l) => l.addonQualified && l.resolvedPricingContext === 'addon'));
  }

  // 80. Package lines never create circular qualification.
  {
    const bp = bundle('bp', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 10000,
      inflatableEligibilityMode: 'none',
    });
    const bq = bundle('bq', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 10000,
      inflatableEligibilityMode: 'none',
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k80p', 'bp', 1), bundleLine('k80q', 'bq', 1)],
        { bundles: { bp, bq }, categories: baseCategories },
      ),
    );
    const p = findByKey(r, 'k80p');
    const q = findByKey(r, 'k80q');
    ok('80 no circular package qualification', !p.addonQualified && !q.addonQualified && p.qualifyingSubtotalCents === 0 && q.qualifyingSubtotalCents === 0);
  }

  // 81. Product cross-category qualification remains stable after both receive add-on pricing.
  {
    const r1 = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k81a', 'pA', 1), productLine('k81b', 'pB', 1)],
        { products: { pA: cfgA, pB: cfgB }, categories: baseCategories },
      ),
    );
    const r2 = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k81a', 'pA', 1), productLine('k81b', 'pB', 1)],
        { products: { pA: cfgA, pB: cfgB }, categories: baseCategories },
      ),
    );
    eq('81 stable after both addon', r1, r2);
    ok('81 both qualified', findByKey(r1, 'k81a').addonQualified && findByKey(r1, 'k81b').addonQualified);
  }
}

// ---------------------------------------------------------------------------
// Run all suites.
// ---------------------------------------------------------------------------

function runAll(): void {
  testProductPricing();
  testPackagePricing();
  testPackagePrerequisites();
  testConfigurationAndMetadata();
  testCorrectedBehaviors();
  testDeterminism();

  console.log(`\nStage E1 resolver tests: ${passCount} passed, ${failCount} failed.`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (failCount > 0) {
    process.exit(1);
  }
}

runAll();
