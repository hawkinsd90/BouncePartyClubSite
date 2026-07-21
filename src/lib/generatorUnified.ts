// Customer Quote/cart Generator helpers.
//
// The Event Essentials Generator product (slug "generator", category slug
// "generators") is the single authoritative Generator rental product for the
// customer Quote/cart checkbox. Legacy has_generator/generator_qty/
// generator_fee_cents fields remain only for historical-order compatibility
// and are not touched by this module.

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

// ---------------------------------------------------------------------------
// Configuration-state transition (pure)
// ---------------------------------------------------------------------------

export type GeneratorConfigurationStatus = 'loading' | 'ready' | 'failed';

export interface GeneratorConfigurationInputs {
  generatorProduct: GeneratorProductConfiguration | null;
  resolverConfig: unknown | null;
  packageConfigs: PackageGeneratorConfig[] | null;
  packageConfigFailed: boolean;
}

export function deriveGeneratorConfigurationStatus(
  inputs: GeneratorConfigurationInputs,
): GeneratorConfigurationStatus {
  const { generatorProduct, resolverConfig, packageConfigs, packageConfigFailed } = inputs;

  if (!generatorProduct) {
    // lookup not yet resolved OR resolver/packaged queries failed alongside.
    if (packageConfigFailed || (packageConfigs === null && !packageConfigFailed)) {
      // packageConfigFailed implies generatorProduct was set then package load failed.
      // But if generatorProduct is null we are still loading the generator lookup itself.
      return 'loading';
    }
    return 'loading';
  }

  if (!resolverConfig) {
    return 'failed';
  }

  if (packageConfigs === null) {
    if (packageConfigFailed) return 'failed';
    return 'loading';
  }

  if (packageConfigFailed) {
    return 'failed';
  }

  return 'ready';
}

// ---------------------------------------------------------------------------
// Duplicate-add decision (pure)
// ---------------------------------------------------------------------------

export interface DuplicateAddDecision {
  shouldAdd: boolean;
  reason?: string;
}

export function decideDirectGeneratorAdd(
  directQty: number,
  packageContainedQty: number,
): DuplicateAddDecision {
  if (packageContainedQty > 0) {
    return {
      shouldAdd: false,
      reason: 'Generator included in your selected package.',
    };
  }
  if (directQty > 0) {
    return {
      shouldAdd: false,
      reason: 'Generator already in cart.',
    };
  }
  return { shouldAdd: true };
}

// ---------------------------------------------------------------------------
// Legacy-conversion readiness (pure)
// ---------------------------------------------------------------------------

export interface LegacyConversionReadinessInputs {
  legacyStatePresent: boolean;
  alreadyHasDirect: boolean;
  conversionCompleted: boolean;
  conversionInFlight: boolean;
  configurationReady: boolean;
  isValidEventDateRange: boolean;
}

export function shouldRunLegacyConversion(
  inputs: LegacyConversionReadinessInputs,
): { ready: boolean; reason?: 'already_converted' | 'no_legacy' | 'in_flight' | 'completed' | 'config_not_ready' | 'invalid_dates' } {
  if (inputs.alreadyHasDirect) {
    return { ready: false, reason: 'already_converted' };
  }
  if (!inputs.legacyStatePresent) {
    return { ready: false, reason: 'no_legacy' };
  }
  if (inputs.conversionInFlight) {
    return { ready: false, reason: 'in_flight' };
  }
  if (inputs.conversionCompleted) {
    return { ready: false, reason: 'completed' };
  }
  if (!inputs.configurationReady) {
    return { ready: false, reason: 'config_not_ready' };
  }
  if (!inputs.isValidEventDateRange) {
    return { ready: false, reason: 'invalid_dates' };
  }
  return { ready: true };
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
