// Stage E4 — Pure order-item mapping for Event Essentials.
//
// Maps UnifiedCartItem[] to order_items insert payloads. Inflatable rows
// remain unchanged (unit_id, wet_or_dry, unit_price_cents, qty). EE product
// rows use product_id + item_name + pricing_context. EE package rows use
// bundle_id + item_name + pricing_context + component_snapshot.
//
// Rejects malformed cart lines (invalid qty, invalid price) by returning
// an empty array so the caller blocks submission.

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

function isValidQty(qty: unknown): boolean {
  const n = typeof qty === 'number' ? qty : Number(qty);
  return Number.isFinite(n) && n > 0 && Number.isSafeInteger(n);
}

function isValidPrice(price: unknown): boolean {
  const n = typeof price === 'number' ? price : Number(price);
  return Number.isFinite(n) && n >= 0 && Number.isSafeInteger(n);
}

export function mapCartToOrderItems(cart: UnifiedCartItem[]): OrderItemInsert[] {
  if (!Array.isArray(cart)) return [];
  const result: OrderItemInsert[] = [];
  for (const item of cart) {
    if (!isValidQty(item.qty) || !isValidPrice(item.unit_price_cents)) {
      return [];
    }
    const qty = Math.trunc(item.qty);
    const unitPrice = Math.trunc(item.unit_price_cents);

    if (isInflatableCartItem(item)) {
      result.push({
        unit_id: item.unit_id,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: unitPrice,
        qty,
        product_id: null,
        bundle_id: null,
        item_name: null,
        pricing_context: null,
        component_snapshot: null,
      });
    } else if (item.item_type === 'event_essential_product') {
      result.push({
        unit_id: null,
        wet_or_dry: null,
        unit_price_cents: unitPrice,
        qty,
        product_id: item.product_id,
        bundle_id: null,
        item_name: item.product_name,
        pricing_context: item.pricing_context,
        component_snapshot: null,
      });
    } else if (item.item_type === 'event_essential_bundle') {
      result.push({
        unit_id: null,
        wet_or_dry: null,
        unit_price_cents: unitPrice,
        qty,
        product_id: null,
        bundle_id: item.bundle_id,
        item_name: item.bundle_name,
        pricing_context: item.pricing_context,
        component_snapshot: item.component_snapshot,
      });
    }
  }
  return result;
}

export function hasEventEssentialsInCart(cart: UnifiedCartItem[]): boolean {
  return cart.some((item) => !isInflatableCartItem(item));
}

export function hasInflatablesInCart(cart: UnifiedCartItem[]): boolean {
  return cart.some((item) => isInflatableCartItem(item));
}
