import { supabase } from '../supabase';
import { executeQuery, type QueryOptions, type QueryResult } from './base';
import { handleError } from '../errorHandling';
import type { Json } from '../database.types';
import type {
  InventoryProduct,
  ProductCategory,
  ProductBundle,
  ProductBundleWithComponents,
  ProductBundleWithConfiguration,
  ProductPricing,
  ProductAvailabilityRequestItem,
  ProductAvailabilityResult,
  InventoryProductWithPricing,
  PackageAdminFormData,
  PackageComponentFormRow,
  InflatableEligibilityMode,
  ProductAdminFormData,
  SaveProductBundleV2Params,
  SaveInventoryProductV2Params,
  Unit,
} from '../../types';

// ---------------------------------------------------------------------------
// Shared currency validation (used by ProductForm and PackageForm)
// ---------------------------------------------------------------------------

const PRICE_REGEX = /^\d+(\.\d{1,2})?$/;
const MAX_PRICE_CENTS = 2147483647;

export type PriceParseResult =
  | { valid: true; cents: number | null }
  | { valid: false; reason: 'format' | 'too_large' };

export function parsePrice(dollars: string): PriceParseResult {
  const trimmed = dollars.trim();
  if (trimmed === '') return { valid: true, cents: null };
  if (!PRICE_REGEX.test(trimmed)) return { valid: false, reason: 'format' };
  const cents = Math.round(parseFloat(trimmed) * 100);
  if (!Number.isSafeInteger(cents)) return { valid: false, reason: 'too_large' };
  if (cents > MAX_PRICE_CENTS) return { valid: false, reason: 'too_large' };
  return { valid: true, cents };
}

