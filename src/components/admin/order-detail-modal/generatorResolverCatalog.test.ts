// Differential characterization tests for generatorResolverCatalog (the thin admin adapter over
// the canonical Event Essentials resolver configuration builders).
//
// The oracle below is an independent copy of the transformation SPECIFICATION. It started as a
// verbatim copy of the code that lived inline in OrderDetailModal.handleGeneratorQtyChange and
// was updated, deliberately and only where listed, when admin adopted the canonical rules
// (High-Value Batch 2). It never calls the helper.
//
// INTENTIONAL CHANGES vs the pre-Batch-2 admin behavior (each is asserted below and labeled):
//  1. Contained category ids: all-or-nothing. If ANY component lacks a valid non-empty category,
//     the whole list is empty (the package contributes nothing toward add-on qualification).
//     Valid ids are now trimmed. This is the approved business decision (Policy A) and matches
//     the customer resolver and the documented pricing-engine contract.
//  2. An eligibility mode other than none/any/selected becomes 'none' (was passed through).
//     Unreachable from the database (CHECK constraint) but now explicit.
//  3. Inflatable components carry only { selectionMode } (was { unitId, quantityPerBundle,
//     selectionMode }). The resolver reads only selectionMode, so the extra keys were unused.
//
// Everything else is unchanged: last-duplicate-wins, `?? null`, strict `=== true`, unit
// `active` forced to true, raw passthrough of excluded/eligible ids, and TypeErrors for null
// elements. These tests pin that behavior; they are not a statement of desired behavior.

import { buildGeneratorResolverCatalog } from './generatorResolverCatalog';
import type {
  CatalogProductRow,
  CatalogPricingRow,
  CatalogCategoryRow,
  CatalogBundleRow,
  CatalogUnitRow,
  GeneratorResolverCatalog,
} from './generatorResolverCatalog';
import type {
  ResolverProductConfig,
  ResolverBundleConfig,
  ResolverCategory,
  ResolverUnitConfig,
  InflatableEligibilityMode,
} from '../../../lib/eventEssentials/eventEssentialsPricingTypes';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

// Strict structural equality: NaN equals NaN, and an own property whose value
// is undefined is different from a missing property.
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim copy of the pre-extraction inline transformation.
// ---------------------------------------------------------------------------

interface Inputs {
  allProducts: CatalogProductRow[];
  allPricing: CatalogPricingRow[];
  allCats: CatalogCategoryRow[];
  allBundles: CatalogBundleRow[];
  availableUnits: CatalogUnitRow[];
}

function oracle({ allProducts, allPricing, allCats, allBundles, availableUnits }: Inputs) {
  const productConfigs: Record<string, ResolverProductConfig> = {};
  const bundleConfigs: Record<string, ResolverBundleConfig> = {};
  const categoryMap: Record<string, ResolverCategory> = {};
  const unitMap: Record<string, ResolverUnitConfig> = {};

  const pricingByProductId = new Map<string, CatalogPricingRow>();
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
    // Canonical all-or-nothing contained-category rule (Policy A).
    const comps = b.product_bundle_components || [];
    const containedCategoryIds: string[] = [];
    let allValid = comps.length > 0;
    for (const c of comps) {
      const raw = c.inventory_products?.category_id;
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (!id) { allValid = false; break; }
      if (!containedCategoryIds.includes(id)) containedCategoryIds.push(id);
    }
    const contained = allValid ? containedCategoryIds : [];
    bundleConfigs[b.id] = {
      id: b.id,
      standalonePriceCents: b.standalone_price_cents ?? null,
      addonPriceCents: b.addon_price_cents ?? null,
      standaloneEnabled: b.standalone_enabled === true,
      addonEnabled: b.addon_enabled === true,
      addonQualifyingThresholdCents: b.addon_qualifying_threshold_cents ?? null,
      inflatableEligibilityMode: ((b.inflatable_eligibility_mode === 'none' || b.inflatable_eligibility_mode === 'any' || b.inflatable_eligibility_mode === 'selected') ? b.inflatable_eligibility_mode : 'none') as InflatableEligibilityMode,
      excludedCategoryIds: (b.product_bundle_excluded_categories || []).map((e) => e.category_id),
      eligibleUnitIds: (b.package_inflatable_eligibility || []).map((e) => e.unit_id),
      inflatableComponents: (b.package_inflatable_components || []).map((c) => ({
        selectionMode: c.selection_mode,
      })),
      containedProductCategoryIds: contained,
    };
  }

  for (const c of allCats) categoryMap[c.id] = { id: c.id };
  for (const u of availableUnits) unitMap[u.id] = { id: u.id, active: true };

  return { productConfigs, bundleConfigs, categoryMap, unitMap };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY: Inputs = { allProducts: [], allPricing: [], allCats: [], allBundles: [], availableUnits: [] };
