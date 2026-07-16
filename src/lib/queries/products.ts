import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';
import type {
  InventoryProduct,
  ProductBundle,
  ProductPricing,
  ProductAvailabilityRequestItem,
  ProductAvailabilityResult,
} from '../../types';

// ---------------------------------------------------------------------------
// Public catalog queries (RLS-restricted to active + public_visible)
// ---------------------------------------------------------------------------

export async function fetchInventoryProducts(options?: QueryOptions) {
  return executeQuery<InventoryProduct[]>(
    async () =>
      await supabase
        .from('inventory_products')
        .select('*')
        .eq('active', true)
        .eq('public_visible', true)
        .order('sort_order', { ascending: true }),
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
        .order('sort_order', { ascending: true }),
    { context: 'fetchProductBundles', ...options }
  );
}

export async function fetchProductBundleById(
  id: string,
  options?: QueryOptions
) {
  return executeQuery<ProductBundle>(
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
               name
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
        .select(
          `*,
           inventory_products!inner (
             id,
             active,
             public_visible
           )`
        )
        .order('sort_order', { ascending: true }),
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
        .order('sort_order', { ascending: true }),
    { context: 'fetchAdminInventoryProducts', ...options }
  );
}

export async function fetchAdminProductBundles(options?: QueryOptions) {
  return executeQuery<ProductBundle[]>(
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
               name
             )
           )`
        )
        .order('sort_order', { ascending: true }),
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