export function priceErrorMessage(reason: 'format' | 'too_large'): string {
  return reason === 'too_large'
    ? 'Price is too large.'
    : 'Enter a valid dollar amount (e.g. 12, 12.50)';
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

export function generateSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Package form helpers
// ---------------------------------------------------------------------------

export function bundleToFormData(
  bundle: ProductBundleWithComponents | ProductBundleWithConfiguration,
): PackageAdminFormData {
  const cfg = bundle as ProductBundleWithConfiguration;
  const hasCfg = !!cfg.package_inflatable_components;
  return {
    id: bundle.id,
    slug: bundle.slug,
    name: bundle.name,
    description: bundle.description || '',
    image_url: bundle.image_url,
    standalone_enabled: bundle.standalone_enabled,
    standalone_price_cents: bundle.standalone_price_cents,
    addon_enabled: bundle.addon_enabled,
    addon_price_cents: bundle.addon_price_cents,
    active: bundle.active,
    public_visible: bundle.public_visible,
    menu_visible: bundle.menu_visible,
    featured: bundle.featured,
    sort_order: bundle.sort_order,
    components: bundle.product_bundle_components.map((c) => ({
      product_id: c.product_id,
      quantity_per_bundle: c.quantity_per_bundle,
    })),
    addon_qualifying_threshold_cents:
      cfg.addon_qualifying_threshold_cents ?? null,
    inflatable_eligibility_mode:
      (cfg.inflatable_eligibility_mode as InflatableEligibilityMode) ?? 'none',
    excluded_category_ids: hasCfg
      ? (cfg.product_bundle_excluded_categories ?? []).map((c) => c.category_id)
      : [],
    eligible_unit_ids: hasCfg
      ? (cfg.package_inflatable_eligibility ?? []).map((e) => e.unit_id)
      : [],
    inflatable_components: hasCfg
      ? (cfg.package_inflatable_components ?? []).map((c) => ({
          unit_id: c.unit_id,
          quantity_per_bundle: c.quantity_per_bundle,
          selection_mode: c.selection_mode,
        }))
      : [],
  };
}

export function buildSaveBundleParams(
  operation: 'create' | 'update',
  bundleId: string,
  data: PackageAdminFormData,
  imageUrl: string | null,
): SaveProductBundleParams {
  const components: PackageComponentFormRow[] = data.components.map((c) => ({
    product_id: c.product_id,
    quantity_per_bundle: c.quantity_per_bundle,
  }));
  return {
    p_operation: operation,
    p_bundle_id: bundleId,
    p_slug: data.slug,
    p_name: data.name.trim(),
    p_description: data.description.trim() || null,
    p_image_url: imageUrl,
    p_standalone_price_cents: data.standalone_price_cents,
    p_addon_price_cents: data.addon_price_cents,
    p_standalone_enabled: data.standalone_enabled,
    p_addon_enabled: data.addon_enabled,
    p_active: data.active,
    p_public_visible: data.public_visible,
    p_menu_visible: data.menu_visible,
    p_featured: data.featured,
    p_sort_order: data.sort_order,
    p_components: components as unknown as Json,
  };
}

// ---------------------------------------------------------------------------
// RPC parameter types
// ---------------------------------------------------------------------------

export interface SaveInventoryProductParams {
  p_operation: 'create' | 'update'
  p_product_id: string | null
  p_slug: string
  p_name: string
  p_description: string | null
  p_image_url: string | null
  p_total_quantity: number
  p_temp_unavailable_qty: number
  p_active: boolean
  p_public_visible: boolean
  p_category_id: string | null
  p_sort_order: number
  p_standalone_price_cents: number | null
  p_addon_price_cents: number | null
  p_standalone_enabled: boolean
  p_addon_enabled: boolean
}

export interface SaveProductBundleParams {
  p_operation: 'create' | 'update'
  p_bundle_id: string | null
  p_slug: string
  p_name: string
  p_description: string | null
  p_image_url: string | null
  p_standalone_price_cents: number | null
  p_addon_price_cents: number | null
  p_standalone_enabled: boolean
  p_addon_enabled: boolean
  p_active: boolean
  p_public_visible: boolean
  p_menu_visible: boolean
  p_featured: boolean
  p_sort_order: number
  p_components: Json
}

export interface SaveProductCategoryParams {
  p_operation: 'create' | 'update'
  p_category_id: string | null
  p_slug: string
  p_name: string
  p_sort_order: number
  p_active: boolean
  p_public_visible: boolean
}

// ---------------------------------------------------------------------------
// Public catalog queries (RLS-restricted to active + public_visible)
// ---------------------------------------------------------------------------

export async function fetchProductCategories(options?: QueryOptions) {
  return executeQuery<ProductCategory[]>(
    async () =>
      await supabase
        .from('product_categories')
        .select('*')
        .eq('active', true)
        .eq('public_visible', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    { context: 'fetchProductCategories', ...options }
  );
}

export async function fetchInventoryProductsByCategory(
  categoryId: string,
  options?: QueryOptions
) {
  return executeQuery<InventoryProduct[]>(
    async () =>
      await supabase
        .from('inventory_products')
        .select('*')
        .eq('category_id', categoryId)
        .eq('active', true)
        .eq('public_visible', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    { context: 'fetchInventoryProductsByCategory', ...options }
  );
}

export async function fetchInventoryProducts(options?: QueryOptions) {
  return executeQuery<InventoryProduct[]>(
    async () =>
      await supabase
        .from('inventory_products')
        .select('*')
        .eq('active', true)
        .eq('public_visible', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    { context: 'fetchInventoryProducts', ...options }
  );
}

export async function fetchInventoryProductById(
  id: string,
  options?: QueryOptions
) {
  return executeQuery<InventoryProduct>(
    async () =>
      await supabase
        .from('inventory_products')
        .select('*')
        .eq('id', id)
        .maybeSingle(),
    { context: 'fetchInventoryProductById', ...options }
  );
}

export async function fetchProductBundles(options?: QueryOptions) {
  return executeQuery<ProductBundle[]>(
    async () =>
      await supabase
        .from('product_bundles')
        .select('*')
        .eq('active', true)
        .eq('public_visible', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    { context: 'fetchProductBundles', ...options }
  );
}

export async function fetchProductBundlesWithComponents(options?: QueryOptions) {
  return executeQuery<ProductBundleWithComponents[]>(
    async () =>
      await supabase
        .from('product_bundles')
        .select(
          `*,
           product_bundle_components (
             id,
             product_id,
             quantity_per_bundle,
             inventory_products (
               id,
               slug,
               name,
               category_id
             )
           )`
        )
        .eq('active', true)
        .eq('public_visible', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }) as unknown as Promise<{ data: ProductBundleWithComponents[] | null; error: unknown }>,
    { context: 'fetchProductBundlesWithComponents', ...options }
  );
}

export async function fetchProductBundleById(
  id: string,
  options?: QueryOptions
) {
  return executeQuery<ProductBundleWithComponents>(
    async () =>
      await supabase
        .from('product_bundles')
        .select(
          `*,
           product_bundle_components (
             id,
             product_id,
             quantity_per_bundle,
             inventory_products (
               id,
               slug,
               name,
               category_id
             )
           )`
        )
        .eq('id', id)
        .maybeSingle(),
    { context: 'fetchProductBundleById', ...options }
  );
}

export async function fetchProductPricing(options?: QueryOptions) {
  return executeQuery<ProductPricing[]>(
    async () =>
      await supabase
        .from('product_pricing')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('product_id', { ascending: true }),
    { context: 'fetchProductPricing', ...options }
  );
}

// ---------------------------------------------------------------------------
// Admin queries (require admin/master role; RLS filters server-side)
// ---------------------------------------------------------------------------

export async function fetchAdminInventoryProducts(options?: QueryOptions) {
  return executeQuery<InventoryProduct[]>(
    async () =>
      await supabase
        .from('inventory_products')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    { context: 'fetchAdminInventoryProducts', ...options }
  );
}

export async function fetchAdminProductBundles(options?: QueryOptions) {
  return executeQuery<ProductBundleWithComponents[]>(
    async () =>
      await supabase
        .from('product_bundles')
        .select(
          `*,
           product_bundle_components (
             id,
             product_id,
             quantity_per_bundle,
             inventory_products (
               id,
               slug,
               name,
               category_id
             )
           )`
        )
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }) as unknown as Promise<{ data: ProductBundleWithComponents[] | null; error: unknown }>,
    { context: 'fetchAdminProductBundles', ...options }
  );
}

// ---------------------------------------------------------------------------
// Availability RPC
// ---------------------------------------------------------------------------

export async function checkProductAvailability(
  requestedItems: ProductAvailabilityRequestItem[],
  startDate: string,
  endDate: string,
  excludeOrderId?: string | null,
  options?: QueryOptions
) {
  return executeQuery<ProductAvailabilityResult[]>(
    async () =>
      await supabase.rpc('check_product_availability', {
        p_requested_items: requestedItems as unknown as import('../database.types').Json,
        p_start_date: startDate,
        p_end_date: endDate,
        p_exclude_order_id: excludeOrderId ?? null,
      } as any),
    { context: 'checkProductAvailability', ...options }
  );
}

// ---------------------------------------------------------------------------
// Admin read queries (categories + pricing)
// ---------------------------------------------------------------------------

export async function fetchAdminProductCategories(options?: QueryOptions) {
  return executeQuery<ProductCategory[]>(
    async () =>
      await supabase
        .from('product_categories')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    { context: 'fetchAdminProductCategories', ...options }
  );
}

export async function fetchAdminProductPricing(options?: QueryOptions) {
  return executeQuery<ProductPricing[]>(
    async () =>
      await supabase
        .from('product_pricing')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('product_id', { ascending: true }),
    { context: 'fetchAdminProductPricing', ...options }
  );
}

// ---------------------------------------------------------------------------
// Transactional RPC wrappers
// ---------------------------------------------------------------------------

export async function saveInventoryProduct(
  params: SaveInventoryProductParams,
  options?: QueryOptions
) {
  return executeQuery<string>(
    async () => await supabase.rpc('save_inventory_product', params),
    { context: 'saveInventoryProduct', ...options }
  );
}

export async function saveProductBundle(
  params: SaveProductBundleParams,
  options?: QueryOptions
) {
  return executeQuery<string>(
    async () => await supabase.rpc('save_product_bundle', params),
    { context: 'saveProductBundle', ...options }
  );
}

export async function saveProductCategory(
  params: SaveProductCategoryParams,
  options?: QueryOptions
) {
  return executeQuery<string>(
    async () => await supabase.rpc('save_product_category', params),
    { context: 'saveProductCategory', ...options }
  );
}

export async function reorderProductCategories(
  orderedIds: string[],
  options?: QueryOptions
) {
  return executeQuery<
    Array<{ id: string; slug: string; name: string; sort_order: number }>
  >(
    async () =>
      await supabase.rpc('reorder_product_categories', {
        p_ordered_category_ids: orderedIds,
      }),
    { context: 'reorderProductCategories', ...options }
  );
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

export interface ProductBundleUsage {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  public_visible: boolean;
  product_bundle_components: {
    product_id: string;
  }[];
}

export async function checkProductInUseByBundles(
  productId: string,
  options?: QueryOptions
) {
  return executeQuery<ProductBundleUsage[]>(
    async () =>
      await supabase
        .from('product_bundles')
        .select(
          `id, slug, name, active, public_visible,
           product_bundle_components!inner (
             product_id
           )`
        )
        .eq('product_bundle_components.product_id', productId)
        .eq('active', true)
        .eq('public_visible', true) as unknown as Promise<{ data: ProductBundleUsage[] | null; error: unknown }>,
    { context: 'checkProductInUseByBundles', ...options }
  );
}

export async function deactivateBundle(
  bundleId: string,
  options?: QueryOptions
) {
  return executeQuery<null>(
    async () =>
      await supabase
        .from('product_bundles')
        .update({ active: false })
        .eq('id', bundleId),
    { context: 'deactivateBundle', ...options }
  );
}

export async function deleteCategoryIfEmpty(
  categoryId: string,
  options?: QueryOptions
) {
  const { count, error: countError } = await supabase
    .from('inventory_products')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);

  if (countError) {
    handleError(countError, 'deleteCategoryIfEmpty_count');
    if (options?.throwOnError) {
      throw countError;
    }
    return { data: null, error: countError };
  }

  if ((count ?? 0) > 0) {
    return {
      data: null,
      error: {
        message: `Cannot delete category: ${count} product(s) are still assigned to it. Remove or reassign them first.`,
      },
    };
  }

  return executeQuery<null>(
    async () =>
      await supabase
        .from('product_categories')
        .delete()
        .eq('id', categoryId),
    { context: 'deleteCategoryIfEmpty', ...options }
  );
}

export async function fetchAdminProductsByCategory(
  options?: QueryOptions
): Promise<QueryResult<Record<string, InventoryProductWithPricing[]>>> {
  const [productsResult, pricingResult, categoriesResult] = await Promise.all([
    fetchAdminInventoryProducts(options),
    fetchAdminProductPricing(options),
    fetchAdminProductCategories(options),
  ]);

  if (productsResult.error) return { data: null, error: productsResult.error };
  if (pricingResult.error) return { data: null, error: pricingResult.error };
  if (categoriesResult.error) return { data: null, error: categoriesResult.error };

  const pricingMap = new Map<string, ProductPricing>();
  for (const p of pricingResult.data || []) {
    pricingMap.set(p.product_id, p);
  }

  const categoryMap = new Map<string, string>();
  for (const c of categoriesResult.data || []) {
    categoryMap.set(c.id, c.name);
  }

  const grouped: Record<string, InventoryProductWithPricing[]> = {};
  for (const product of productsResult.data || []) {
    const enriched: InventoryProductWithPricing = {
      ...product,
      pricing: pricingMap.get(product.id) || null,
      category_name: product.category_id ? categoryMap.get(product.category_id) || null : null,
    };
    const key = product.category_id || 'uncategorized';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(enriched);
  }

  return { data: grouped, error: null };
}

export async function fetchAdminProductsWithPricing(
  options?: QueryOptions
): Promise<QueryResult<InventoryProductWithPricing[]>> {
  const [productsResult, pricingResult, categoriesResult] = await Promise.all([
    fetchAdminInventoryProducts(options),
    fetchAdminProductPricing(options),
    fetchAdminProductCategories(options),
  ]);

  if (productsResult.error) return { data: null, error: productsResult.error };
  if (pricingResult.error) return { data: null, error: pricingResult.error };
  if (categoriesResult.error) return { data: null, error: categoriesResult.error };

  const pricingMap = new Map<string, ProductPricing>();
  for (const p of pricingResult.data || []) {
    pricingMap.set(p.product_id, p);
  }

  const categoryMap = new Map<string, string>();
  for (const c of categoriesResult.data || []) {
    categoryMap.set(c.id, c.name);
  }

  const enriched: InventoryProductWithPricing[] = (productsResult.data || []).map(
    (product) => ({
      ...product,
      pricing: pricingMap.get(product.id) || null,
      category_name: product.category_id ? categoryMap.get(product.category_id) || null : null,
    })
  );

  return { data: enriched, error: null };
}

export async function fetchCategoryProductCounts(
  options?: QueryOptions
): Promise<QueryResult<Record<string, number>>> {
  const { data, error } = await supabase
    .from('inventory_products')
    .select('category_id')
    .not('category_id', 'is', null);

  if (error) {
    handleError(error, 'fetchCategoryProductCounts');
    if (options?.throwOnError) throw error;
    return { data: null, error };
  }

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    const catId = row.category_id as string;
    if (catId) {
      counts[catId] = (counts[catId] || 0) + 1;
    }
  }

  return { data: counts, error: null };
}

export function parseStoragePath(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const bucketIdx = parts.findIndex((p) => p === 'event-essentials-media');
    if (bucketIdx === -1 || bucketIdx + 1 >= parts.length) return null;
    return parts.slice(bucketIdx + 1).join('/');
  } catch {
    return null;
  }
}

