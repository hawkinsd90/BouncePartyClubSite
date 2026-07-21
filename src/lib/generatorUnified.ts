// Generator Workflow Unification — authoritative product lookup + identity helpers.
//
// The Event Essentials Generator product (slug "generator", category slug
// "generators") is the single authoritative Generator rental product.
// Legacy has_generator/generator_qty/generator_fee_cents fields remain only
// for historical-order compatibility.

import type { UnifiedCartItem } from '../types';
import {
  isEventEssentialProductCartItem,
  isEventEssentialBundleCartItem,
  filterOutEventEssentialProduct,
} from './unifiedCart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratorProductConfiguration {
  product_id: string;
  product_slug: string;
  product_name: string;
  category_id: string;
  category_slug: string;
  total_quantity: number;
  temp_unavailable_qty: number;
  standalone_price_cents: number | null;
  addon_price_cents: number | null;
  standalone_enabled: boolean;
  addon_enabled: boolean;
}

export type GeneratorProductLookupResult =
  | { status: 'configured'; product: GeneratorProductConfiguration }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'configuration_failed'; error: string };

export type PackageGeneratorConfigResult =
  | { status: 'loaded'; configs: PackageGeneratorConfig[] }
  | { status: 'failed'; error: string };

// ---------------------------------------------------------------------------
// Date-range helper (shared)
// ---------------------------------------------------------------------------

export function isValidEventDateRange(eventDate: string, eventEndDate: string): boolean {
  if (!eventDate || !eventEndDate) return false;
  return eventEndDate >= eventDate;
}

// ---------------------------------------------------------------------------
// Identity helpers (pure, no mutation, no supabase)
// ---------------------------------------------------------------------------

export function getDirectGeneratorQuantity(
  cart: UnifiedCartItem[],
  generatorProductId: string,
): number {
  let qty = 0;
  for (const item of cart) {
    if (isEventEssentialProductCartItem(item) && item.product_id === generatorProductId) {
      qty += item.qty;
    }
  }
  return qty;
}

export function cartHasDirectGenerator(
  cart: UnifiedCartItem[],
  generatorProductId: string,
): boolean {
  return getDirectGeneratorQuantity(cart, generatorProductId) > 0;
}

export function removeDirectGeneratorProduct(
  cart: UnifiedCartItem[],
  generatorProductId: string,
): UnifiedCartItem[] {
  return filterOutEventEssentialProduct(cart, generatorProductId);
}

export interface PackageGeneratorConfig {
  bundle_id: string;
  product_id: string;
  quantity_per_bundle: number;
}

export function cartPackageContainsGenerator(
  cart: UnifiedCartItem[],
  packageGeneratorConfigs: PackageGeneratorConfig[],
  generatorProductId: string,
): number {
  let total = 0;
  const configMap = new Map<string, number>();
  for (const config of packageGeneratorConfigs) {
    if (config.product_id === generatorProductId) {
      configMap.set(config.bundle_id, config.quantity_per_bundle);
    }
  }
  for (const item of cart) {
    if (isEventEssentialBundleCartItem(item)) {
      const perBundle = configMap.get(item.bundle_id);
      if (perBundle) {
        total += perBundle * item.qty;
      }
    }
  }
  return total;
}

export interface OrderItemLike {
  product_id?: string | null;
  qty?: number | null;
}

export function getGeneratorOrderItemQuantity(
  orderItems: OrderItemLike[],
  generatorProductId: string,
): number {
  let qty = 0;
  for (const item of orderItems) {
    if (item.product_id === generatorProductId && item.qty && item.qty > 0) {
      qty += item.qty;
    }
  }
  return qty;
}

export function isLegacyGeneratorOrder(order: {
  generator_qty?: number | null;
  generator_fee_cents?: number | null;
}, generatorOrderItemQty: number): boolean {
  const hasLegacy = (order.generator_qty || 0) > 0 || (order.generator_fee_cents || 0) > 0;
  return hasLegacy && generatorOrderItemQty === 0;
}

