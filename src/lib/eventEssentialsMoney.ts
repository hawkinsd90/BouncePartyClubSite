// Stage E4 — Pure Event Essentials money helper.
//
// Computes the authoritative Event Essentials subtotal from a unified cart
// using E3-resolved prices. Does NOT recalculate add-on qualification (E1/E3
// own that), does NOT touch inflatables, does NOT query Supabase or React,
// does NOT mutate the cart. Returns integer cents; never NaN/Infinity.

import type { UnifiedCartItem } from '../types';
import { isInflatableCartItem } from './unifiedCart';

function safeCents(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function safeQty(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

export function calculateEventEssentialsSubtotalCents(
  cart: UnifiedCartItem[],
): number {
  if (!Array.isArray(cart)) return 0;
  let sum = 0;
  for (const item of cart) {
    if (isInflatableCartItem(item)) continue;
    if (item.item_type !== 'event_essential_product' && item.item_type !== 'event_essential_bundle') {
      continue;
    }
    const price = safeCents(item.unit_price_cents);
    const qty = safeQty(item.qty);
    sum += price * qty;
  }
  return Math.trunc(sum);
}
