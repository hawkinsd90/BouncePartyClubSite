// Differential / decision tests for the unified Event Essentials resolver configuration
// (High-Value Batch 2).
//
// Three OLD implementations are kept below as independent oracles. They are verbatim copies of
// the code as it existed before Batch 2 and never call the new code:
//   - oldCustomer*  : the customer builders in eventEssentialsCatalogResolver.ts
//   - oldAdmin      : the transformation in generatorResolverCatalog.ts (used by the Order Detail
//                     modal and the Invoice Builder)
//   - oldAees       : the inline config construction in AddEventEssentialsSection.buildResolverInput
//                     (plus its inline bundle-snapshot construction)
//
// The NEW code is the single canonical implementation: the builders in
// eventEssentialsCatalogResolver.ts, reached by admin flows through the thin
// generatorResolverCatalog adapter, and buildBundleSnapshot in unifiedCart.ts.
//
// What the tests establish:
//  A. The customer path is unchanged on every database-shaped input (including every malformed
//     contained-category case). The only customer difference is on synthetic rows no query can
//     return (undefined prices, non-boolean enabled flags), pinned in section A.
//  B. Admin output is identical to the old admin output on well-formed input, except the three
//     intentional canonicalizations listed in B (contained categories = approved Policy A; an
//     unexpected eligibility mode becomes 'none'; inflatable components carry only selectionMode).
//  C. At resolver level, valid configurations price identically, and for malformed package
//     category information the new admin result equals the customer result (and intentionally
//     differs from the old admin result).
//  D. AddEventEssentialsSection's old inline builder is output-equivalent to the new one for
//     well-formed rows; for a null/empty-category product the resolver result differs only in the
//     internal diagnostic code (AEES does not read it).
//  E. The shared bundle snapshot equals the old inline AEES snapshot on every reachable input;
//     only a synthetic empty string differs (accepted canonicalization).

import { resolveEventEssentialsPricing } from '../../eventEssentials/eventEssentialsPricing';
import {
  buildProductConfigMap,
  buildBundleConfigMap,
  buildCategoryMap,
  buildUnitMap,
} from '../../eventEssentials/eventEssentialsCatalogResolver';
import { buildGeneratorResolverCatalog } from '../../../components/admin/order-detail-modal/generatorResolverCatalog';
import { buildBundleSnapshot } from '../../eventEssentials/unifiedCart';
import type { ResolverInput, ResolverInputLine } from '../../eventEssentials/eventEssentialsPricingTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}\n  actual:   ${a}\n  expected: ${e}`); }
}

function neq(label: string, a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) { passed++; } else { failed++; console.error(`FAIL ${label} (expected a difference)\n  both: ${JSON.stringify(a)}`); }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ======================================================================
// OLD ORACLE 1: customer builders (verbatim, pre-Batch 2)
// ======================================================================
function oldCustomerProductConfigMap(products: any[], pricing: any[]) {
  const pricingByProductId = new Map<string, any>();
  for (const p of pricing) pricingByProductId.set(p.product_id, p);

  const map: Record<string, any> = {};
  for (const product of products) {
    const p = pricingByProductId.get(product.id);
    if (!p) continue;
    if (typeof product.category_id !== 'string' || !product.category_id) continue;
    map[product.id] = {
      id: product.id,
      categoryId: product.category_id,
      standalonePriceCents: p.standalone_price_cents,
      addonPriceCents: p.addon_price_cents,
      standaloneEnabled: p.standalone_enabled,
      addonEnabled: p.addon_enabled,
      addonQualifyingThresholdCents: p.addon_qualifying_threshold_cents,
    };
  }
  return map;
}

function oldCustomerContained(bundle: any): string[] {
  const components = bundle.product_bundle_components ?? [];

  if (components.length === 0) return [];

  const ids: string[] = [];

  for (const component of components) {
    const categoryId = component.inventory_products?.category_id;

    const normalizedCategoryId =
      typeof categoryId === 'string' ? categoryId.trim() : '';

    if (!normalizedCategoryId) {
      return [];
    }

    ids.push(normalizedCategoryId);
  }

  return [...new Set(ids)];
}

function oldCustomerBundleConfigMap(bundles: any[]) {
  const map: Record<string, any> = {};
  for (const bundle of bundles) {
    map[bundle.id] = {
      id: bundle.id,
      standalonePriceCents: bundle.standalone_price_cents,
      addonPriceCents: bundle.addon_price_cents,
      standaloneEnabled: bundle.standalone_enabled,
      addonEnabled: bundle.addon_enabled,
      addonQualifyingThresholdCents: bundle.addon_qualifying_threshold_cents,
      inflatableEligibilityMode:
        (bundle.inflatable_eligibility_mode === 'none' ||
          bundle.inflatable_eligibility_mode === 'any' ||
          bundle.inflatable_eligibility_mode === 'selected')
          ? bundle.inflatable_eligibility_mode
          : 'none',
      excludedCategoryIds: (bundle.product_bundle_excluded_categories ?? []).map(
        (c: any) => c.category_id,
      ),
      eligibleUnitIds: (bundle.package_inflatable_eligibility ?? []).map((e: any) => e.unit_id),
      inflatableComponents: (bundle.package_inflatable_components ?? []).map((c: any) => ({
        selectionMode: c.selection_mode,
      })),
      containedProductCategoryIds: oldCustomerContained(bundle),
    };
  }
  return map;
}

function oldCustomerCategoryMap(categories: any[]) {
  const map: Record<string, any> = {};
  for (const c of categories) map[c.id] = { id: c.id };
  return map;
}

function oldCustomerUnitMap(units: any[]) {
  const map: Record<string, any> = {};
  for (const u of units) map[u.id] = { id: u.id, active: u.active };
  return map;
}

