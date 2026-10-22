// WP-01 (B6): rebuild a cart from a stored order's lines ("Duplicate order").
//
// The order lines come from get_my_orders: inflatable lines carry `units`, Event Essentials lines carry `product_id` /
// `bundle_id`, `item_name`, `pricing_context` and `component_snapshot` and have `units: null`. Prices stored on the lines are
// only a starting point: Quote re-prices Event Essentials against the current catalog and flags anything no longer offered
// (useEventEssentialsCartRepricing), and the server prices the booking.
import type { UnifiedCartItem, PricingContext, BundleComponentSnapshot } from '../../types';

export interface DuplicateCartResult {
  cartItems: UnifiedCartItem[];
  // Names of lines that cannot be copied (retired inflatables, lines the cart cannot represent).
  unavailable: string[];
}

function pricingContextOf(value: unknown): PricingContext {
  return value === 'addon' ? 'addon' : 'standalone';
}

function isUsableSnapshot(value: any): value is BundleComponentSnapshot {
  return !!value && typeof value === 'object' && Array.isArray(value.components);
}

export function buildDuplicateCart(items: any[]): DuplicateCartResult {
  const cartItems: UnifiedCartItem[] = [];
  const unavailable: string[] = [];

  for (const item of items ?? []) {
    const qty = Number(item?.qty) > 0 ? Number(item.qty) : 1;

    if (item?.unit_id) {
      const unit = item.units;
      if (unit && unit.active !== false) {
        const types: string[] = Array.isArray(unit.types) ? unit.types : [];
        cartItems.push({
          item_type: 'inflatable',
          unit_id: item.unit_id,
          unit_name: unit.name,
          wet_or_dry: item.wet_or_dry === 'water' ? 'water' : 'dry',
          unit_price_cents: item.unit_price_cents,
          price_dry_cents: unit.price_dry_cents ?? item.unit_price_cents,
          price_water_cents: unit.price_water_cents || unit.price_dry_cents || item.unit_price_cents,
          qty,
          is_combo: types.includes('Combo') || types.includes('Water Slide') || unit.is_combo === true,
        });
      } else {
        unavailable.push(unit?.name || item.item_name || 'Inflatable no longer offered');
      }
      continue;
    }

    if (item?.bundle_id) {
      cartItems.push({
        item_type: 'event_essential_bundle',
        bundle_id: item.bundle_id,
        bundle_name: item.item_name || item.component_snapshot?.bundle_name || 'Event Essentials package',
        unit_price_cents: item.unit_price_cents,
        qty,
        pricing_context: pricingContextOf(item.pricing_context),
        // Quote re-derives the contents from the current catalog; the stored snapshot only covers the moment before that.
        component_snapshot: isUsableSnapshot(item.component_snapshot)
          ? item.component_snapshot
          : { bundle_name: item.item_name ?? '', bundle_description: null, components: [] },
      });
      continue;
    }

    if (item?.product_id) {
      cartItems.push({
        item_type: 'event_essential_product',
        product_id: item.product_id,
        product_name: item.item_name || 'Event Essential',
        unit_price_cents: item.unit_price_cents,
        qty,
        pricing_context: pricingContextOf(item.pricing_context),
      });
      continue;
    }

    unavailable.push(item?.item_name || 'Item');
  }

  return { cartItems, unavailable };
}

// What the My Orders card prints for one stored line.
export function describeOrderLine(item: any): { name: string; badge: 'Wet' | 'Dry' | null } {
  const unitName = item?.units?.name;
  if (item?.unit_id && unitName) {
    return { name: unitName, badge: item.wet_or_dry === 'water' ? 'Wet' : 'Dry' };
  }
  return { name: item?.item_name || item?.component_snapshot?.bundle_name || 'Event Essentials item', badge: null };
}

// Prefill for "can we use stakes?". Only meaningful when the cart has inflatables (Quote does not ask otherwise). The booked
// surface is the source of truth: the server stores surface 'grass' when stakes were allowed.
export function duplicateCanStake(order: { surface?: string | null; can_use_stakes?: boolean | null }, hasInflatables: boolean): boolean | null {
  if (!hasInflatables) return null;
  if (order.surface === 'grass') return true;
  if (order.surface === 'cement') return false;
  return typeof order.can_use_stakes === 'boolean' ? order.can_use_stakes : null;
}