// ===========================================================================
// Stage B — Package pricing, inflatable eligibility, mixed components
//
// These helpers expose the new schema/RPCs added in Stage B. The existing
// PackageForm and PackageManager continue to use the v1 helpers above; Stage C
// Admin will switch to the v2 helpers. Nothing here changes current customer
// pricing behavior.
// ===========================================================================

const STAGE_B_BUNDLE_RELATION_SELECT = `
  *,
  product_bundle_components (
    id,
    product_id,
    quantity_per_bundle,
    inventory_products (
      id,
      slug,
      name,
      active,
      public_visible,
      category_id,
      image_url
    )
  ),
  package_inflatable_components (
    id,
    bundle_id,
    unit_id,
    quantity_per_bundle,
    selection_mode,
    created_at,
    unit:units (
      id,
      slug,
      name,
      price_dry_cents,
      price_water_cents,
      active
    )
  ),
  product_bundle_excluded_categories (
    bundle_id,
    category_id,
    created_at,
    category:product_categories (
      id,
      slug,
      name
    )
  ),
  package_inflatable_eligibility (
    bundle_id,
    unit_id,
    created_at,
    unit:units (
      id,
      slug,
      name,
      active
    )
  )
` as const;

export function buildSaveProductBundleV2Params(
  operation: 'create' | 'update',
  bundleId: string | null,
  formData: PackageAdminFormData,
  imageUrl: string | null,
): SaveProductBundleV2Params {
  return {
    p_operation: operation,
    p_bundle_id: bundleId,
    p_slug: formData.slug,
    p_name: formData.name,
    p_description: formData.description || null,
    p_image_url: imageUrl,
    p_standalone_price_cents: formData.standalone_price_cents,
    p_addon_price_cents: formData.addon_price_cents,
    p_standalone_enabled: formData.standalone_enabled,
    p_addon_enabled: formData.addon_enabled,
    p_active: formData.active,
    p_public_visible: formData.public_visible,
    p_menu_visible: formData.menu_visible,
    p_featured: formData.featured,
    p_sort_order: formData.sort_order,
    p_components: formData.components,
    p_addon_qualifying_threshold_cents: formData.addon_qualifying_threshold_cents,
    p_inflatable_eligibility_mode: formData.inflatable_eligibility_mode,
    p_excluded_category_ids: formData.excluded_category_ids,
    p_eligible_unit_ids: formData.eligible_unit_ids,
    p_inflatable_components: formData.inflatable_components,
  };
}