// ======================================================================
// OLD ORACLE 2: admin builder (verbatim, pre-Batch 2)
// ======================================================================
function oldAdmin(allProducts: any[], allPricing: any[], allCats: any[], allBundles: any[], availableUnits: any[]) {
  const productConfigs: Record<string, any> = {};
  const bundleConfigs: Record<string, any> = {};
  const categoryMap: Record<string, any> = {};
  const unitMap: Record<string, any> = {};

  const pricingByProductId = new Map<string, any>();
  for (const p of allPricing) pricingByProductId.set(p.product_id, p);

  for (const p of allProducts) {
    const pc = pricingByProductId.get(p.id);
    if (!pc) continue;
    if (typeof p.category_id !== 'string' || !p.category_id) continue;
    productConfigs[p.id] = {
      id: p.id,
      categoryId: p.category_id,
      standalonePriceCents: pc.standalone_price_cents ?? null,
      addonPriceCents: pc.addon_price_cents ?? null,
      standaloneEnabled: pc.standalone_enabled === true,
      addonEnabled: pc.addon_enabled === true,
      addonQualifyingThresholdCents: pc.addon_qualifying_threshold_cents ?? null,
    };
  }

  for (const b of allBundles) {
    const comps = b.product_bundle_components || [];
    const containedCategoryIds = Array.from(new Set(
      comps.map((c: any) => c.inventory_products?.category_id).filter((id: any): id is string => typeof id === 'string' && id !== '')
    ));
    bundleConfigs[b.id] = {
      id: b.id,
      standalonePriceCents: b.standalone_price_cents ?? null,
      addonPriceCents: b.addon_price_cents ?? null,
      standaloneEnabled: b.standalone_enabled === true,
      addonEnabled: b.addon_enabled === true,
      addonQualifyingThresholdCents: b.addon_qualifying_threshold_cents ?? null,
      inflatableEligibilityMode: (b.inflatable_eligibility_mode || 'none'),
      excludedCategoryIds: (b.product_bundle_excluded_categories || []).map((e: any) => e.category_id),
      eligibleUnitIds: (b.package_inflatable_eligibility || []).map((e: any) => e.unit_id),
      inflatableComponents: (b.package_inflatable_components || []).map((c: any) => ({
        unitId: c.unit_id,
        quantityPerBundle: c.quantity_per_bundle,
        selectionMode: c.selection_mode,
      })),
      containedProductCategoryIds: containedCategoryIds,
    };
  }

  for (const c of allCats) categoryMap[c.id] = { id: c.id };
  for (const u of availableUnits) unitMap[u.id] = { id: u.id, active: true };

  return { productConfigs, bundleConfigs, categories: categoryMap, units: unitMap };
}

// ======================================================================
// OLD ORACLE 3: AddEventEssentialsSection inline config construction (verbatim, pre-Batch 2)
// `pricingConfigs` is the product_id -> pricing row map the component keeps in state,
// `categories` is its id -> category row map.
// ======================================================================
function oldAees(allProducts: any[], pricingConfigs: Record<string, any>, allBundles: any[], categories: Record<string, any>, availableUnits: any[]) {
  const productConfigs: Record<string, any> = {};
  for (const p of allProducts) {
    const pc = pricingConfigs[p.id];
    if (!pc) continue;
    productConfigs[p.id] = {
      id: p.id,
      categoryId: p.category_id,
      standalonePriceCents: pc.standalone_price_cents ?? null,
      addonPriceCents: pc.addon_price_cents ?? null,
      standaloneEnabled: pc.standalone_enabled === true,
      addonEnabled: pc.addon_enabled === true,
      addonQualifyingThresholdCents: pc.addon_qualifying_threshold_cents ?? null,
    };
  }

  const bundleConfigs: Record<string, any> = {};
  for (const b of allBundles) {
    const comps = b.product_bundle_components || [];
    const containedCategoryIds = Array.from(new Set(
      comps
        .map((c: any) => c.inventory_products?.category_id)
        .filter((id: any): id is string => typeof id === 'string' && id !== '')
    ));
    bundleConfigs[b.id] = {
      id: b.id,
      standalonePriceCents: b.standalone_price_cents ?? null,
      addonPriceCents: b.addon_price_cents ?? null,
      standaloneEnabled: b.standalone_enabled === true,
      addonEnabled: b.addon_enabled === true,
      addonQualifyingThresholdCents: b.addon_qualifying_threshold_cents ?? null,
      inflatableEligibilityMode: (b.inflatable_eligibility_mode || 'none'),
      excludedCategoryIds: (b.product_bundle_excluded_categories || []).map((e: any) => e.category_id),
      eligibleUnitIds: (b.package_inflatable_eligibility || []).map((e: any) => e.unit_id),
      inflatableComponents: (b.package_inflatable_components || []).map((c: any) => ({
        unitId: c.unit_id,
        quantityPerBundle: c.quantity_per_bundle,
        selectionMode: c.selection_mode,
      })),
      containedProductCategoryIds: containedCategoryIds,
    };
  }

  const catMap: Record<string, any> = {};
  for (const id of Object.keys(categories)) {
    catMap[id] = { id };
  }

  const unitsMap: Record<string, any> = {};
  for (const u of availableUnits) {
    unitsMap[u.id] = {
      id: u.id,
      active: true,
    };
  }

  return { productConfigs, bundleConfigs, categories: catMap, units: unitsMap };
}

function oldAeesSnapshot(bundle: any) {
  const comps = bundle.product_bundle_components || [];
  return {
    bundle_name: bundle.name,
    bundle_description: bundle.description || null,
    components: comps.map((c: any) => ({
      product_id: c.product_id,
      product_name: c.inventory_products?.name || 'Unknown Product',
      quantity_per_bundle: c.quantity_per_bundle,
    })),
  };
}

// ======================================================================
// NEW code, as the flows now call it
// ======================================================================
function newCustomer(products: any[], pricing: any[], cats: any[], bundles: any[], units: any[]) {
  return {
    productConfigs: buildProductConfigMap(products, pricing),
    bundleConfigs: buildBundleConfigMap(bundles),
    categories: buildCategoryMap(cats),
    units: buildUnitMap(units),
  };
}

function newAdmin(products: any[], pricing: any[], cats: any[], bundles: any[], units: any[]) {
  return buildGeneratorResolverCatalog({ productRows: products, pricingRows: pricing, categoryRows: cats, bundleRows: bundles, unitRows: units });
}