const cast = <T>(v: unknown): T => v as T;

const prod = (over: Record<string, unknown> = {}) => cast<CatalogProductRow>({ id: 'p1', category_id: 'c1', ...over });
const price = (over: Record<string, unknown> = {}) => cast<CatalogPricingRow>({
  product_id: 'p1', standalone_price_cents: 1000, addon_price_cents: 500,
  standalone_enabled: true, addon_enabled: true, addon_qualifying_threshold_cents: 2000, ...over,
});
const bundle = (over: Record<string, unknown> = {}) => cast<CatalogBundleRow>({
  id: 'b1', standalone_price_cents: 9000, addon_price_cents: 4000, standalone_enabled: true, addon_enabled: true,
  addon_qualifying_threshold_cents: 3000, inflatable_eligibility_mode: 'selected',
  product_bundle_components: [], product_bundle_excluded_categories: [], package_inflatable_eligibility: [],
  package_inflatable_components: [], ...over,
});
const comp = (categoryId: unknown) => ({ inventory_products: { category_id: categoryId } });

function run(inputs: Inputs): GeneratorResolverCatalog {
  return buildGeneratorResolverCatalog({
    productRows: inputs.allProducts,
    pricingRows: inputs.allPricing,
    categoryRows: inputs.allCats,
    bundleRows: inputs.allBundles,
    unitRows: inputs.availableUnits,
  });
}

// Compares the helper with the oracle (all four maps).
function check(label: string, over: Partial<Inputs>): GeneratorResolverCatalog {
  const inputs = { ...EMPTY, ...over };
  const actual = run(inputs);
  const expected = oracle(inputs);
  ok(`${label} [productConfigs match oracle]`, same(actual.productConfigs, expected.productConfigs));
  ok(`${label} [bundleConfigs match oracle]`, same(actual.bundleConfigs, expected.bundleConfigs));
  ok(`${label} [categories match oracle]`, same(actual.categories, expected.categoryMap));
  ok(`${label} [units match oracle]`, same(actual.units, expected.unitMap));
  return actual;
}