export function hasMixedGeneratorState(
  order: { generator_qty?: number | null; generator_fee_cents?: number | null },
  generatorOrderItemQty: number,
): boolean {
  const hasLegacy = (order.generator_qty || 0) > 0 || (order.generator_fee_cents || 0) > 0;
  return hasLegacy && generatorOrderItemQty > 0;
}

export function cartHasMixedGeneratorState(
  cart: UnifiedCartItem[],
  generatorProductId: string,
  legacyFormData: { has_generator?: boolean; generator_qty?: number },
): boolean {
  const hasLegacy = !!(legacyFormData.has_generator || (legacyFormData.generator_qty && legacyFormData.generator_qty > 0));
  if (!hasLegacy) return false;
  return cartHasDirectGenerator(cart, generatorProductId);
}

// ---------------------------------------------------------------------------
// Crew equipment aggregation (pure, extracted for testing)
// ---------------------------------------------------------------------------

export interface OrderItemForAggregation {
  unit_id?: string | null;
  units?: { name?: string } | null;
  item_name?: string | null;
  product_id?: string | null;
  qty?: number;
  wet_or_dry?: string;
  component_snapshot?: any;
}

export interface EquipmentAggregationResult {
  genericItems: string[];
  equipmentIds: string[];
  numInflatables: number;
  eeGeneratorQty: number;
  packageGeneratorQty: number;
  totalGeneratorQty: number;
  displayItems: string[];
}

export function aggregateOrderEquipment(
  orderItems: OrderItemForAggregation[],
  generatorProductId: string | null,
  legacyGeneratorQty: number,
): EquipmentAggregationResult {
  let eeGeneratorQty = 0;
  let packageGeneratorQty = 0;
  const genericItems: string[] = [];
  const equipmentIds: string[] = [];
  let numInflatables = 0;

  for (const item of orderItems) {
    if (item.unit_id && item.units?.name) {
      genericItems.push(`${item.units.name} (${item.wet_or_dry === 'water' ? 'Water' : 'Dry'})`);
      equipmentIds.push(item.unit_id);
      numInflatables += item.qty || 1;
    } else if (item.item_name) {
      if (generatorProductId && item.product_id === generatorProductId) {
        eeGeneratorQty += item.qty || 0;
      } else {
        let itemContainsGenerator = false;
        if (item.component_snapshot && generatorProductId) {
          try {
            const snapshot =
              typeof item.component_snapshot === 'string'
                ? JSON.parse(item.component_snapshot)
                : item.component_snapshot;
            if (snapshot?.components) {
              for (const comp of snapshot.components) {
                if (comp.product_id === generatorProductId) {
                  packageGeneratorQty += (comp.quantity_per_bundle || 0) * (item.qty || 0);
                  itemContainsGenerator = true;
                }
              }
            }
          } catch {
            // Ignore malformed snapshot
          }
        }
        // Always preserve the package display name for crew visibility,
        // even when it contains a Generator. The Generator itself is
        // counted separately and displayed once via totalGeneratorQty.
        void itemContainsGenerator; // tracked but does not suppress display
        genericItems.push(item.item_name);
      }
    }
  }

  const newGeneratorQty = eeGeneratorQty + packageGeneratorQty;
  const effectiveLegacyQty = newGeneratorQty > 0 ? 0 : legacyGeneratorQty;
  const totalGeneratorQty = newGeneratorQty > 0 ? newGeneratorQty : effectiveLegacyQty;

  const displayItems = [...genericItems];
  if (totalGeneratorQty > 0) {
    displayItems.push(`Generator${totalGeneratorQty > 1 ? ` (${totalGeneratorQty}x)` : ''}`);
  }

  return {
    genericItems,
    equipmentIds,
    numInflatables,
    eeGeneratorQty,
    packageGeneratorQty,
    totalGeneratorQty,
    displayItems,
  };
}

// ---------------------------------------------------------------------------
// Admin Generator mode derivation (pure)
// ---------------------------------------------------------------------------

export interface AdminGeneratorModeInput {
  generatorProductId: string | null | undefined;
  stagedItems: Array<{
    product_id?: string | null;
    unit_id?: string | null;
    is_deleted?: boolean;
  }>;
  legacyGeneratorQty: number;
  legacyGeneratorFeeCents: number;
}

