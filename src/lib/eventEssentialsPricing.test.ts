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
    ok('1 addon-disabled standalone', l.selectable === true && l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 10000 && l.addonQualified === false);
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
    ok('2 standalone-only', l.resolvedPricingContext === 'standalone' && !l.addonQualified);
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
    ok('3 null-threshold standalone fallback', l.selectable && l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 10000 && l.configurationWarning === 'ADDON_THRESHOLD_MISSING' && !l.addonQualified);
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
    ok('4 null-threshold no-standalone invalid', !l.selectable && l.invalidReason === 'ADDON_THRESHOLD_MISSING_NO_STANDALONE' && l.resolvedPricingContext === null);
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
    ok('16 no-standalone invalid', !l.selectable && l.invalidReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED' && l.remainingAmountCents === 15000);
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
  // A is resolved at add-on $60, but contributes its standalone $100 to B's threshold.
  {
    const cfgA = prod('p_a2', C_TABLES, {
      standalonePriceCents: 10000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 6000,
      addonQualifyingThresholdCents: 0, // A qualifies immediately via threshold 0
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
    // A contributes its standalone 10000 even though it resolved to addon 6000.
    ok('18b B sees A standalone value', b.qualifyingSubtotalCents === 10000 && b.addonQualified);
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
    ok('19 addon-disabled standalone', l.resolvedPricingContext === 'standalone' && l.resolvedUnitPriceCents === 30000 && !l.addonQualified);
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
    ok('22 null-threshold no-standalone invalid', !l.selectable && l.invalidReason === 'ADDON_THRESHOLD_MISSING_NO_STANDALONE');
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

  // 32. Package components do not contribute separately.
  // (Stage E1 resolver does not decompose components into input lines at all;
  //  we verify a package line never contributes to another candidate.)
  {
    const b = bundle('b32', {
      standalonePriceCents: 30000,
      standaloneEnabled: true,
      addonEnabled: true,
      addonPriceCents: 20000,
      addonQualifyingThresholdCents: 15000,
      inflatableEligibilityMode: 'any',
      inflatableComponents: [{ selectionMode: 'dry' }],
    });
    const r = resolveEventEssentialsPricing(
      buildInput(
        [bundleLine('k32', 'b32', 1), bundleLine('k32b', 'b32', 1)],
        { bundles: { b32: b }, categories: baseCategories, units: baseUnits },
      ),
    );
    // 'any' mode with no direct inflatable -> prerequisite fails -> unselectable.
    // Verify the prerequisite failure explicitly; qualifying subtotal is null
    // in that path. A second assertion below confirms packages don't contribute
    // to a product's qualifying subtotal.
    ok('32a package self-prereq not met', !findByKey(r, 'k32').prerequisiteMet);
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
    const prod = findByKey(r2, 'k32prod');
    ok('32 package components do not contribute', prod.qualifyingSubtotalCents === 0 && !prod.addonQualified);
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
    ok('34 no-standalone invalid', !l.selectable && l.invalidReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED' && l.remainingAmountCents === 15000);
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

  // 37. any with direct inflatable qty > 0 -> met.
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
    ok('37 any with-inflatable met', l.prerequisiteMet && l.selectable);
  }

  // 38. any with direct inflatable qty 0 -> not met.
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
    // Only line is the package itself; no direct inflatable.
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
    // Only line is the package itself. Its own component does not satisfy.
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
    // Only package lines; no direct inflatable.
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
    ok('50 missing addon price no-standalone invalid', !l.selectable && l.invalidReason === 'ADDON_PRICE_MISSING_NO_STANDALONE');
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
    ok('51 no purchase path', !l.selectable && l.invalidReason === 'NO_PURCHASE_PATH');
  }

  // 52. Missing product config.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k52', 'p_missing', 1)], { categories: baseCategories }),
    );
    const l = findByKey(r, 'k52');
    ok('52 missing product config', !l.selectable && l.invalidReason === 'PRODUCT_CONFIG_MISSING');
  }

  // 53. Missing bundle config.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([bundleLine('k53', 'b_missing', 1)], { categories: baseCategories }),
    );
    const l = findByKey(r, 'k53');
    ok('53 missing bundle config', !l.selectable && l.invalidReason === 'BUNDLE_CONFIG_MISSING');
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
    ok('54 missing category', !l.selectable && l.invalidReason === 'CATEGORY_MISSING');
  }

  // 55. Negative quantity.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k55', 'p_tables', -1)], { products: { p_tables: P_TABLES }, categories: baseCategories }),
    );
    const l = findByKey(r, 'k55');
    ok('55 negative qty invalid', !l.selectable && l.invalidReason === 'INVALID_QUANTITY');
  }

  // 56. Zero quantity behavior.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([productLine('k56', 'p_tables', 0), inflatableLine('k56inf', U_TROPICAL, 15000)], { products: { p_tables: P_TABLES }, categories: baseCategories, units: baseUnits }),
    );
    const l = findByKey(r, 'k56');
    // Zero-qty product: still resolved (standalone fallback since inflatable doesn't count toward it... wait, it does count).
    // Inflatable contributes 15000 >= 15000 threshold, so addon should qualify even at qty 0.
    ok('56 zero-qty resolved', l.selectable && l.addonQualified && l.resolvedPricingContext === 'addon');
  }

  // 57. Unknown item type.
  {
    const r = resolveEventEssentialsPricing(
      buildInput([{ resolverKey: 'k57', itemType: 'something_else' as never, qty: 1 }], { categories: baseCategories }),
    );
    const l = findByKey(r, 'k57');
    ok('57 unknown item type', !l.selectable && l.invalidReason === 'UNKNOWN_ITEM_TYPE');
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
}

