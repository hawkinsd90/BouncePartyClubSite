// Thin admin adapter over the canonical Event Essentials resolver configuration builders
// in lib/eventEssentialsCatalogResolver.ts.
//
// It used to own a second copy of the product / bundle / category / unit transformation
// (moved verbatim from OrderDetailModal.handleGeneratorQtyChange). That copy is gone:
// admin and customer now share ONE implementation, including the canonical
// all-or-nothing contained-category rule. The only thing left here is the admin input
// shape: the admin unit queries are active-only, so every supplied unit is mapped to
// `active: true` before it reaches the canonical unit builder. The parents (the Order
// Detail modal, the Invoice Builder and AddEventEssentialsSection) still own the fetches,
// the stale/context guards and the error handling.
//
// Behavior notes (canonical, shared with the customer flow):
// - The LAST pricing row wins for a duplicate product_id; later duplicate product,
//   bundle, category and unit ids overwrite earlier ones.
// - Products without a pricing row, or without a non-empty string category_id, are skipped.
//   Prices and thresholds use `?? null` (0 is kept); enabled flags use `=== true`.
// - An eligibility mode other than none/any/selected becomes 'none'.
// - Excluded category ids and eligible unit ids are raw maps. A null element throws.
// - Contained category ids: if ANY component lacks a valid non-empty category the whole
//   list is empty; valid ids are trimmed and de-duplicated in first-seen order.
// - Inflatable components carry only { selectionMode }.
// - Every supplied unit row is emitted as `active: true`, whatever the row says.
//
// Imports only Node-loadable modules, so it can be loaded from Node-based tests.

import {
  buildProductConfigMap,
  buildBundleConfigMap,
  buildCategoryMap,
  buildUnitMap,
} from '../../../lib/eventEssentials/eventEssentialsCatalogResolver';
import type {
  CatalogProductRow,
  CatalogPricingRow,
  CatalogCategoryRow,
  CatalogBundleRow,
} from '../../../lib/eventEssentials/eventEssentialsCatalogResolver';
import type {
  ResolverProductConfig,
  ResolverBundleConfig,
  ResolverCategory,
  ResolverUnitConfig,
} from '../../../lib/eventEssentials/eventEssentialsPricingTypes';

export type { CatalogProductRow, CatalogPricingRow, CatalogCategoryRow, CatalogBundleRow };

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
  return {
    productConfigs: buildProductConfigMap(productRows, pricingRows),
    bundleConfigs: buildBundleConfigMap(bundleRows),
    categories: buildCategoryMap(categoryRows),
    units: buildUnitMap(unitRows.map((u) => ({ id: u.id, active: true }))),
  };
}