export async function saveProductBundleV2(
  params: SaveProductBundleV2Params,
  options?: QueryOptions,
) {
  return executeQuery<string>(
    async () =>
      await supabase.rpc('save_product_bundle_v2', {
        p_operation: params.p_operation,
        p_bundle_id: params.p_bundle_id,
        p_slug: params.p_slug,
        p_name: params.p_name,
        p_description: params.p_description,
        p_image_url: params.p_image_url,
        p_standalone_price_cents: params.p_standalone_price_cents,
        p_addon_price_cents: params.p_addon_price_cents,
        p_standalone_enabled: params.p_standalone_enabled,
        p_addon_enabled: params.p_addon_enabled,
        p_active: params.p_active,
        p_public_visible: params.p_public_visible,
        p_menu_visible: params.p_menu_visible,
        p_featured: params.p_featured,
        p_sort_order: params.p_sort_order,
        p_components: params.p_components as unknown as Json,
        p_addon_qualifying_threshold_cents: params.p_addon_qualifying_threshold_cents,
        p_inflatable_eligibility_mode: params.p_inflatable_eligibility_mode,
        p_excluded_category_ids: params.p_excluded_category_ids,
        p_eligible_unit_ids: params.p_eligible_unit_ids,
        p_inflatable_components: params.p_inflatable_components as unknown as Json,
      }),
    { context: 'saveProductBundleV2', ...options },
  );
}