// ======================================================================
// Fixtures
// ======================================================================
const C_TABLES = 'cat_tables';
const C_CHAIRS = 'cat_chairs';
const C_GEN = 'cat_generators';

const comp = (cat: unknown, name = 'X', hasProduct = true) => ({
  id: 'c', product_id: 'p', quantity_per_bundle: 1,
  inventory_products: hasProduct ? { id: 'p', name, category_id: cat } : null,
});

function bundleRow(id: string, comps: unknown, extra: Record<string, unknown> = {}) {
  return {
    id, name: id, description: null, active: true,
    standalone_price_cents: 15000, standalone_enabled: true, addon_price_cents: null, addon_enabled: false,
    addon_qualifying_threshold_cents: null, inflatable_eligibility_mode: 'none',
    product_bundle_components: comps, product_bundle_excluded_categories: [], package_inflatable_eligibility: [], package_inflatable_components: [],
    ...extra,
  };
}

// Cases A-J from the decision audit, with the expected contained ids for the OLD admin
// behavior and the CANONICAL (customer / new admin) behavior.
const CASES: Array<{ key: string; label: string; bundle: any; oldAdmin: string[]; canonical: string[] }> = [
  { key: 'A', label: 'both valid (Tables, Chairs)', bundle: bundleRow('bA', [comp(C_TABLES), comp(C_CHAIRS)]), oldAdmin: [C_TABLES, C_CHAIRS], canonical: [C_TABLES, C_CHAIRS] },
  { key: 'B', label: 'one valid, one null category', bundle: bundleRow('bB', [comp(C_TABLES), comp(null)]), oldAdmin: [C_TABLES], canonical: [] },
  { key: 'C', label: 'one component has no joined product', bundle: bundleRow('bC', [comp(C_TABLES), comp(null, 'X', false)]), oldAdmin: [C_TABLES], canonical: [] },
  { key: 'D', label: 'one empty-string category', bundle: bundleRow('bD', [comp(C_TABLES), comp('')]), oldAdmin: [C_TABLES], canonical: [] },
  { key: 'E', label: 'repeated valid categories', bundle: bundleRow('bE', [comp(C_TABLES), comp(C_TABLES), comp(C_CHAIRS)]), oldAdmin: [C_TABLES, C_CHAIRS], canonical: [C_TABLES, C_CHAIRS] },
  { key: 'F', label: 'whitespace-only category', bundle: bundleRow('bF', [comp(C_TABLES), comp('   ')]), oldAdmin: [C_TABLES, '   '], canonical: [] },
  { key: 'G', label: 'no components', bundle: bundleRow('bG', []), oldAdmin: [], canonical: [] },
  { key: 'H', label: 'components list is null', bundle: bundleRow('bH', null), oldAdmin: [], canonical: [] },
  { key: 'I', label: 'padded valid category', bundle: bundleRow('bI', [comp(' cat_tables '), comp(C_CHAIRS)]), oldAdmin: [' cat_tables ', C_CHAIRS], canonical: ['cat_tables', C_CHAIRS] },
  { key: 'J', label: 'all components null category', bundle: bundleRow('bJ', [comp(null), comp(null)]), oldAdmin: [], canonical: [] },
];

