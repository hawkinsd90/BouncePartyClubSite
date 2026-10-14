// GENERATED COPY of src/lib/eventEssentials/unifiedCart.ts (sliced). Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/tooling/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

import type {
  UnifiedCartItem,
  InflatableCartItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
} from './types.ts';

export function isInflatableCartItem(item: UnifiedCartItem): item is InflatableCartItem {
  return item.item_type === undefined || item.item_type === 'inflatable';
}

export function isEventEssentialProductCartItem(
  item: UnifiedCartItem
): item is EventEssentialProductCartItem {
  return item.item_type === 'event_essential_product';
}

export function isEventEssentialBundleCartItem(
  item: UnifiedCartItem
): item is EventEssentialBundleCartItem {
  return item.item_type === 'event_essential_bundle';
}
