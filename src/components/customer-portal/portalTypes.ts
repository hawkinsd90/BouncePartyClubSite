// Shapes the Customer Portal screens receive from the customer-portal-data Edge Function.
//
// The server sends an ALLOWLIST of columns (PORTAL_ORDER_FIELDS and the project* functions in
// supabase/functions/_shared/portal/portal-projection.ts); these types list exactly those names. Column types follow the migrated database.
// A column that is nullable in the database but always has a default the app relies on (the money columns default to 0) is typed as a plain
// number, as the screens already treat it; nothing here changes what the screens do with the values.

import type { BundleComponentSnapshot } from '../../types';

export interface PortalCustomer {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  business_name?: string | null;
}

export interface PortalAddress {
  id?: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
  lat?: number | null;
  lng?: number | null;
}

export interface PortalPayment {
  id: string;
  order_id?: string;
  amount_cents: number;
  type: string;
  status: string;
  payment_method: string | null;
  payment_last4: string | null;
  payment_brand: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface PortalOrder {
  id: string;
  customer_id: string | null;
  status: string;
  workflow_status: string | null;
  location_type: string;
  surface: string | null;
  can_use_stakes: boolean | null;
  has_pets: boolean | null;
  special_details: string | null;
  event_date: string;
  event_end_date: string;
  start_window: string;
  end_window: string;
  event_start_time: string | null;
  event_end_time: string | null;
  pickup_preference: string;
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  same_day_weekday_delivery_fee_cents: number;
  generator_fee_cents: number;
  generator_qty: number;
  setup_fee_cents: number;
  tax_cents: number;
  tip_cents: number;
  travel_total_miles: number | null;
  travel_per_mile_cents: number | null;
  travel_fee_waived: boolean;
  surface_fee_waived: boolean;
  same_day_pickup_fee_waived: boolean;
  same_day_weekday_delivery_fee_waived: boolean;
  generator_fee_waived: boolean;
  tax_waived: boolean;
  waived_fee_amounts_cents: Record<string, number> | null;
  deposit_due_cents: number;
  deposit_paid_cents: number;
  balance_due_cents: number;
  balance_paid_cents: number;
  custom_deposit_cents: number | null;
  customer_selected_payment_cents: number | null;
  customer_selected_payment_type: string | null;
  stripe_payment_status: string | null;
  payment_method_brand: string | null;
  payment_method_last_four: string | null;
  require_card_on_file: boolean;
  referral_source: string | null;
  referral_source_detail: string | null;
  lot_pictures_requested: boolean;
  waiver_signed_at: string | null;
  admin_message: string | null;
  parks_acknowledgment_required: boolean;
  parks_acknowledgment_county: string | null;
  // Added by the server projection (not columns).
  has_saved_card?: boolean;
  has_signed_waiver_document?: boolean;
  customers?: PortalCustomer | null;
  addresses?: PortalAddress | null;
  payments?: PortalPayment[];
  // Names the screens still read although the server never sends them (not columns of orders; they are always undefined today).
  total_cents?: number;
  order_number?: string;
  customer_email?: string;
  // This order's own delivery unit (NULL = legacy order: addresses.line2 already carries it after projection).
  event_address_line2?: string | null;
}

export interface PortalChangelogEntry {
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

// One order line as projectOrderItem sends it (inflatable lines carry `units`; Event Essentials lines carry product_id / bundle_id,
// item_name, pricing_context and component_snapshot, and have no unit).
export interface PortalOrderItem {
  id: string;
  order_id?: string | null;
  unit_id: string | null;
  product_id?: string | null;
  bundle_id?: string | null;
  item_name?: string | null;
  pricing_context?: string | null;
  component_snapshot?: BundleComponentSnapshot | null;
  qty: number;
  wet_or_dry: string | null;
  unit_price_cents: number;
  units?: {
    id?: string;
    name: string;
    types?: string[] | null;
    price_dry_cents?: number | null;
    price_water_cents?: number | null;
    dimensions?: string | null;
    capacity?: number | null;
  } | null;
}