// ======================================================================
// A. Customer: old builders vs canonical
// ======================================================================
{
  // Contained-category cases: the customer result must be byte-identical.
  for (const c of CASES) {
    const o = oldCustomerBundleConfigMap([c.bundle]);
    const n = buildBundleConfigMap([c.bundle]);
    eq(`A case ${c.key} (${c.label}): customer bundle config unchanged`, n, o);
    eq(`A case ${c.key}: customer contained ids`, n[c.bundle.id].containedProductCategoryIds, c.canonical);
  }

  // Products, categories and units: unchanged on database-shaped rows.
  const products = [
    { id: 'p1', category_id: 'c1' }, { id: 'p2', category_id: null }, { id: 'p3', category_id: '' }, { id: 'p4', category_id: 'c2' }, { id: 'p5', category_id: 'c1' },
  ];
  const pricing = [
    { product_id: 'p1', standalone_price_cents: 1000, addon_price_cents: 500, standalone_enabled: true, addon_enabled: true, addon_qualifying_threshold_cents: 2000 },
    { product_id: 'p2', standalone_price_cents: 1, addon_price_cents: null, standalone_enabled: true, addon_enabled: false, addon_qualifying_threshold_cents: null },
    { product_id: 'p3', standalone_price_cents: 1, addon_price_cents: null, standalone_enabled: true, addon_enabled: false, addon_qualifying_threshold_cents: null },
    { product_id: 'p4', standalone_price_cents: 0, addon_price_cents: 0, standalone_enabled: false, addon_enabled: false, addon_qualifying_threshold_cents: 0 },
    { product_id: 'p1', standalone_price_cents: 777, addon_price_cents: null, standalone_enabled: true, addon_enabled: false, addon_qualifying_threshold_cents: null },
  ];
  eq('A products (valid, null/empty category, no pricing, zero, duplicate pricing)', buildProductConfigMap(products as any, pricing as any), oldCustomerProductConfigMap(products, pricing));
  const cats = [{ id: 'c1' }, { id: 'c2' }, { id: 'c1' }];
  eq('A categories', buildCategoryMap(cats as any), oldCustomerCategoryMap(cats));
  const units = [{ id: 'u1', active: true }, { id: 'u2', active: false }, { id: 'u1', active: false }];
  eq('A units keep their own active flag', buildUnitMap(units), oldCustomerUnitMap(units));
  ok('A unit with active:false stays inactive for the customer', buildUnitMap(units).u2.active === false);

  // Seeded random database-shaped data (including malformed component categories): identical.
  const r = rng(2024);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  for (let round = 0; round < 120; round++) {
    const catIds = ['ca', 'cb', 'cc'];
    const prods = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({ id: `p${i}`, category_id: pick<unknown>([...catIds, null, '', 'ca']) }));
    const prices = prods.filter(() => r() > 0.2).map((p) => ({
      product_id: p.id,
      standalone_price_cents: pick<number | null>([null, 0, 500, 9999]),
      addon_price_cents: pick<number | null>([null, 0, 300]),
      standalone_enabled: pick([true, false]),
      addon_enabled: pick([true, false]),
      addon_qualifying_threshold_cents: pick<number | null>([null, 0, 15000]),
    }));
    const bundles = Array.from({ length: Math.floor(r() * 4) }, (_, i) => bundleRow(`b${i}`, pick<unknown>([
      null, [], [comp('ca'), comp('cb')], [comp('ca'), comp(null)], [comp('ca'), comp('')], [comp(' ca ')], [comp('ca', 'n', false)], [comp('  '), comp('cb')],
    ]), {
      standalone_price_cents: pick<number | null>([null, 0, 15000]),
      inflatable_eligibility_mode: pick(['none', 'any', 'selected']),
      product_bundle_excluded_categories: pick([[], [{ category_id: 'ca' }]]),
      package_inflatable_eligibility: pick([[], [{ unit_id: 'u1' }]]),
      package_inflatable_components: pick([[], [{ selection_mode: 'dry' }, { selection_mode: 'customer_choice' }]]),
    }));
    const catRows = catIds.slice(0, Math.floor(r() * 4)).map((id) => ({ id }));
    const unitRows = Array.from({ length: Math.floor(r() * 3) }, (_, i) => ({ id: `u${i}`, active: r() > 0.4 }));
    const n = newCustomer(prods, prices, catRows, bundles, unitRows);
    const o = {
      productConfigs: oldCustomerProductConfigMap(prods, prices),
      bundleConfigs: oldCustomerBundleConfigMap(bundles),
      categories: oldCustomerCategoryMap(catRows),
      units: oldCustomerUnitMap(unitRows),
    };
    if (JSON.stringify(n) === JSON.stringify(o)) passed++; else { failed++; console.error(`FAIL A random customer dataset ${round}`); }
  }

  // Synthetic rows no query can return: the canonical builder is strict where the old customer
  // builder passed values through. Pinned so the difference is explicit.
  const synth = buildProductConfigMap([{ id: 'p1', category_id: 'c1' }], [{ product_id: 'p1', standalone_enabled: 'true', standalone_price_cents: undefined } as any]);
  const synthOld = oldCustomerProductConfigMap([{ id: 'p1', category_id: 'c1' }], [{ product_id: 'p1', standalone_enabled: 'true', standalone_price_cents: undefined }]);
  neq('A (synthetic, unreachable from the database) a non-boolean enabled flag is now strict (was passed through)', synth, synthOld);
  ok('A synthetic: canonical standaloneEnabled is false for the string \'true\'', synth.p1.standaloneEnabled === false && synthOld.p1.standaloneEnabled === 'true');
  ok('A synthetic: canonical undefined price becomes null (was undefined)', synth.p1.standalonePriceCents === null && synthOld.p1.standalonePriceCents === undefined);
}

// ======================================================================
// B. Admin: old builder vs canonical (via the adapter)
// ======================================================================
const withoutComponentExtras = (cfg: any) => {
  const copy: any = JSON.parse(JSON.stringify(cfg));
  for (const b of Object.values<any>(copy.bundleConfigs)) b.inflatableComponents = b.inflatableComponents.map((c: any) => ({ selectionMode: c.selectionMode }));
  return copy;
};

