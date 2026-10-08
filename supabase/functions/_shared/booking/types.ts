// GENERATED COPY of src/types/index.ts (sliced). Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

export interface BundleComponentSnapshotItem {
  product_id: string;
  product_name: string;
  quantity_per_bundle: number;
}

export interface BundleComponentSnapshot {
  bundle_name: string;
  bundle_description: string | null;
  components: BundleComponentSnapshotItem[];
}

export type CartItemType = 'inflatable' | 'event_essential_product' | 'event_essential_bundle';
export type PricingContext = 'standalone' | 'addon';

export interface InflatableCartItem {
  item_type?: 'inflatable';
  unit_id: string;
  unit_name: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  price_dry_cents?: number;
  price_water_cents?: number;
  qty: number;
  is_combo?: boolean;
  isAvailable?: boolean;
}

export interface EventEssentialProductCartItem {
  item_type: 'event_essential_product';
  product_id: string;
  product_name: string;
  unit_price_cents: number;
  qty: number;
  pricing_context: PricingContext;
  isAvailable?: boolean;
}

export interface EventEssentialBundleCartItem {
  item_type: 'event_essential_bundle';
  bundle_id: string;
  bundle_name: string;
  unit_price_cents: number;
  qty: number;
  pricing_context: PricingContext;
  component_snapshot: BundleComponentSnapshot;
  isAvailable?: boolean;
}

export type UnifiedCartItem =
  | InflatableCartItem
  | EventEssentialProductCartItem
  | EventEssentialBundleCartItem;
