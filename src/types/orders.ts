export interface Payment {
  id: string;
  type: string;
  amount_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
  created_at: string;
  paid_at: string | null;
  payment_method: string | null;
  payment_brand: string | null;
  payment_last4: string | null;
}

export interface OrderItem {
  id: string;
  unit_id: string;
  wet_or_dry: string;
  qty: number;
  unit_price_cents: number;
  units: {
    name: string;
    active?: boolean;
  };
}

export interface Order {
  id: string;
  status: string;
  event_date: string;
  event_end_date: string;
  event_start_time: string | null;
  event_end_time: string | null;
  start_window: string | null;
  end_window: string | null;
  location_type: string;
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents?: number;
  generator_fee_cents?: number;
  tax_cents: number;
  tip_cents?: number;
  deposit_due_cents: number;
  deposit_paid_cents: number;
  balance_due_cents: number;
  balance_paid_cents: number;
  created_at: string;
  can_stake?: boolean;
  generator_qty?: number;
  has_pets?: boolean;
  special_details?: string | null;
  pickup_preference?: string | null;
  workflow_status?: string;
  customers: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    business_name?: string | null;
  };
  addresses: {
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    zip: string;
    lat?: number;
    lng?: number;
  } | null;
  waiver_signed_at: string | null;
  signed_waiver_url: string | null;
  customer_id: string;
  payments?: Payment[];
  order_items?: OrderItem[];
}