// ===========================================================================
// DETERMINISM
// ===========================================================================

function testDeterminism(): void {
  // Shared fixture for determinism tests.
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

  // 60. Reordering input lines produces equivalent keyed results.
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
    ok('60 reorder equivalent', same);
  }

  // 61. Repeating resolver with same input produces deep-equal output.
  {
    const r1 = resolveEventEssentialsPricing(sharedInput);
    const r2 = resolveEventEssentialsPricing(sharedInput);
    eq('61 idempotent deep-equal', r1, r2);
  }

  // 62. Results preserve resolverKey.
  {
    const r = resolveEventEssentialsPricing(sharedInput);
    const keys = r.lines.map((l) => l.resolverKey).sort();
    const expected = ['kA', 'kB', 'kB1', 'kInf'].sort();
    eq('62 resolverKey preserved', keys, expected);
  }

  // 63. Duplicate product input lines are resolved independently.
  {
    const r = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k63a', 'pA', 1), productLine('k63b', 'pA', 1)],
        { products: { pA: cfgA, pB: cfgB }, categories: baseCategories },
      ),
    );
    const a = findByKey(r, 'k63a');
    const b = findByKey(r, 'k63b');
    // Each sees the other (cross-category via... no, same product same category).
    // Same category excluded -> neither qualifies the other. Both standalone.
    ok('63 duplicate independent', a.addonQualified === false && b.addonQualified === false && a.resolverKey === 'k63a' && b.resolverKey === 'k63b');
  }

  // 64. Package lines never create circular qualification.
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
        [bundleLine('k64p', 'bp', 1), bundleLine('k64q', 'bq', 1)],
        { bundles: { bp, bq }, categories: baseCategories },
      ),
    );
    const p = findByKey(r, 'k64p');
    const q = findByKey(r, 'k64q');
    // Neither qualifies the other (packages don't qualify packages).
    ok('64 no circular package qualification', !p.addonQualified && !q.addonQualified && p.qualifyingSubtotalCents === 0 && q.qualifyingSubtotalCents === 0);
  }

  // 65. Product cross-category qualification remains stable after both
  // receive add-on pricing (fixed standalone basis prevents oscillation).
  {
    const r1 = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k65a', 'pA', 1), productLine('k65b', 'pB', 1)],
        { products: { pA: cfgA, pB: cfgB }, categories: baseCategories },
      ),
    );
    // Re-resolve with the output as input again (simulating re-evaluation after
    // both flipped to addon). Since the resolver uses standalone basis, the
    // second pass must produce identical results.
    const r2 = resolveEventEssentialsPricing(
      buildInput(
        [productLine('k65a', 'pA', 1), productLine('k65b', 'pB', 1)],
        { products: { pA: cfgA, pB: cfgB }, categories: baseCategories },
      ),
    );
    eq('65 stable after both addon', r1, r2);
    ok('65 both qualified', findByKey(r1, 'k65a').addonQualified && findByKey(r1, 'k65b').addonQualified);
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