{
  // Cases A-J: exact contained ids, old vs new.
  for (const c of CASES) {
    const o = oldAdmin([], [], [], [c.bundle], []);
    const n = newAdmin([], [], [], [c.bundle], []);
    eq(`B case ${c.key} (${c.label}): OLD admin contained ids`, o.bundleConfigs[c.bundle.id].containedProductCategoryIds, c.oldAdmin);
    eq(`B case ${c.key}: NEW admin contained ids`, n.bundleConfigs[c.bundle.id].containedProductCategoryIds, c.canonical);
    eq(`B case ${c.key}: NEW admin equals the customer result`, n.bundleConfigs[c.bundle.id], buildBundleConfigMap([c.bundle])[c.bundle.id]);
    const changed = JSON.stringify(c.oldAdmin) !== JSON.stringify(c.canonical);
    // Everything except the contained ids is the same (after the components canonicalization).
    const oNorm = withoutComponentExtras(o).bundleConfigs[c.bundle.id]; delete oNorm.containedProductCategoryIds;
    const nNorm = JSON.parse(JSON.stringify(n.bundleConfigs[c.bundle.id])); delete nNorm.containedProductCategoryIds;
    eq(`B case ${c.key}: every other bundle field is identical`, nNorm, oNorm);
    ok(`B case ${c.key}: ${changed ? 'INTENTIONAL difference vs old admin' : 'no difference vs old admin'}`, changed === (c.key === 'B' || c.key === 'C' || c.key === 'D' || c.key === 'F' || c.key === 'I'));
  }

  // Well-formed seeded datasets: new admin == old admin (after the documented components canonicalization).
  const r = rng(909);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  for (let round = 0; round < 120; round++) {
    const catIds = ['ca', 'cb', 'cc'];
    const prods = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({ id: `p${i}`, category_id: pick<unknown>([...catIds, null, '']) }));
    const prices = prods.filter(() => r() > 0.2).map((p) => ({
      product_id: p.id,
      standalone_price_cents: pick<number | null | undefined>([null, undefined, 0, 500, 9999]),
      addon_price_cents: pick<number | null | undefined>([null, undefined, 0, 300]),
      standalone_enabled: pick<unknown>([true, false, null, undefined, 'true', 1]),
      addon_enabled: pick<unknown>([true, false, null, undefined]),
      addon_qualifying_threshold_cents: pick<number | null | undefined>([null, undefined, 0, 15000]),
    }));
    if (r() > 0.7 && prices.length) prices.push({ ...prices[0], standalone_price_cents: 4242 });
    const bundles = Array.from({ length: Math.floor(r() * 4) }, (_, i) => bundleRow(`b${i}`, pick<unknown>([
      null, undefined, [], [comp('ca'), comp('cb')], [comp('cb')], [comp('ca'), comp('ca')],
    ]), {
      standalone_price_cents: pick<number | null | undefined>([null, undefined, 0, 15000]),
      standalone_enabled: pick<unknown>([true, false, undefined]),
      inflatable_eligibility_mode: pick<unknown>(['none', 'any', 'selected', '', null, undefined]),
      product_bundle_excluded_categories: pick<unknown>([null, [], [{ category_id: 'ca' }, { category_id: 'ca' }]]),
      package_inflatable_eligibility: pick<unknown>([null, [], [{ unit_id: 'u1' }, { unit_id: 'u1' }]]),
      package_inflatable_components: pick<unknown>([null, [], [{ unit_id: 'u1', quantity_per_bundle: 2, selection_mode: 'dry' }, { unit_id: 'u2', quantity_per_bundle: 0, selection_mode: 'customer_choice' }]]),
    }));
    const catRows = catIds.slice(0, Math.floor(r() * 4)).map((id) => ({ id }));
    const unitRows = Array.from({ length: Math.floor(r() * 3) }, (_, i) => ({ id: `u${i}`, active: r() > 0.4 }));
    const o = withoutComponentExtras(oldAdmin(prods, prices, catRows, bundles, unitRows));
    const n = JSON.parse(JSON.stringify(newAdmin(prods, prices, catRows, bundles, unitRows)));
    if (JSON.stringify(n) === JSON.stringify(o)) passed++; else { failed++; console.error(`FAIL B well-formed admin dataset ${round}`); }
  }

  // The documented component-shape canonicalization.
  {
    const b = bundleRow('bX', [], { package_inflatable_components: [{ unit_id: 'u1', quantity_per_bundle: 3, selection_mode: 'water' }] });
    eq('B INTENTIONAL: old admin component had three keys', oldAdmin([], [], [], [b], []).bundleConfigs.bX.inflatableComponents, [{ unitId: 'u1', quantityPerBundle: 3, selectionMode: 'water' }]);
    eq('B INTENTIONAL: canonical component carries only selectionMode', newAdmin([], [], [], [b], []).bundleConfigs.bX.inflatableComponents, [{ selectionMode: 'water' }]);
  }
  // The documented eligibility-mode canonicalization.
  {
    const b = bundleRow('bY', [], { inflatable_eligibility_mode: 'weird' });
    eq('B INTENTIONAL: old admin passed an unexpected mode through', oldAdmin([], [], [], [b], []).bundleConfigs.bY.inflatableEligibilityMode, 'weird');
    eq('B INTENTIONAL: canonical maps an unexpected mode to none', newAdmin([], [], [], [b], []).bundleConfigs.bY.inflatableEligibilityMode, 'none');
  }
  // Admin unit visibility is not broadened: every supplied unit is emitted active (adapter), and the
  // customer path keeps the row's own flag.
  {
    const rows = [{ id: 'u1', active: false }, { id: 'u2' }];
    eq('B admin units are all active: true (adapter), as before', newAdmin([], [], [], [], rows).units, { u1: { id: 'u1', active: true }, u2: { id: 'u2', active: true } });
    eq('B old admin units were all active: true', oldAdmin([], [], [], [], rows).units, { u1: { id: 'u1', active: true }, u2: { id: 'u2', active: true } });
  }
  // Errors: null elements throw the same error type as before.
  const throwsSame = (label: string, fnOld: () => unknown, fnNew: () => unknown) => {
    let a = ''; let b = '';
    try { fnOld(); } catch (e) { a = (e as Error).constructor.name; }
    try { fnNew(); } catch (e) { b = (e as Error).constructor.name; }
    ok(`B ${label}: both throw TypeError`, a === 'TypeError' && b === 'TypeError');
  };
  throwsSame('null product row', () => oldAdmin([null], [], [], [], []), () => newAdmin([null], [], [], [], []));
  throwsSame('null bundle row', () => oldAdmin([], [], [], [null], []), () => newAdmin([], [], [], [null], []));
  throwsSame('null excluded-category element', () => oldAdmin([], [], [], [bundleRow('b', [], { product_bundle_excluded_categories: [null] })], []), () => newAdmin([], [], [], [bundleRow('b', [], { product_bundle_excluded_categories: [null] })], []));
  throwsSame('null component element', () => oldAdmin([], [], [], [bundleRow('b', [null])], []), () => newAdmin([], [], [], [bundleRow('b', [null])], []));
  throwsSame('null category row', () => oldAdmin([], [], [null], [], []), () => newAdmin([], [], [null], [], []));
  throwsSame('null unit row', () => oldAdmin([], [], [], [], [null]), () => newAdmin([], [], [], [], [null]));
}

// ======================================================================
// C. Resolver-level pricing proof
// ======================================================================
const PRODUCTS = [{ id: 'p_gen', category_id: C_GEN }, { id: 'p_tables', category_id: C_TABLES }, { id: 'p_chairs', category_id: C_CHAIRS }];
function pricingRows(over: Record<string, Record<string, unknown>> = {}) {
  return [
    { product_id: 'p_gen', standalone_price_cents: 20000, standalone_enabled: true, addon_price_cents: 9500, addon_enabled: true, addon_qualifying_threshold_cents: 15000, ...over.gen },
    { product_id: 'p_tables', standalone_price_cents: 5000, standalone_enabled: true, addon_price_cents: 3000, addon_enabled: true, addon_qualifying_threshold_cents: 15000, ...over.tables },
    { product_id: 'p_chairs', standalone_price_cents: 4000, standalone_enabled: true, addon_price_cents: 2500, addon_enabled: true, addon_qualifying_threshold_cents: 15000, ...over.chairs },
  ];
}
const CATS = [{ id: C_GEN }, { id: C_TABLES }, { id: C_CHAIRS }];

