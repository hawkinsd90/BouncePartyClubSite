export interface User {
  id: string;
  email: string;
  name?: string;
  role?: 'CUSTOMER' | 'ADMIN' | 'CREW' | 'MASTER';
  created_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  status: 'draft' | 'pending_review' | 'awaiting_customer_approval' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'void';
  event_date: string;
  event_end_date?: string;
  location_type: 'residential' | 'commercial';
  surface: 'grass' | 'cement';
  pickup_preference: 'same_day' | 'next_day';
  subtotal_cents: number;
  travel_fee_cents: number;
  travel_total_miles: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  generator_fee_cents: number;
  generator_qty: number;
  tax_cents: number;
  tip_cents?: number;
  total_cents: number;
  deposit_due_cents: number;
  deposit_paid_cents: number;
  balance_due_cents: number;
  custom_deposit_cents?: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  unit_id: string;
  qty: number;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  created_at: string;
}

export interface Unit {
  id: string;
  slug: string;
  name: string;
  type: string;
  description?: string;
  price_dry_cents: number;
  price_water_cents?: number;
  quantity_available: number;
  active: boolean;
  is_combo: boolean;
  features_json?: string[];
  dimensions_dry?: string;
  dimensions_wet?: string;
  created_at: string;
}

export interface Address {
  id: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
}

export interface Contact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  business_name?: string;
  bookings_count: number;
  total_spent_cents: number;
  created_at: string;
}

export interface CartItem {
  unit_id: string;
  unit_name: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  qty: number;
  is_combo?: boolean;
}

export interface PricingRules {
  base_radius_miles: number;
  included_city_list_json: string[];
  per_mile_after_base_cents: number;
  zone_overrides_json: Array<{
    cities?: string[];
    zips?: string[];
    flat_fee_cents: number;
  }>;
  surface_sandbag_fee_cents: number;
  residential_multiplier: number;
  commercial_multiplier: number;
  same_day_matrix_json: Array<{
    unit_count_min: number;
    unit_count_max: number;
    fee_cents: number;
  }>;
  overnight_holiday_only: boolean;
  extra_day_pct: number;
  generator_price_cents: number;
}

export interface BlackoutDate {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  notes: string | null;
  block_type: 'full' | 'same_day_pickup';
  recurrence: 'one_time' | 'annual';
  expires_at: string | null;
  created_at: string;
}

export interface ProductCategory {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  active: boolean;
  public_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  total_quantity: number;
  temp_unavailable_qty: number;
  active: boolean;
  public_visible: boolean;
  category_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductBundle {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  standalone_price_cents: number | null;
  addon_price_cents: number | null;
  standalone_enabled: boolean;
  addon_enabled: boolean;
  active: boolean;
  public_visible: boolean;
  menu_visible: boolean;
  featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductBundleComponent {
  id: string;
  bundle_id: string;
  product_id: string;
  quantity_per_bundle: number;
}

export interface ProductPricing {
  id: string;
  product_id: string;
  standalone_price_cents: number | null;
  addon_price_cents: number | null;
  standalone_enabled: boolean;
  addon_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

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

export interface ProductAvailabilityRequestItem {
  product_id: string;
  quantity: number;
}

export interface ProductAvailabilityResult {
  product_id: string;
  product_name: string;
  total_quantity: number;
  temp_unavailable_qty: number;
  already_reserved: number;
  quantity_requested: number;
  available_before_request: number;
  remaining_after_request: number;
  is_allowed: boolean;
}

export interface ProductBundleComponentWithProduct extends ProductBundleComponent {
  inventory_products: {
    id: string;
    slug: string;
    name: string;
    category_id: string | null;
  } | null;
}

export interface ProductBundleWithComponents extends ProductBundle {
  product_bundle_components: ProductBundleComponentWithProduct[];
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

export interface FormErrors {
  [key: string]: string | undefined;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}
