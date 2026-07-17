import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';
import { handleError } from '../errorHandling';
import type { Json } from '../database.types';
import type {
  InventoryProduct,
  ProductCategory,
  ProductBundle,
  ProductBundleWithComponents,
  ProductPricing,
  ProductAvailabilityRequestItem,
  ProductAvailabilityResult,
} from '../../types';

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