type Which = 'oldCustomer' | 'oldAdmin' | 'newAdmin' | 'newCustomer';
function configsFor(which: Which, bundle: any, over: Record<string, Record<string, unknown>>) {
  const pr = pricingRows(over);
  if (which === 'oldCustomer') return { productConfigs: oldCustomerProductConfigMap(PRODUCTS, pr), bundleConfigs: oldCustomerBundleConfigMap([bundle]), categories: oldCustomerCategoryMap(CATS) };
  if (which === 'oldAdmin') { const o = oldAdmin(PRODUCTS, pr, CATS, [bundle], []); return { productConfigs: o.productConfigs, bundleConfigs: o.bundleConfigs, categories: o.categories }; }
  if (which === 'newAdmin') { const n = newAdmin(PRODUCTS, pr, CATS, [bundle], []); return { productConfigs: n.productConfigs, bundleConfigs: n.bundleConfigs, categories: n.categories }; }
  return { productConfigs: buildProductConfigMap(PRODUCTS as any, pr as any), bundleConfigs: buildBundleConfigMap([bundle]), categories: buildCategoryMap(CATS) };
}

function price(which: Which, bundle: any, candidate: string, over: Record<string, Record<string, unknown>> = {}) {
  const cfg = configsFor(which, bundle, over);
  const lines: ResolverInputLine[] = [
    { resolverKey: 'cand', itemType: 'event_essential_product', qty: 1, productId: candidate },
    { resolverKey: 'pkg', itemType: 'event_essential_bundle', qty: 1, bundleId: bundle.id },
  ];
  const input: ResolverInput = { lines, productConfigs: cfg.productConfigs, bundleConfigs: cfg.bundleConfigs, categories: cfg.categories, units: {} };
  const out = resolveEventEssentialsPricing(input);
  const l = out.lines.find((x) => x.resolverKey === 'cand')!;
  return { selectable: l.selectable, ctx: l.resolvedPricingContext, price: l.resolvedUnitPriceCents, addonQualified: l.addonQualified, qualifying: l.qualifyingSubtotalCents };
}

function priceBundle(which: Which, bundle: any) {
  const cfg = configsFor(which, bundle, {});
  const input: ResolverInput = { lines: [{ resolverKey: 'pkg', itemType: 'event_essential_bundle', qty: 1, bundleId: bundle.id }], productConfigs: cfg.productConfigs, bundleConfigs: cfg.bundleConfigs, categories: cfg.categories, units: {} };
  const l = resolveEventEssentialsPricing(input).lines[0];
  return { selectable: l.selectable, ctx: l.resolvedPricingContext, price: l.resolvedUnitPriceCents };
}

{
  // 1. Valid Tables + Chairs package qualifies a Generator: every implementation agrees.
  {
    const b = CASES[0].bundle;
    const results = (['oldCustomer', 'oldAdmin', 'newAdmin', 'newCustomer'] as Which[]).map((w) => price(w, b, 'p_gen'));
    eq('C1 valid package qualifies the Generator (add-on 9500)', results[0], { selectable: true, ctx: 'addon', price: 9500, addonQualified: true, qualifying: 15000 });
    ok('C1 old admin == new admin == customer', results.every((x) => JSON.stringify(x) === JSON.stringify(results[0])));
  }
  // 2/3/4/5. Malformed package category information: new admin == customer, intentionally != old admin.
  for (const key of ['B', 'C', 'D', 'F'] as const) {
    const c = CASES.find((x) => x.key === key)!;
    const cust = price('oldCustomer', c.bundle, 'p_gen');
    const newA = price('newAdmin', c.bundle, 'p_gen');
    const oldA = price('oldAdmin', c.bundle, 'p_gen');
    eq(`C ${key} (${c.label}): customer does not qualify (standalone 20000)`, cust, { selectable: true, ctx: 'standalone', price: 20000, addonQualified: false, qualifying: 0 });
    eq(`C ${key}: NEW admin result equals the customer result`, newA, cust);
    eq(`C ${key}: INTENTIONAL, old admin qualified it (add-on 9500)`, oldA, { selectable: true, ctx: 'addon', price: 9500, addonQualified: true, qualifying: 15000 });
    neq(`C ${key}: old admin differed from the customer`, oldA, cust);
  }
  // 6. Repeated valid categories qualify, same everywhere.
  {
    const b = CASES.find((x) => x.key === 'E')!.bundle;
    const results = (['oldCustomer', 'oldAdmin', 'newAdmin'] as Which[]).map((w) => price(w, b, 'p_gen'));
    ok('C6 repeated valid categories qualify identically everywhere', results.every((x) => JSON.stringify(x) === JSON.stringify(results[0])) && results[0].addonQualified === true);
  }
  // 7. A package containing the candidate's own category does not qualify it.
  {
    const b = CASES[0].bundle; // Tables + Chairs
    for (const cand of ['p_tables', 'p_chairs']) {
      const results = (['oldCustomer', 'oldAdmin', 'newAdmin'] as Which[]).map((w) => price(w, b, cand));
      ok(`C7 package containing ${cand}'s own category does not qualify it (all implementations)`, results.every((x) => x.addonQualified === false && x.qualifying === 0 && JSON.stringify(x) === JSON.stringify(results[0])));
    }
    // Unsafe case the all-or-nothing rule protects: the category-less component might BE a chairs product.
    const bB = CASES.find((x) => x.key === 'B')!.bundle; // Tables + unknown
    eq('C7b candidate Chairs + package [Tables, unknown]: NEW admin does not qualify (cannot prove the unknown is not Chairs)', price('newAdmin', bB, 'p_chairs'), price('oldCustomer', bB, 'p_chairs'));
    eq('C7b candidate Chairs: NEW admin stays at standalone 4000', price('newAdmin', bB, 'p_chairs').price, 4000);
    eq('C7b INTENTIONAL: old admin wrongly qualified it (add-on 2500)', price('oldAdmin', bB, 'p_chairs').price, 2500);
  }
  // 8. Add-on-only candidate: selectability.
  {
    const o = { gen: { standalone_enabled: false } };
    const valid = CASES[0].bundle;
    eq('C8 add-on-only Generator + valid package is selectable (all implementations)', price('newAdmin', valid, 'p_gen', o), { selectable: true, ctx: 'addon', price: 9500, addonQualified: true, qualifying: 15000 });
    eq('C8 old admin == new admin on the valid package', price('oldAdmin', valid, 'p_gen', o), price('newAdmin', valid, 'p_gen', o));
    for (const key of ['B', 'C', 'D'] as const) {
      const c = CASES.find((x) => x.key === key)!;
      eq(`C8 ${key}: add-on-only Generator is NOT selectable under the canonical rule`, price('newAdmin', c.bundle, 'p_gen', o).selectable, false);
      eq(`C8 ${key}: ...matching the customer`, price('newAdmin', c.bundle, 'p_gen', o), price('oldCustomer', c.bundle, 'p_gen', o));
      eq(`C8 ${key}: INTENTIONAL, old admin made it selectable`, price('oldAdmin', c.bundle, 'p_gen', o).selectable, true);
    }
  }
  // 9. Threshold boundary: just below / exact / above, valid package and malformed package.
  for (const p of [14999, 15000, 15001]) {
    const valid = bundleRow('bV', [comp(C_TABLES), comp(C_CHAIRS)], { standalone_price_cents: p });
    const bad = bundleRow('bM', [comp(C_TABLES), comp(null)], { standalone_price_cents: p });
    const expected = p >= 15000;
    ok(`C9 valid package at ${p}: qualifies=${expected}, old admin == new admin == customer`,
      price('newAdmin', valid, 'p_gen').addonQualified === expected
      && JSON.stringify(price('oldAdmin', valid, 'p_gen')) === JSON.stringify(price('newAdmin', valid, 'p_gen'))
      && JSON.stringify(price('oldCustomer', valid, 'p_gen')) === JSON.stringify(price('newAdmin', valid, 'p_gen')));
    ok(`C9 malformed package at ${p}: never qualifies (new admin == customer)`,
      price('newAdmin', bad, 'p_gen').addonQualified === false && price('newAdmin', bad, 'p_gen').qualifying === 0
      && JSON.stringify(price('newAdmin', bad, 'p_gen')) === JSON.stringify(price('oldCustomer', bad, 'p_gen')));
  }
  // The package's OWN price/selectability is unaffected by the contained categories.
  {
    for (const c of CASES) {
      eq(`C package ${c.key} own price is unaffected by the policy change`, priceBundle('newAdmin', c.bundle), priceBundle('oldAdmin', c.bundle));
    }
  }
}

