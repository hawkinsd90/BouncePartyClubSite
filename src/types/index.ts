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
  status: 'draft' | 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'void';
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

export interface FormErrors {
  [key: string]: string | undefined;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}