export type AdminGeneratorMode = 'none' | 'event_essential' | 'legacy';

export function deriveAdminGeneratorMode(input: AdminGeneratorModeInput): AdminGeneratorMode {
  const { generatorProductId, stagedItems, legacyGeneratorQty, legacyGeneratorFeeCents } = input;

  if (generatorProductId) {
    const hasActiveEEGenerator = stagedItems.some(
      (item) =>
        !item.is_deleted &&
        !item.unit_id &&
        item.product_id === generatorProductId,
    );
    if (hasActiveEEGenerator) return 'event_essential';
  }

  if (legacyGeneratorQty > 0 || legacyGeneratorFeeCents > 0) {
    return 'legacy';
  }

  return 'none';
}

// ---------------------------------------------------------------------------
// Package-contained generator detection for save invariants (pure)
// ---------------------------------------------------------------------------

export interface StagedItemLike {
  product_id?: string | null;
  unit_id?: string | null;
  bundle_id?: string | null;
  is_deleted?: boolean;
  component_snapshot?: any;
}

export function stagedItemContainsGenerator(
  item: StagedItemLike,
  generatorProductId: string,
): boolean {
  if (!item.bundle_id || item.is_deleted) return false;
  if (item.product_id === generatorProductId) return true;
  if (item.component_snapshot) {
    try {
      const snapshot =
        typeof item.component_snapshot === 'string'
          ? JSON.parse(item.component_snapshot)
          : item.component_snapshot;
      if (snapshot?.components) {
        return snapshot.components.some(
          (comp: any) => comp.product_id === generatorProductId,
        );
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function detectMixedGeneratorConflict(
  generatorProductId: string | null,
  stagedItems: StagedItemLike[],
  legacyGeneratorQty: number,
  legacyGeneratorFeeCents: number,
): { conflict: boolean; reason?: string } {
  const hasLegacy = legacyGeneratorQty > 0 || legacyGeneratorFeeCents > 0;
  if (!hasLegacy) return { conflict: false };

  if (!generatorProductId) {
    return {
      conflict: true,
      reason: 'Generator product is not configured — cannot validate mixed state.',
    };
  }

  const hasDirectGenerator = stagedItems.some(
    (item) =>
      !item.is_deleted &&
      !item.unit_id &&
      item.product_id === generatorProductId,
  );
  if (hasDirectGenerator) {
    return {
      conflict: true,
      reason:
        'Order contains both a legacy Generator charge and a direct Event Essentials Generator item.',
    };
  }

  const hasPackageGenerator = stagedItems.some((item) =>
    stagedItemContainsGenerator(item, generatorProductId),
  );
  if (hasPackageGenerator) {
    return {
      conflict: true,
      reason:
        'Order contains both a legacy Generator charge and a package containing a Generator.',
    };
  }

  return { conflict: false };
}

// ---------------------------------------------------------------------------
// Authoritative lookup (supabase-dependent — lazy import for testability)
// ---------------------------------------------------------------------------

const GENERATOR_PRODUCT_SLUG = 'generator';
const GENERATOR_CATEGORY_SLUG = 'generators';

export async function lookupGeneratorProduct(): Promise<GeneratorProductLookupResult> {
  try {
    const { supabase } = await import('./supabase');

    const { data: categories, error: catError } = await supabase
      .from('product_categories')
      .select('id, slug, name, active')
      .eq('slug', GENERATOR_CATEGORY_SLUG);

    if (catError) {
      return { status: 'configuration_failed', error: catError.message };
    }

    const activeCategories = (categories || []).filter((c: any) => c.active);
    if (activeCategories.length === 0) {
      return { status: 'not_found' };
    }

    const categoryIds = activeCategories.map((c: any) => c.id);

    const { data: products, error: prodError } = await supabase
      .from('inventory_products')
      .select('id, slug, name, active, category_id, total_quantity, temp_unavailable_qty')
      .eq('slug', GENERATOR_PRODUCT_SLUG)
      .in('category_id', categoryIds);

    if (prodError) {
      return { status: 'configuration_failed', error: prodError.message };
    }

    const activeProducts = (products || []).filter((p: any) => p.active);
    if (activeProducts.length === 0) {
      return { status: 'not_found' };
    }
    if (activeProducts.length > 1) {
      return { status: 'ambiguous' };
    }

    const product = activeProducts[0];

    if (!product.category_id || typeof product.category_id !== 'string' || product.category_id === '') {
      return { status: 'configuration_failed', error: 'Generator product has no valid category_id' };
    }

    const matchingCategory = activeCategories.find((c: any) => c.id === product.category_id);
    if (!matchingCategory) {
      return { status: 'configuration_failed', error: 'Generator product category not found among active categories' };
    }

    const { data: pricingRows, error: pricingError } = await supabase
      .from('product_pricing')
      .select('standalone_price_cents, addon_price_cents, standalone_enabled, addon_enabled')
      .eq('product_id', product.id)
      .maybeSingle();

    if (pricingError) {
      return { status: 'configuration_failed', error: pricingError.message };
    }

    if (!pricingRows) {
      return { status: 'configuration_failed', error: 'Generator product has no pricing configuration' };
    }

    const standaloneEnabled = pricingRows.standalone_enabled === true;
    const addonEnabled = pricingRows.addon_enabled === true;
    if (!standaloneEnabled && !addonEnabled) {
      return { status: 'configuration_failed', error: 'Generator product has no enabled pricing mode' };
    }

    return {
      status: 'configured',
      product: {
        product_id: product.id,
        product_slug: product.slug,
        product_name: product.name,
        category_id: product.category_id,
        category_slug: matchingCategory.slug,
        total_quantity: product.total_quantity,
        temp_unavailable_qty: product.temp_unavailable_qty,
        standalone_price_cents: pricingRows.standalone_price_cents ?? null,
        addon_price_cents: pricingRows.addon_price_cents ?? null,
        standalone_enabled: pricingRows.standalone_enabled === true,
        addon_enabled: pricingRows.addon_enabled === true,
      },
    };
  } catch (err: any) {
    return { status: 'configuration_failed', error: err?.message || 'Unknown error' };
  }
}

// ---------------------------------------------------------------------------
// Shared Admin Generator resolver adapter
// ---------------------------------------------------------------------------
//
// resolveGeneratorSelection is the single shared typed adapter used by
// Customer Quote, Admin Invoice, and Admin Edit Order. It loads the
// authoritative Generator product, builds the Event Essentials resolver
// config from inventory products / pricing / categories / bundles / units,
// evaluates pricing through evaluateProductCandidate + deriveCandidateViewModel,
// and checks product availability via the check_product_availability RPC.
//
// It NEVER reads pricingRules.generator_fee_single_cents or any legacy field
// for new-item pricing. Legacy fields are preserved only for historical orders.

export type ResolvedGeneratorSelection =
  | {
      status: 'resolved';
      productId: string;
      productName: string;
      quantity: number;
      unitPriceCents: number;
      pricingContext: 'standalone' | 'addon';
    }
  | {
      status: 'unavailable';
      availableQuantity: number;
    }
  | {
      status: 'invalid_dates';
    }
  | {
      status: 'configuration_failed';
      error: string;
    };

export interface GeneratorResolverConfig {
  productConfigs: Record<string, any>;
  bundleConfigs: Record<string, any>;
  categories: Record<string, any>;
  units: Record<string, any>;
  cartLines: any[];
}

export async function loadGeneratorResolverConfig(
  _generatorProductId: string,
): Promise<GeneratorResolverConfig | null> {
  try {
    const { supabase } = await import('./supabase');
    const {
      buildProductConfigMap,
      buildBundleConfigMap,
      buildCategoryMap,
      buildUnitMap,
    } = await import('./eventEssentialsCatalogResolver');

    const [productsRes, pricingRes, categoriesRes, bundlesRes, unitsRes] = await Promise.all([
      supabase.from('inventory_products').select('*').eq('active', true),
      supabase.from('product_pricing').select('*'),
      supabase.from('product_categories').select('*').eq('active', true),
      supabase.from('product_bundles').select('*, product_bundle_components(*, inventory_products(category_id)), product_bundle_excluded_categories(*), package_inflatable_eligibility(*), package_inflatable_components(*)').eq('active', true) as any,
      supabase.from('units').select('id, active').eq('active', true),
    ]);

    if (productsRes.error || pricingRes.error || categoriesRes.error || bundlesRes.error || unitsRes.error) {
      return null;
    }

    const productConfigs = buildProductConfigMap(productsRes.data || [], pricingRes.data || []);
    const bundleConfigs = buildBundleConfigMap(bundlesRes.data || []);
    const categories = buildCategoryMap(categoriesRes.data || []);
    const units = buildUnitMap(unitsRes.data || []);

    return {
      productConfigs,
      bundleConfigs,
      categories,
      units,
      cartLines: [],
    };
  } catch {
    return null;
  }
}

export async function resolveGeneratorSelection(params: {
  generatorProductId: string;
  quantity: number;
  eventDate: string;
  eventEndDate: string;
  resolverConfig: GeneratorResolverConfig;
  excludeOrderId?: string | null;
}): Promise<ResolvedGeneratorSelection> {
  const { generatorProductId, quantity, eventDate, eventEndDate, resolverConfig, excludeOrderId } = params;

  if (!isValidEventDateRange(eventDate, eventEndDate)) {
    return { status: 'invalid_dates' };
  }

  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    return { status: 'configuration_failed', error: 'Invalid quantity.' };
  }

  if (quantity === 0) {
    return {
      status: 'resolved',
      productId: generatorProductId,
      productName: 'Generator',
      quantity: 0,
      unitPriceCents: 0,
      pricingContext: 'standalone',
    };
  }

  try {
    const { evaluateProductCandidate, deriveCandidateViewModel } = await import('./eventEssentialsCatalogResolver');

    const ctx = {
      productConfigs: resolverConfig.productConfigs,
      bundleConfigs: resolverConfig.bundleConfigs,
      categories: resolverConfig.categories,
      units: resolverConfig.units,
      cartLines: resolverConfig.cartLines,
    };

    const out = evaluateProductCandidate(ctx, { productId: generatorProductId, qty: quantity });
    const vm = deriveCandidateViewModel(out, false);

    if (!vm.selectable || vm.resolvedPriceCents === null || vm.resolvedPriceCents === 0) {
      return { status: 'configuration_failed', error: 'Unable to resolve Generator pricing.' };
    }

    // Check product availability
    const { checkProductAvailability } = await import('./queries/products');
    const availResult = await checkProductAvailability(
      [{ product_id: generatorProductId, quantity }],
      eventDate,
      eventEndDate,
      excludeOrderId ?? null,
    );

    if (availResult.error || !availResult.data) {
      return { status: 'configuration_failed', error: 'Availability check failed.' };
    }

    const avail = availResult.data.find((r: any) => r.product_id === generatorProductId);
    if (!avail || !avail.is_allowed) {
      return {
        status: 'unavailable',
        availableQuantity: (avail as any)?.available_quantity ?? 0,
      };
    }

    const pricingContext = vm.priceState === 'addon' ? 'addon' : 'standalone';

    return {
      status: 'resolved',
      productId: generatorProductId,
      productName: (out as any)?.productName || 'Generator',
      quantity,
      unitPriceCents: vm.resolvedPriceCents,
      pricingContext,
    };
  } catch (err: any) {
    return { status: 'configuration_failed', error: err?.message || 'Unknown error' };
  }
}

export async function loadPackageGeneratorConfigs(
  generatorProductId: string,
): Promise<PackageGeneratorConfigResult> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase
      .from('product_bundle_components')
      .select('bundle_id, product_id, quantity_per_bundle')
      .eq('product_id', generatorProductId);

    if (error) {
      return { status: 'failed', error: error.message };
    }
    if (!data) {
      return { status: 'failed', error: 'No data returned from package component query' };
    }

    return {
      status: 'loaded',
      configs: data.map((row: any) => ({
        bundle_id: row.bundle_id,
        product_id: row.product_id,
        quantity_per_bundle: row.quantity_per_bundle,
      })),
    };
  } catch (err: any) {
    return { status: 'failed', error: err?.message || 'Unknown error' };
  }
}