// Both the oracle and the helper must throw the same kind of error.
function checkThrows(label: string, over: Partial<Inputs>) {
  const inputs = { ...EMPTY, ...over };
  let oracleErr: unknown = null;
  let helperErr: unknown = null;
  try { oracle(inputs); } catch (e) { oracleErr = e; }
  try { run(inputs); } catch (e) { helperErr = e; }
  ok(`${label} [oracle throws]`, oracleErr instanceof Error);
  ok(`${label} [helper throws the same error type]`, helperErr instanceof Error && oracleErr instanceof Error && helperErr.name === oracleErr.name);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

{
  const normal = check('normal product', { allProducts: [prod()], allPricing: [price()] });
  ok('normal product builds the expected literal', same(normal.productConfigs, {
    p1: { id: 'p1', categoryId: 'c1', standalonePriceCents: 1000, addonPriceCents: 500, standaloneEnabled: true, addonEnabled: true, addonQualifyingThresholdCents: 2000 },
  }));
  ok('product config has exactly the 7 expected keys',
    same(Object.keys(normal.productConfigs.p1).sort(), ['addonEnabled', 'addonPriceCents', 'addonQualifyingThresholdCents', 'categoryId', 'id', 'standaloneEnabled', 'standalonePriceCents']));

  ok('a product with no pricing row is skipped', !('p1' in check('no pricing', { allProducts: [prod()], allPricing: [price({ product_id: 'other' })] }).productConfigs));
  ok('a null category is skipped', !('p1' in check('cat null', { allProducts: [prod({ category_id: null })], allPricing: [price()] }).productConfigs));
  ok('an undefined category is skipped', !('p1' in check('cat undefined', { allProducts: [prod({ category_id: undefined })], allPricing: [price()] }).productConfigs));
  ok('an empty-string category is skipped', !('p1' in check('cat empty', { allProducts: [prod({ category_id: '' })], allPricing: [price()] }).productConfigs));
  ok('a non-string category is skipped', !('p1' in check('cat number', { allProducts: [prod({ category_id: 123 })], allPricing: [price()] }).productConfigs));

  const zero = check('zero prices', { allProducts: [prod()], allPricing: [price({ standalone_price_cents: 0, addon_price_cents: 0 })] }).productConfigs.p1;
  ok('zero prices stay zero (?? null keeps 0)', zero.standalonePriceCents === 0 && zero.addonPriceCents === 0);
  const nulls = check('null prices', { allProducts: [prod()], allPricing: [price({ standalone_price_cents: null, addon_price_cents: null, addon_qualifying_threshold_cents: null })] }).productConfigs.p1;
  ok('null prices and threshold stay null', nulls.standalonePriceCents === null && nulls.addonPriceCents === null && nulls.addonQualifyingThresholdCents === null);
  const undef = check('undefined prices', { allProducts: [prod()], allPricing: [price({ standalone_price_cents: undefined, addon_price_cents: undefined, addon_qualifying_threshold_cents: undefined })] }).productConfigs.p1;
  ok('undefined prices and threshold become null', undef.standalonePriceCents === null && undef.addonPriceCents === null && undef.addonQualifyingThresholdCents === null);
  ok('a zero threshold stays zero', check('threshold 0', { allProducts: [prod()], allPricing: [price({ addon_qualifying_threshold_cents: 0 })] }).productConfigs.p1.addonQualifyingThresholdCents === 0);

  const flags = (v: unknown) => check(`enabled ${String(v)}`, { allProducts: [prod()], allPricing: [price({ standalone_enabled: v, addon_enabled: v })] }).productConfigs.p1;
  ok('literal true enables both flags', flags(true).standaloneEnabled === true && flags(true).addonEnabled === true);
  ok('false disables both flags', flags(false).standaloneEnabled === false && flags(false).addonEnabled === false);
  ok("the string 'true' does NOT enable (strict === true)", flags('true').standaloneEnabled === false && flags('true').addonEnabled === false);
  ok('the number 1 does NOT enable (strict === true)', flags(1).standaloneEnabled === false && flags(1).addonEnabled === false);
  ok('null and undefined disable', flags(null).standaloneEnabled === false && flags(undefined).addonEnabled === false);

  const dupPricing = check('duplicate pricing', { allProducts: [prod()], allPricing: [price({ standalone_price_cents: 1 }), price({ standalone_price_cents: 2 })] }).productConfigs.p1;
  ok('duplicate pricing rows: the LAST row wins', dupPricing.standalonePriceCents === 2);
  const dupProd = check('duplicate products', { allProducts: [prod({ category_id: 'first' }), prod({ category_id: 'second' })], allPricing: [price()] }).productConfigs;
  ok('duplicate product ids: the later product overwrites the earlier output', Object.keys(dupProd).length === 1 && dupProd.p1.categoryId === 'second');
  ok('an invalid later duplicate does not remove an earlier valid output',
    check('dup, later invalid', { allProducts: [prod({ category_id: 'first' }), prod({ category_id: null })], allPricing: [price()] }).productConfigs.p1.categoryId === 'first');

  checkThrows('null product row', { allProducts: [cast<CatalogProductRow>(null)], allPricing: [price()] });
  checkThrows('null pricing row', { allProducts: [prod()], allPricing: [cast<CatalogPricingRow>(null)] });
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

{
  const inflatable = { unit_id: 'u1', quantity_per_bundle: 2, selection_mode: 'dry' };
  const normal = check('normal bundle', {
    allBundles: [bundle({
      product_bundle_components: [comp('c1'), comp('c2')],
      product_bundle_excluded_categories: [{ category_id: 'x1' }],
      package_inflatable_eligibility: [{ unit_id: 'u1' }],
      package_inflatable_components: [inflatable],
    })],
  }).bundleConfigs.b1;
  ok('normal bundle builds the expected literal', same(normal, {
    id: 'b1', standalonePriceCents: 9000, addonPriceCents: 4000, standaloneEnabled: true, addonEnabled: true,
    addonQualifyingThresholdCents: 3000, inflatableEligibilityMode: 'selected',
    excludedCategoryIds: ['x1'], eligibleUnitIds: ['u1'],
    inflatableComponents: [{ selectionMode: 'dry' }],
    containedProductCategoryIds: ['c1', 'c2'],
  }));
  ok('bundle config has exactly the 11 expected keys', same(Object.keys(normal).sort(), [
    'addonEnabled', 'addonPriceCents', 'addonQualifyingThresholdCents', 'containedProductCategoryIds', 'eligibleUnitIds',
    'excludedCategoryIds', 'id', 'inflatableComponents', 'inflatableEligibilityMode', 'standaloneEnabled', 'standalonePriceCents',
  ]));

  // Prices, thresholds, flags
  const zero = check('bundle zero prices', { allBundles: [bundle({ standalone_price_cents: 0, addon_price_cents: 0, addon_qualifying_threshold_cents: 0 })] }).bundleConfigs.b1;
  ok('bundle zero prices and threshold stay zero', zero.standalonePriceCents === 0 && zero.addonPriceCents === 0 && zero.addonQualifyingThresholdCents === 0);
  const nul = check('bundle null prices', { allBundles: [bundle({ standalone_price_cents: null, addon_price_cents: null, addon_qualifying_threshold_cents: null })] }).bundleConfigs.b1;
  ok('bundle null prices and threshold stay null', nul.standalonePriceCents === null && nul.addonPriceCents === null && nul.addonQualifyingThresholdCents === null);
  const und = check('bundle undefined prices', { allBundles: [bundle({ standalone_price_cents: undefined, addon_price_cents: undefined, addon_qualifying_threshold_cents: undefined })] }).bundleConfigs.b1;
  ok('bundle undefined prices and threshold become null', und.standalonePriceCents === null && und.addonPriceCents === null && und.addonQualifyingThresholdCents === null);
  const bflags = (v: unknown) => check(`bundle enabled ${String(v)}`, { allBundles: [bundle({ standalone_enabled: v, addon_enabled: v })] }).bundleConfigs.b1;
  ok('bundle literal true enables', bflags(true).standaloneEnabled === true && bflags(true).addonEnabled === true);
  ok('bundle false disables', bflags(false).standaloneEnabled === false);
  ok("bundle 'true' does NOT enable (strict)", bflags('true').standaloneEnabled === false && bflags('true').addonEnabled === false);
  ok('bundle 1 does NOT enable (strict)', bflags(1).standaloneEnabled === false && bflags(1).addonEnabled === false);

  // Eligibility mode (whitelist none/any/selected, anything else becomes 'none')
  const mode = (v: unknown) => check(`mode ${String(v)}`, { allBundles: [bundle({ inflatable_eligibility_mode: v })] }).bundleConfigs.b1.inflatableEligibilityMode;
  ok("mode 'none' stays 'none'", mode('none') === 'none');
  ok("mode 'any' stays 'any'", mode('any') === 'any');
  ok("mode 'selected' stays 'selected'", mode('selected') === 'selected');
  ok("an empty string becomes 'none'", mode('') === 'none');
  ok("null becomes 'none'", mode(null) === 'none');
  ok("undefined becomes 'none'", mode(undefined) === 'none');
  ok("INTENTIONAL CHANGE (canonical): an unexpected truthy string becomes 'none' (was passed through)", mode('weird') === 'none');

  // Collections missing / null
  const missing = check('missing collections', { allBundles: [cast<CatalogBundleRow>({ id: 'b9' })] }).bundleConfigs.b9;
  ok('missing collections produce empty arrays', same([missing.excludedCategoryIds, missing.eligibleUnitIds, missing.inflatableComponents, missing.containedProductCategoryIds], [[], [], [], []]));
  const nullColl = check('null collections', { allBundles: [bundle({ product_bundle_components: null, product_bundle_excluded_categories: null, package_inflatable_eligibility: null, package_inflatable_components: null })] }).bundleConfigs.b1;
  ok('null collections produce empty arrays', same([nullColl.excludedCategoryIds, nullColl.eligibleUnitIds, nullColl.inflatableComponents, nullColl.containedProductCategoryIds], [[], [], [], []]));

  // Contained categories: canonical ALL-OR-NOTHING rule (INTENTIONAL CHANGE, Policy A).
  const contained = (comps: unknown[]) => check('contained categories', { allBundles: [bundle({ product_bundle_components: comps })] }).bundleConfigs.b1.containedProductCategoryIds;
  ok('contained categories: normal values in order', same(contained([comp('c1'), comp('c2')]), ['c1', 'c2']));
  ok('INTENTIONAL CHANGE: a missing inventory_products voids the whole list (was ignored)', same(contained([{}, comp('c1')]), []));
  ok('INTENTIONAL CHANGE: a null inventory_products voids the whole list (was ignored)', same(contained([{ inventory_products: null }, comp('c1')]), []));
  ok('INTENTIONAL CHANGE: a missing category voids the whole list (was ignored)', same(contained([{ inventory_products: {} }, comp('c1')]), []));
  ok('INTENTIONAL CHANGE: a null category voids the whole list (was ignored)', same(contained([comp(null), comp('c1')]), []));
  ok('INTENTIONAL CHANGE: a non-string category voids the whole list (was ignored)', same(contained([comp(5), comp({}), comp('c1')]), []));
  ok('INTENTIONAL CHANGE: an empty-string category voids the whole list (was ignored)', same(contained([comp(''), comp('c1')]), []));
  ok('contained categories: duplicates are removed keeping the first occurrence', same(contained([comp('c1'), comp('c2'), comp('c1')]), ['c1', 'c2']));
  ok('contained categories: first-seen order is kept (not sorted)', same(contained([comp('z'), comp('a'), comp('z'), comp('m')]), ['z', 'a', 'm']));
  ok('INTENTIONAL CHANGE: valid ids are now trimmed and de-duplicated after trimming (was untrimmed)', same(contained([comp(' a '), comp('a')]), ['a']));
  ok('INTENTIONAL CHANGE: a whitespace-only id voids the whole list (was kept as an id)', same(contained([comp('  '), comp('c1')]), []));
  ok('contained categories: a void list stays void even when the bad component is last', same(contained([comp('c1'), comp('c2'), comp(null)]), []));
  ok('contained categories: an empty components list gives an empty list', same(contained([]), []));

  // Excluded categories: raw map, no filtering/dedupe
  const excl = (v: unknown[]) => check('excluded categories', { allBundles: [bundle({ product_bundle_excluded_categories: v })] }).bundleConfigs.b1.excludedCategoryIds;
  ok('excluded categories: duplicates are preserved', same(excl([{ category_id: 'a' }, { category_id: 'a' }]), ['a', 'a']));
  ok('excluded categories: order is preserved (not sorted)', same(excl([{ category_id: 'z' }, { category_id: 'a' }]), ['z', 'a']));
  ok('excluded categories: a null id is preserved', same(excl([{ category_id: null }, { category_id: 'a' }]), [null, 'a']));
  ok('excluded categories: an undefined id is preserved', excl([{}]).length === 1 && excl([{}])[0] === undefined);
  checkThrows('null exclusion element', { allBundles: [bundle({ product_bundle_excluded_categories: [null] })] });

  // Eligible units: raw map
  const elig = (v: unknown[]) => check('eligible units', { allBundles: [bundle({ package_inflatable_eligibility: v })] }).bundleConfigs.b1.eligibleUnitIds;
  ok('eligible units: duplicates are preserved', same(elig([{ unit_id: 'u1' }, { unit_id: 'u1' }]), ['u1', 'u1']));
  ok('eligible units: a null id is preserved', same(elig([{ unit_id: null }, { unit_id: 'u2' }]), [null, 'u2']));
  checkThrows('null eligibility element', { allBundles: [bundle({ package_inflatable_eligibility: [null] })] });

  // Inflatable components: canonical shape carries only the selection mode (INTENTIONAL CHANGE: was three keys)
  const comps = (v: unknown[]) => check('inflatable components', { allBundles: [bundle({ package_inflatable_components: v })] }).bundleConfigs.b1.inflatableComponents;
  const c1 = comps([{ unit_id: 'u1', quantity_per_bundle: 3, selection_mode: 'water' }]);
  ok('INTENTIONAL CHANGE: an inflatable component runtime object has exactly { selectionMode } (the extra unitId/quantityPerBundle keys are no longer emitted)',
    same(Object.keys(c1[0]).sort(), ['selectionMode']) && same(c1[0], { selectionMode: 'water' }));
  ok('component quantity and unit fields are not copied', !('quantityPerBundle' in comps([{ unit_id: 'u1', quantity_per_bundle: 0, selection_mode: 'dry' }])[0]) && !('unitId' in comps([{ unit_id: 'u1', quantity_per_bundle: -2, selection_mode: 'dry' }])[0]));
  const noMode = comps([{ unit_id: 'u1', quantity_per_bundle: 1 }])[0];
  ok('a missing selection mode is emitted as an own key with an undefined value', Object.keys(noMode).includes('selectionMode') && noMode.selectionMode === undefined);
  ok('inflatable components keep their order and length', comps([{ unit_id: 'b', quantity_per_bundle: 1, selection_mode: 'dry' }, { unit_id: 'a', quantity_per_bundle: 1, selection_mode: 'dry' }]).length === 2);
  checkThrows('null inflatable component element', { allBundles: [bundle({ package_inflatable_components: [null] })] });

  // Duplicate bundle ids
  const dupB = check('duplicate bundles', { allBundles: [bundle({ standalone_price_cents: 1 }), bundle({ standalone_price_cents: 2 })] }).bundleConfigs;
  ok('duplicate bundle ids: the later bundle overwrites the earlier', Object.keys(dupB).length === 1 && dupB.b1.standalonePriceCents === 2);
  checkThrows('null bundle row', { allBundles: [cast<CatalogBundleRow>(null)] });
}

// ---------------------------------------------------------------------------
// Category map
// ---------------------------------------------------------------------------

{
  const cats = check('categories', { allCats: [{ id: 'c1' }, { id: 'c2' }] }).categories;
  ok('normal categories map to { id }', same(cats, { c1: { id: 'c1' }, c2: { id: 'c2' } }));
  ok('duplicate category ids collapse to one entry (last assignment)', Object.keys(check('dup categories', { allCats: [{ id: 'c1' }, { id: 'c1' }] }).categories).length === 1);
  ok('an empty category id is kept under the empty-string key', '' in check('empty cat id', { allCats: [{ id: '' }] }).categories);
  ok("an undefined category id is kept under the 'undefined' key", 'undefined' in check('undefined cat id', { allCats: [cast<CatalogCategoryRow>({})] }).categories);
  ok('extra category fields are not copied', same(check('extra cat fields', { allCats: [cast<CatalogCategoryRow>({ id: 'c1', name: 'X', active: false })] }).categories, { c1: { id: 'c1' } }));
  checkThrows('null category row', { allCats: [cast<CatalogCategoryRow>(null)] });
}

// ---------------------------------------------------------------------------
// Unit map
// ---------------------------------------------------------------------------

{
  const units = check('units', { availableUnits: [{ id: 'u1' }, { id: 'u2' }] }).units;
  ok('normal units map to { id, active: true }', same(units, { u1: { id: 'u1', active: true }, u2: { id: 'u2', active: true } }));
  const active = (v: unknown) => check(`unit active ${String(v)}`, { availableUnits: [cast<CatalogUnitRow>({ id: 'u1', active: v })] }).units.u1;
  ok('an incoming active: false is still emitted as active: true', active(false).active === true);
  ok('an incoming active: true is emitted as active: true', active(true).active === true);
  ok('a missing active is emitted as active: true', active(undefined).active === true);
  ok('a null active is emitted as active: true', active(null).active === true);
  const extra = check('unit extra fields', { availableUnits: [cast<CatalogUnitRow>({ id: 'u1', name: 'Castle', price_dry_cents: 5, active: false })] }).units.u1;
  ok('unrelated unit fields are not copied (exactly id and active)', same(extra, { id: 'u1', active: true }) && Object.keys(extra).length === 2);
  ok('duplicate unit ids collapse to one entry', Object.keys(check('dup units', { availableUnits: [{ id: 'u1' }, { id: 'u1' }] }).units).length === 1);
  checkThrows('null unit row', { availableUnits: [cast<CatalogUnitRow>(null)] });
}

// ---------------------------------------------------------------------------
// Map separation and top-level shape
// ---------------------------------------------------------------------------

{
  const all = check('all maps', {
    allProducts: [prod({ id: 'shared' })], allPricing: [price({ product_id: 'shared' })],
    allBundles: [bundle({ id: 'shared' })], allCats: [{ id: 'shared' }], availableUnits: [{ id: 'shared' }],
  });
  ok('the top-level output has exactly productConfigs, bundleConfigs, categories, units',
    same(Object.keys(all).sort(), ['bundleConfigs', 'categories', 'productConfigs', 'units']));
  ok('the same id used in every source lands in each map independently',
    'shared' in all.productConfigs && 'shared' in all.bundleConfigs && 'shared' in all.categories && 'shared' in all.units);
  ok('map entries have their own shapes (no cross-contamination)',
    'categoryId' in all.productConfigs.shared && 'inflatableEligibilityMode' in all.bundleConfigs.shared &&
    same(all.categories.shared, { id: 'shared' }) && same(all.units.shared, { id: 'shared', active: true }));
  const onlyProducts = check('products only', { allProducts: [prod()], allPricing: [price()] });
  ok('products appear only in productConfigs', Object.keys(onlyProducts.bundleConfigs).length === 0 && Object.keys(onlyProducts.categories).length === 0 && Object.keys(onlyProducts.units).length === 0);
  const empty = check('empty inputs', {});
  ok('empty inputs produce four empty maps', same(empty, { productConfigs: {}, bundleConfigs: {}, categories: {}, units: {} }));
}

// ---------------------------------------------------------------------------
// The comparison helper itself
// ---------------------------------------------------------------------------

ok('same() treats { a: undefined } and {} as different', !same({ a: undefined }, {}));
ok('same() treats NaN as equal to NaN', same(NaN, NaN));
ok('same() treats different values as different', !same({ a: 1 }, { a: 2 }));

console.log(`\nGenerator resolver catalog tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} generator resolver catalog test(s) failed`);