export function buildSaveInventoryProductV2Params(
  operation: 'create' | 'update',
  productId: string | null,
  data: ProductAdminFormData,
  imageUrl: string | null,
  addonQualifyingThresholdCents: number | null,
): SaveInventoryProductV2Params {
  return {
    p_operation: operation,
    p_product_id: productId,
    p_slug: data.slug,
    p_name: data.name.trim(),
    p_description: data.description.trim() || null,
    p_image_url: imageUrl,
    p_total_quantity: data.total_quantity,
    p_temp_unavailable_qty: data.temp_unavailable_qty,
    p_active: data.active,
    p_public_visible: data.public_visible,
    p_category_id: data.category_id,
    p_sort_order: data.sort_order,
    p_standalone_price_cents: data.standalone_price_cents,
    p_addon_price_cents: data.addon_price_cents,
    p_standalone_enabled: data.standalone_enabled,
    p_addon_enabled: data.addon_enabled,
    p_addon_qualifying_threshold_cents: addonQualifyingThresholdCents,
  };
}

export async function saveInventoryProductV2(
  params: SaveInventoryProductV2Params,
  options?: QueryOptions,
) {
  return executeQuery<string>(
    async () =>
      await supabase.rpc('save_inventory_product_v2', {
        p_operation: params.p_operation,
        p_product_id: params.p_product_id,
        p_slug: params.p_slug,
        p_name: params.p_name,
        p_description: params.p_description,
        p_image_url: params.p_image_url,
        p_total_quantity: params.p_total_quantity,
        p_temp_unavailable_qty: params.p_temp_unavailable_qty,
        p_active: params.p_active,
        p_public_visible: params.p_public_visible,
        p_category_id: params.p_category_id,
        p_sort_order: params.p_sort_order,
        p_standalone_price_cents: params.p_standalone_price_cents,
        p_addon_price_cents: params.p_addon_price_cents,
        p_standalone_enabled: params.p_standalone_enabled,
        p_addon_enabled: params.p_addon_enabled,
        p_addon_qualifying_threshold_cents: params.p_addon_qualifying_threshold_cents,
      }),
    { context: 'saveInventoryProductV2', ...options },
  );
}

