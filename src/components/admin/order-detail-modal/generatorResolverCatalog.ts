// Pure transformation from the already-fetched catalog rows to the four resolver
// maps used by the Order Detail modal's Generator increase path.
//
// Moved verbatim from OrderDetailModal.handleGeneratorQtyChange. The parent still
// owns the four fetches, the stale/context guards, the fetch-error handling, the
// `|| []` normalization of the fetch results and the resolver call. This function
// runs inside the handler's existing try block, so anything it throws for a
// malformed row still reaches the handler's catch exactly as before.
//
// Deliberately preserved behavior (do not "fix" without a separate decision):
// - The LAST pricing row wins for a duplicate product_id; later duplicate product,
//   bundle, category and unit ids overwrite earlier ones (no duplicate detection).
// - Products without a pricing row, or without a non-empty string category_id,
//   are skipped. Prices and thresholds use `?? null` (0 is kept); the enabled
//   flags use `=== true` (only a literal true enables).
// - inflatableEligibilityMode uses `||`, so '', null and undefined become 'none';
//   an unexpected truthy string passes through unvalidated behind the cast.
// - Excluded category ids and eligible unit ids are raw maps: no filtering,
//   trimming or deduplication. A null element in any of these collections throws.
// - Contained category ids keep only non-empty strings, deduplicated in
//   first-seen order (not sorted, not trimmed).
// - Every supplied unit row is emitted as `active: true`, whatever the row says.
//   (The modal's units query already filters to active units; that lives in the parent.)
// - Each inflatable component is emitted as the three-key object
//   { unitId, quantityPerBundle, selectionMode }, which is wider than the declared
//   ResolverBundleInflatableComponent type.
//
// Type-only imports: no runtime imports, so it can be loaded from Node-based tests.

import type {
  ResolverProductConfig,
  ResolverBundleConfig,
  ResolverCategory,
  ResolverUnitConfig,
  ResolverBundleInflatableComponent,
  InflatableEligibilityMode,
} from '../../../lib/eventEssentialsPricingTypes';

// Only the row fields the transformation reads. Database-nullable columns are
// typed as nullable; runtime values are never normalized to satisfy the types.
export interface CatalogProductRow {
  id: string;
  category_id?: string | null;
}

export interface CatalogPricingRow {
  product_id: string;
  standalone_price_cents?: number | null;
  addon_price_cents?: number | null;
  standalone_enabled?: boolean | null;
  addon_enabled?: boolean | null;
  addon_qualifying_threshold_cents?: number | null;
}

export interface CatalogCategoryRow {
  id: string;
}

export interface CatalogBundleRow {
  id: string;
  standalone_price_cents?: number | null;
  addon_price_cents?: number | null;
  standalone_enabled?: boolean | null;
  addon_enabled?: boolean | null;
  addon_qualifying_threshold_cents?: number | null;
  inflatable_eligibility_mode?: string | null;
  product_bundle_components?: Array<{
    inventory_products?: { category_id?: string | null } | null;
  }> | null;
  product_bundle_excluded_categories?: Array<{ category_id: string }> | null;
  package_inflatable_eligibility?: Array<{ unit_id: string }> | null;
  package_inflatable_components?: Array<{
    unit_id: string;
    quantity_per_bundle: number;
    selection_mode: ResolverBundleInflatableComponent['selectionMode'];
  }> | null;
}

export interface CatalogUnitRow {
  id: string;
}

export interface GeneratorResolverCatalog {
  productConfigs: Record<string, ResolverProductConfig>;
  bundleConfigs: Record<string, ResolverBundleConfig>;
  categories: Record<string, ResolverCategory>;
  units: Record<string, ResolverUnitConfig>;
}

export function buildGeneratorResolverCatalog({
  productRows,
  pricingRows,
  categoryRows,
  bundleRows,
  unitRows,
}: {
  productRows: CatalogProductRow[];
  pricingRows: CatalogPricingRow[];
  categoryRows: CatalogCategoryRow[];
  bundleRows: CatalogBundleRow[];
  unitRows: CatalogUnitRow[];
}): GeneratorResolverCatalog {
  const productConfigs: Record<string, ResolverProductConfig> = {};
  const bundleConfigs: Record<string, ResolverBundleConfig> = {};
  const categoryMap: Record<string, ResolverCategory> = {};
  const unitMap: Record<string, ResolverUnitConfig> = {};

  const pricingByProductId = new Map<string, CatalogPricingRow>();
  for (const p of pricingRows) pricingByProductId.set(p.product_id, p);

  for (const p of productRows) {
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

  for (const b of bundleRows) {
    const comps = b.product_bundle_components || [];
    const containedCategoryIds = Array.from(new Set(
      comps.map((c) => c.inventory_products?.category_id).filter((id): id is string => typeof id === 'string' && id !== '')
    ));
    bundleConfigs[b.id] = {
      id: b.id,
      standalonePriceCents: b.standalone_price_cents ?? null,
      addonPriceCents: b.addon_price_cents ?? null,
      standaloneEnabled: b.standalone_enabled === true,
      addonEnabled: b.addon_enabled === true,
      addonQualifyingThresholdCents: b.addon_qualifying_threshold_cents ?? null,
      inflatableEligibilityMode: (b.inflatable_eligibility_mode || 'none') as InflatableEligibilityMode,
      excludedCategoryIds: (b.product_bundle_excluded_categories || []).map((e) => e.category_id),
      eligibleUnitIds: (b.package_inflatable_eligibility || []).map((e) => e.unit_id),
      inflatableComponents: (b.package_inflatable_components || []).map((c) => ({
        unitId: c.unit_id,
        quantityPerBundle: c.quantity_per_bundle,
        selectionMode: c.selection_mode,
      })),
      containedProductCategoryIds: containedCategoryIds,
    };
  }

  for (const c of categoryRows) categoryMap[c.id] = { id: c.id };
  for (const u of unitRows) unitMap[u.id] = { id: u.id, active: true };

  return { productConfigs, bundleConfigs, categories: categoryMap, units: unitMap };
}
