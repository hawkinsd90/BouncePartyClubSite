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

    const { data: pricingRows, error: pricingError } = await supabase
      .from('product_pricing')
      .select('standalone_price_cents, addon_price_cents, standalone_enabled, addon_enabled')
      .eq('product_id', product.id)
      .maybeSingle();

    if (pricingError) {
      return { status: 'configuration_failed', error: pricingError.message };
    }

    const category = activeCategories.find((c: any) => c.id === product.category_id);

    return {
      status: 'configured',
      product: {
        product_id: product.id,
        product_slug: product.slug,
        product_name: product.name,
        category_id: product.category_id || '',
        category_slug: category?.slug || GENERATOR_CATEGORY_SLUG,
        total_quantity: product.total_quantity,
        temp_unavailable_qty: product.temp_unavailable_qty,
        standalone_price_cents: pricingRows?.standalone_price_cents ?? null,
        addon_price_cents: pricingRows?.addon_price_cents ?? null,
        standalone_enabled: pricingRows?.standalone_enabled ?? false,
        addon_enabled: pricingRows?.addon_enabled ?? false,
      },
    };
  } catch (err: any) {
    return { status: 'configuration_failed', error: err?.message || 'Unknown error' };
  }
}

export async function loadPackageGeneratorConfigs(
  generatorProductId: string,
): Promise<PackageGeneratorConfig[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('product_bundle_components')
    .select('bundle_id, product_id, quantity_per_bundle')
    .eq('product_id', generatorProductId);

  if (error || !data) return [];
  return data.map((row: any) => ({
    bundle_id: row.bundle_id,
    product_id: row.product_id,
    quantity_per_bundle: row.quantity_per_bundle,
  }));
}