// ======================================================================
// D. AddEventEssentialsSection: old inline builder vs adopted shared builder
// ======================================================================
{
  const toAeesState = (pricing: any[], cats: any[]) => {
    const pMap: Record<string, any> = {};
    pricing.forEach((p) => { pMap[p.product_id] = p; });
    const catMap: Record<string, any> = {};
    cats.forEach((c) => { catMap[c.id] = c; });
    return { pMap, catMap };
  };
  // The adopted AEES call (Object.values of its state maps).
  const adoptedAees = (products: any[], pMap: Record<string, any>, bundles: any[], catMap: Record<string, any>, units: any[]) =>
    buildGeneratorResolverCatalog({ productRows: products, pricingRows: Object.values(pMap), categoryRows: Object.values(catMap), bundleRows: bundles, unitRows: units });

  const r = rng(31337);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  for (let round = 0; round < 120; round++) {
    const catIds = ['ca', 'cb', 'cc'];
    const prods = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({ id: `p${i}`, category_id: pick<unknown>([...catIds]) }));
    const prices = prods.filter(() => r() > 0.2).map((p) => ({
      product_id: p.id,
      standalone_price_cents: pick<number | null | undefined>([null, undefined, 0, 500]),
      addon_price_cents: pick<number | null | undefined>([null, 300]),
      standalone_enabled: pick<unknown>([true, false, null]),
      addon_enabled: pick<unknown>([true, false]),
      addon_qualifying_threshold_cents: pick<number | null>([null, 0, 15000]),
    }));
    if (r() > 0.6 && prices.length) prices.push({ ...prices[0], standalone_price_cents: 99 });
    const bundles = Array.from({ length: Math.floor(r() * 4) }, (_, i) => bundleRow(`b${i}`, pick<unknown>([null, [], [comp('ca'), comp('cb')], [comp('cc')]]), {
      inflatable_eligibility_mode: pick(['none', 'any', 'selected']),
      package_inflatable_components: pick<unknown>([[], [{ unit_id: 'u1', quantity_per_bundle: 1, selection_mode: 'dry' }]]),
    }));
    const catRows = catIds.slice(0, Math.floor(r() * 4)).map((id) => ({ id, name: id }));
    const units = Array.from({ length: Math.floor(r() * 3) }, (_, i) => ({ id: `u${i}` }));
    const { pMap, catMap } = toAeesState(prices, catRows);
    const o = withoutComponentExtras(oldAees(prods, pMap, bundles, catMap, units));
    const n = JSON.parse(JSON.stringify(adoptedAees(prods, pMap, bundles, catMap, units)));
    if (JSON.stringify(n) === JSON.stringify(o)) passed++; else { failed++; console.error(`FAIL D well-formed AEES dataset ${round}`); }
  }

  // Null / empty-category product: AEES used to emit a config with categoryId null/''; the shared
  // builder skips it. The resolver outcome is the same except for the diagnostic code.
  {
    const prods = [{ id: 'p_gen', category_id: C_GEN }, { id: 'p_nocat', category_id: null }, { id: 'p_empty', category_id: '' }];
    const prices = [
      { product_id: 'p_gen', standalone_price_cents: 20000, standalone_enabled: true, addon_price_cents: 9500, addon_enabled: true, addon_qualifying_threshold_cents: 15000 },
      { product_id: 'p_nocat', standalone_price_cents: 15000, standalone_enabled: true },
      { product_id: 'p_empty', standalone_price_cents: 15000, standalone_enabled: true },
    ];
    const catRows = [{ id: C_GEN }];
    const { pMap, catMap } = toAeesState(prices, catRows);
    const o = oldAees(prods, pMap, [], catMap, []);
    const n = adoptedAees(prods, pMap, [], catMap, []);
    ok('D old AEES emitted configs for the null/empty-category products', 'p_nocat' in o.productConfigs && 'p_empty' in o.productConfigs);
    ok('D adopted builder skips them (same as admin/customer)', !('p_nocat' in n.productConfigs) && !('p_empty' in n.productConfigs) && 'p_gen' in n.productConfigs);
    const run = (cfgs: any, lines: ResolverInputLine[]) => resolveEventEssentialsPricing({ lines, productConfigs: cfgs, bundleConfigs: {}, categories: catMap, units: {} }).lines;
    for (const id of ['p_nocat', 'p_empty']) {
      const cand: ResolverInputLine[] = [{ resolverKey: 'c', itemType: 'event_essential_product', qty: 1, productId: id }];
      const lo = run(o.productConfigs, cand)[0]; const ln = run(n.productConfigs, cand)[0];
      const view = (l: any) => ({ selectable: l.selectable, ctx: l.resolvedPricingContext, price: l.resolvedUnitPriceCents, qualifying: l.qualifyingSubtotalCents });
      eq(`D ${id} as a candidate: same selectability and pricing`, view(ln), view(lo));
      eq(`D ${id}: old AEES diagnostic`, lo.selectableReason, 'CATEGORY_MISSING');
      eq(`D ${id}: new diagnostic (internal; AEES does not read it)`, ln.selectableReason, 'PRODUCT_CONFIG_MISSING');
      // As a staged line contributing toward another candidate's threshold: same contribution (none).
      const staged: ResolverInputLine[] = [
        { resolverKey: 'cand', itemType: 'event_essential_product', qty: 1, productId: 'p_gen' },
        { resolverKey: 's', itemType: 'event_essential_product', qty: 1, productId: id, savedUnitPriceCents: 15000 },
      ];
      const so = run(o.productConfigs, staged).find((l) => l.resolverKey === 'cand')!;
      const sn = run(n.productConfigs, staged).find((l) => l.resolverKey === 'cand')!;
      eq(`D ${id} as a staged line: same contribution toward another product's add-on`, view(sn), view(so));
      eq(`D ${id} staged line contributes nothing`, sn.qualifyingSubtotalCents, 0);
    }
  }
  // Duplicate pricing rows: the AEES state map already keeps the last row; Object.values preserves that.
  {
    const prods = [{ id: 'p1', category_id: 'c1' }];
    const prices = [{ product_id: 'p1', standalone_price_cents: 1 }, { product_id: 'p1', standalone_price_cents: 2 }];
    const { pMap, catMap } = toAeesState(prices, [{ id: 'c1' }]);
    eq('D duplicate pricing rows: adopted result equals old AEES (last row wins)', withoutComponentExtras(JSON.parse(JSON.stringify(adoptedAees(prods, pMap, [], catMap, [])))).productConfigs, oldAees(prods, pMap, [], catMap, []).productConfigs);
  }
}

