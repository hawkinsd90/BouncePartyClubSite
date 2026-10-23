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

// One stored order line as get_my_orders returns it (every field is optional: older and Event Essentials lines carry different subsets).
export interface StoredOrderLine {
  id?: string | null;
  qty?: number | string | null;
  unit_id?: string | null;
  units?: {
    name?: string | null;
    active?: boolean | null;
    types?: unknown;
    is_combo?: boolean | null;
    price_dry_cents?: number | null;
    price_water_cents?: number | null;
  } | null;
  wet_or_dry?: string | null;
  unit_price_cents?: number | null;
  item_name?: string | null;
  bundle_id?: string | null;
  product_id?: string | null;
  pricing_context?: unknown;
  component_snapshot?: unknown;
}

function isUsableSnapshot(value: unknown): value is BundleComponentSnapshot {
  return !!value && typeof value === 'object' && Array.isArray((value as { components?: unknown }).components);
}

// The name stored inside a bundle snapshot, read exactly as the pre-cleanup code did (optional chaining on whatever is stored; a type assertion only).
function snapshotBundleName(value: unknown): string | undefined {
  return (value as { bundle_name?: string } | null | undefined)?.bundle_name;
}

export function buildDuplicateCart(items: StoredOrderLine[] | null | undefined): DuplicateCartResult {
  const cartItems: UnifiedCartItem[] = [];
  const unavailable: string[] = [];

  for (const item of items ?? []) {
    const qty = Number(item?.qty) > 0 ? Number(item.qty) : 1;

    if (item?.unit_id) {
      const unit = item.units;
      if (unit && unit.active !== false) {
        const types: string[] = Array.isArray(unit.types) ? (unit.types as string[]) : [];
        cartItems.push({
          item_type: 'inflatable',
          unit_id: item.unit_id,
          // The database guarantees these (units.name, units.price_dry_cents and order_items.unit_price_cents are NOT NULL and get_my_orders returns
          // them), so they are asserted, NOT defaulted: a missing value must stay missing, exactly as before. The saved cart is reloaded through
          // normalizeCartItems, which drops a line without a name or price, and Quote re-hydrates a combo whose prices are null/undefined from the
          // catalog. A default of ''/0 would instead keep a $0 line and skip that hydration.
          unit_name: unit.name as string,
          wet_or_dry: item.wet_or_dry === 'water' ? 'water' : 'dry',
          unit_price_cents: item.unit_price_cents as number,
          price_dry_cents: (unit.price_dry_cents ?? item.unit_price_cents) as number | undefined,
          price_water_cents: (unit.price_water_cents || unit.price_dry_cents || item.unit_price_cents) as number | undefined,
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
        bundle_name: item.item_name || snapshotBundleName(item.component_snapshot) || 'Event Essentials package',
        unit_price_cents: item.unit_price_cents as number, // asserted, not defaulted (see the inflatable line above)
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
        unit_price_cents: item.unit_price_cents as number, // asserted, not defaulted (see the inflatable line above)
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
export function describeOrderLine(item: StoredOrderLine | null | undefined): { name: string; badge: 'Wet' | 'Dry' | null } {
  const unitName = item?.units?.name;
  if (item?.unit_id && unitName) {
    return { name: unitName, badge: item.wet_or_dry === 'water' ? 'Wet' : 'Dry' };
  }
  return { name: item?.item_name || snapshotBundleName(item?.component_snapshot) || 'Event Essentials item', badge: null };
}

// Prefill for "can we use stakes?". Only meaningful when the cart has inflatables (Quote does not ask otherwise). The booked
// surface is the source of truth: the server stores surface 'grass' when stakes were allowed.
export function duplicateCanStake(order: { surface?: string | null; can_use_stakes?: boolean | null }, hasInflatables: boolean): boolean | null {
  if (!hasInflatables) return null;
  if (order.surface === 'grass') return true;
  if (order.surface === 'cement') return false;
  return typeof order.can_use_stakes === 'boolean' ? order.can_use_stakes : null;
}
