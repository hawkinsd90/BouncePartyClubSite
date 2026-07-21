// Stage E4 — Pure order-item mapping for Event Essentials.
//
// Maps UnifiedCartItem[] to order_items insert payloads. Inflatable rows
// remain unchanged (unit_id, wet_or_dry, unit_price_cents, qty). EE product
// rows use product_id + item_name + pricing_context. EE package rows use
// bundle_id + item_name + pricing_context + component_snapshot.

import type { UnifiedCartItem, BundleComponentSnapshot } from '../types';
import { isInflatableCartItem } from './unifiedCart';

export interface OrderItemInsert {
  order_id?: string;
  unit_id: string | null;
  wet_or_dry: 'dry' | 'water' | null;
  unit_price_cents: number;
  qty: number;
  product_id: string | null;
  bundle_id: string | null;
  item_name: string | null;
  pricing_context: 'standalone' | 'addon' | null;
  component_snapshot: BundleComponentSnapshot | null;
}

function safeName(item: UnifiedCartItem): string {
  if (item.item_type === 'event_essential_bundle') return item.bundle_name;
  if (item.item_type === 'event_essential_product') return item.product_name;
  return (item as any).unit_name ?? 'Unknown';
}

void safeName;

export function mapCartToOrderItems(cart: UnifiedCartItem[]): OrderItemInsert[] {
  if (!Array.isArray(cart)) return [];
  return cart.map((item) => {
    if (isInflatableCartItem(item)) {
      return {
        unit_id: item.unit_id,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
        qty: item.qty || 1,
        product_id: null,
        bundle_id: null,
        item_name: null,
        pricing_context: null,
        component_snapshot: null,
      };
    }
    if (item.item_type === 'event_essential_product') {
      return {
        unit_id: null,
        wet_or_dry: null,
        unit_price_cents: item.unit_price_cents,
        qty: item.qty || 1,
        product_id: item.product_id,
        bundle_id: null,
        item_name: item.product_name,
        pricing_context: item.pricing_context,
        component_snapshot: null,
      };
    }
    // event_essential_bundle
    return {
      unit_id: null,
      wet_or_dry: null,
      unit_price_cents: item.unit_price_cents,
      qty: item.qty || 1,
      product_id: null,
      bundle_id: item.bundle_id,
      item_name: item.bundle_name,
      pricing_context: item.pricing_context,
      component_snapshot: item.component_snapshot,
    };
  });
}

export function hasEventEssentialsInCart(cart: UnifiedCartItem[]): boolean {
  return cart.some((item) => !isInflatableCartItem(item));
}

export function hasInflatablesInCart(cart: UnifiedCartItem[]): boolean {
  return cart.some((item) => isInflatableCartItem(item));
}