// ======================================================================
// E. Bundle snapshot: old inline AEES vs shared buildBundleSnapshot
// ======================================================================
{
  const snap = (over: Record<string, unknown>, comps: unknown[] = []): any => ({ name: 'B', description: 'd', product_bundle_components: comps, ...over });
  const pc = (name: unknown, qty: unknown = 1, hasProduct = true) => ({ product_id: 'p', quantity_per_bundle: qty, inventory_products: hasProduct ? { name } : null });
  const reachable: Array<[string, any]> = [
    ['valid description and names', snap({}, [pc('Tbl', 2), pc('Chr', 4)])],
    ['null description', snap({ description: null }, [pc('Tbl')])],
    ['undefined description', snap({ description: undefined }, [pc('Tbl')])],
    ['null product name', snap({}, [pc(null)])],
    ['undefined product name', snap({}, [pc(undefined)])],
    ['no joined product', snap({}, [pc('x', 1, false)])],
    ['numeric zero quantity', snap({}, [pc('Tbl', 0)])],
    ['no components', snap({}, [])],
    ['empty bundle name', snap({ name: '' }, [])],
  ];
  for (const [label, b] of reachable) {
    eq(`E reachable input "${label}": shared snapshot equals the old AEES snapshot`, buildBundleSnapshot(b), oldAeesSnapshot(b));
  }
  // Synthetic empty strings: accepted canonicalization to the shared ?? semantics.
  const emptyDesc = snap({ description: '' }, [pc('Tbl')]);
  eq('E INTENTIONAL (synthetic, unreachable): empty description stays empty with the shared snapshot', buildBundleSnapshot(emptyDesc).bundle_description, '');
  eq('E old AEES turned an empty description into null', oldAeesSnapshot(emptyDesc).bundle_description, null);
  const emptyName = snap({}, [pc('')]);
  eq('E INTENTIONAL (synthetic, unreachable): empty product name stays empty with the shared snapshot', buildBundleSnapshot(emptyName).components[0].product_name, '');
  eq('E old AEES turned an empty product name into "Unknown Product"', oldAeesSnapshot(emptyName).components[0].product_name, 'Unknown Product');
  // A null components list cannot come from the query (a to-many embed is always an array),
  // but the shared builder does not tolerate it where the old inline code did. Inside the AEES
  // handler's existing try/catch it surfaces as the normal add-package error. Pinned, not fixed.
  {
    const nullComps = snap({ product_bundle_components: null });
    ok('E old AEES tolerated a null components list (empty components)', JSON.stringify(oldAeesSnapshot(nullComps).components) === '[]');
    let threw = '';
    try { buildBundleSnapshot(nullComps); } catch (e) { threw = (e as Error).constructor.name; }
    ok('E (synthetic, unreachable) the shared builder throws a TypeError for a null components list', threw === 'TypeError');
  }
  // Snapshot keys/order are identical (it participates in JSON.stringify identity comparisons).
  eq('E snapshot key order is identical', Object.keys(buildBundleSnapshot(reachable[0][1])), Object.keys(oldAeesSnapshot(reachable[0][1])));
}

console.log(`Event Essentials resolver configuration unification tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} resolver configuration unification test(s) failed`);
