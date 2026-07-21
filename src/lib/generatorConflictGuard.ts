// Stage E4 — Generator duplicate-charge guard.
//
// Detects when both the legacy generator checkbox (formData.has_generator)
// and an Event Essential Generator product are selected in the same cart.
// Uses the stable product category slug "generators" to identify the EE
// Generator product — never matches by customer-visible name.

import type { UnifiedCartItem } from '../types';
import { isEventEssentialProductCartItem, isEventEssentialBundleCartItem } from './unifiedCart';

export function cartContainsGeneratorProduct(
  cart: UnifiedCartItem[],
  generatorProductIds: Set<string>,
): boolean {
  if (generatorProductIds.size === 0) return false;
  for (const item of cart) {
    if (isEventEssentialProductCartItem(item)) {
      if (generatorProductIds.has(item.product_id)) return true;
    } else if (isEventEssentialBundleCartItem(item)) {
      for (const comp of item.component_snapshot.components) {
        if (generatorProductIds.has(comp.product_id)) return true;
      }
    }
  }
  return false;
}

export function hasLegacyGeneratorSelected(
  formData: { has_generator?: boolean; generator_qty?: number },
): boolean {
  return !!(formData.has_generator || (formData.generator_qty && formData.generator_qty > 0));
}

export function isGeneratorConflict(
  cart: UnifiedCartItem[],
  formData: { has_generator?: boolean; generator_qty?: number },
  generatorProductIds: Set<string>,
): boolean {
  if (!hasLegacyGeneratorSelected(formData)) return false;
  if (generatorProductIds.size === 0) return false;
  return cartContainsGeneratorProduct(cart, generatorProductIds);
}

// Server-side lookup — imports supabase lazily so pure functions remain testable.
export async function findGeneratorProductIds(): Promise<Set<string>> {
  const { supabase } = await import('./supabase');
  const { data: catData } = await supabase
    .from('product_categories')
    .select('id')
    .eq('slug', 'generators')
    .eq('active', true);

  if (!catData || catData.length === 0) return new Set();

  const generatorCategoryIds = new Set(catData.map((c) => c.id));

  const { data: products } = await supabase
    .from('inventory_products')
    .select('id, category_id')
    .eq('active', true);

  if (!products) return new Set();

  return new Set(
    products
      .filter((p: any) => generatorCategoryIds.has(p.category_id))
      .map((p: any) => p.id as string),
  );
}

export async function checkGeneratorConflict(
  cart: UnifiedCartItem[],
  formData: { has_generator?: boolean; generator_qty?: number },
): Promise<boolean> {
  if (!hasLegacyGeneratorSelected(formData)) return false;
  const generatorProductIds = await findGeneratorProductIds();
  if (generatorProductIds.size === 0) return false;
  return cartContainsGeneratorProduct(cart, generatorProductIds);
}