export async function fetchAdminProductBundlesWithConfiguration(
  options?: QueryOptions,
) {
  return executeQuery<ProductBundleWithConfiguration[]>(
    async () =>
      await supabase
        .from('product_bundles')
        .select(STAGE_B_BUNDLE_RELATION_SELECT)
        .order('sort_order', { ascending: true }) as unknown as Promise<{
          data: ProductBundleWithConfiguration[] | null;
          error: unknown;
        }>,
    { context: 'fetchAdminProductBundlesWithConfiguration', ...options },
  );
}

export async function fetchProductBundlesWithAllComponents(
  options?: QueryOptions,
) {
  return executeQuery<ProductBundleWithConfiguration[]>(
    async () =>
      await supabase
        .from('product_bundles')
        .select(STAGE_B_BUNDLE_RELATION_SELECT)
        .eq('active', true)
        .eq('public_visible', true)
        .order('sort_order', { ascending: true }) as unknown as Promise<{
          data: ProductBundleWithConfiguration[] | null;
          error: unknown;
        }>,
    { context: 'fetchProductBundlesWithAllComponents', ...options },
  );
}

// Stage C2 — Admin inflatable units selector.
// Loads ALL units (including inactive) so unavailable packages can preserve
// previously selected inactive units; active units are ordered first.
export async function fetchAdminInflatableUnits(options?: QueryOptions) {
  return executeQuery<Unit[]>(
    async () =>
      await supabase
        .from('units')
        .select('id, name, types, price_dry_cents, price_water_cents, active, sort_order')
        .order('active', { ascending: false })
        .order('name', { ascending: true }) as unknown as Promise<{
          data: Unit[] | null;
          error: unknown;
        }>,
    { context: 'fetchAdminInflatableUnits', ...options },
  );
}

// Stage C2 — Admin product categories for the excluded-categories selector.
// Loads ALL categories (including inactive) so previously selected hidden
// categories remain visible to the admin.
export async function fetchAllProductCategoriesAdmin(options?: QueryOptions) {
  return executeQuery<ProductCategory[]>(
    async () =>
      await supabase
        .from('product_categories')
        .select('id, slug, name, sort_order, active, public_visible')
        .order('sort_order', { ascending: true }) as unknown as Promise<{
          data: ProductCategory[] | null;
          error: unknown;
        }>,
    { context: 'fetchAllProductCategoriesAdmin', ...options },
  );
}
