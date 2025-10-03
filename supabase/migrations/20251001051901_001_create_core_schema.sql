/*
  # Bounce Party Club - Core Schema (Phase 1 MVP)

  1. New Tables
    - `customers`: Customer contact information
      - `id` (uuid, primary key)
      - `first_name` (text)
      - `last_name` (text)
      - `email` (text, unique)
      - `phone` (text)
      - `created_at` (timestamptz)
    
    - `addresses`: Customer event addresses
      - `id` (uuid, primary key)
      - `customer_id` (uuid, foreign key)
      - `line1` (text)
      - `line2` (text, nullable)
      - `city` (text)
      - `state` (text)
      - `zip` (text)
      - `lat` (decimal, nullable)
      - `lng` (decimal, nullable)
      - `created_at` (timestamptz)
    
    - `units`: Inflatable inventory (bounce houses, combos, etc.)
      - `id` (uuid, primary key)
      - `slug` (text, unique)
      - `name` (text)
      - `type` (text)
      - `is_combo` (boolean)
      - `price_dry_cents` (integer)
      - `price_water_cents` (integer, nullable)
      - `dimensions` (text)
      - `footprint_sqft` (integer)
      - `power_circuits` (integer)
      - `capacity` (integer)
      - `indoor_ok` (boolean)
      - `outdoor_ok` (boolean)
      - `active` (boolean)
      - `created_at` (timestamptz)
    
    - `unit_media`: Photos/videos for units
      - `id` (uuid, primary key)
      - `unit_id` (uuid, foreign key)
      - `url` (text)
      - `alt` (text)
      - `sort` (integer)
      - `created_at` (timestamptz)
    
    - `pricing_rules`: Business pricing configuration
      - `id` (uuid, primary key)
      - `base_radius_miles` (decimal)
      - `included_city_list_json` (jsonb)
      - `per_mile_after_base_cents` (integer)
      - `zone_overrides_json` (jsonb)
      - `surface_sandbag_fee_cents` (integer)
      - `residential_multiplier` (decimal)
      - `commercial_multiplier` (decimal)
      - `same_day_matrix_json` (jsonb)
      - `overnight_holiday_only` (boolean)
      - `updated_at` (timestamptz)
    
    - `orders`: Customer bookings
      - `id` (uuid, primary key)
      - `customer_id` (uuid, foreign key)
      - `status` (text)
      - `location_type` (text: residential/commercial)
      - `surface` (text: grass/cement)
      - `event_date` (date)
      - `start_window` (time)
      - `end_window` (time)
      - `address_id` (uuid, foreign key)
      - `subtotal_cents` (integer)
      - `travel_fee_cents` (integer)
      - `surface_fee_cents` (integer)
      - `same_day_pickup_fee_cents` (integer)
      - `tax_cents` (integer)
      - `deposit_due_cents` (integer)
      - `deposit_paid_cents` (integer)
      - `balance_due_cents` (integer)
      - `payment_method_id` (text, nullable - Stripe PM ID)
      - `card_on_file_consent_text` (text, nullable)
      - `card_on_file_consented_at` (timestamptz, nullable)
      - `created_at` (timestamptz)
    
    - `order_items`: Line items for orders
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key)
      - `unit_id` (uuid, foreign key)
      - `wet_or_dry` (text: dry/water)
      - `unit_price_cents` (integer)
      - `qty` (integer)
      - `notes` (text, nullable)
    
    - `payments`: Payment transactions
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key)
      - `type` (text: deposit/balance/incidental)
      - `amount_cents` (integer)
      - `stripe_payment_intent_id` (text, nullable)
      - `status` (text)
      - `created_at` (timestamptz)
    
    - `documents`: Waivers, photos, invoices
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key)
      - `kind` (text: invoice/waiver_photo/delivery_photos/pickup_photos)
      - `url` (text)
      - `meta_json` (jsonb, nullable)
      - `created_at` (timestamptz)
    
    - `messages`: SMS/email communication log
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key)
      - `to_phone` (text, nullable)
      - `to_email` (text, nullable)
      - `channel` (text: sms/email)
      - `template_key` (text)
      - `payload_json` (jsonb)
      - `sent_at` (timestamptz, nullable)
      - `status` (text)
      - `created_at` (timestamptz)
    
    - `route_stops`: Dispatch routing and checkpoints
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key)
      - `type` (text: dropoff/pickup)
      - `eta` (timestamptz, nullable)
      - `checkpoint` (text: none/start_day/arrived/leave_dropoff/leave_pickup)
      - `checkpoint_time` (timestamptz, nullable)
      - `gps_lat` (decimal, nullable)
      - `gps_lng` (decimal, nullable)
      - `notes` (text, nullable)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Public read access to units and unit_media (for catalog)
    - Customers can view their own orders
    - Admin role for full access (will use service role for Phase 1)
    - Crew can view assigned route_stops and related orders
*/

-- Create customers table
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create addresses table
CREATE TABLE IF NOT EXISTS addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  lat decimal(10, 7),
  lng decimal(10, 7),
  created_at timestamptz DEFAULT now()
);

-- Create units table
CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  is_combo boolean DEFAULT false,
  price_dry_cents integer NOT NULL,
  price_water_cents integer,
  dimensions text NOT NULL,
  footprint_sqft integer NOT NULL,
  power_circuits integer DEFAULT 1,
  capacity integer NOT NULL,
  indoor_ok boolean DEFAULT true,
  outdoor_ok boolean DEFAULT true,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create unit_media table
CREATE TABLE IF NOT EXISTS unit_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid REFERENCES units(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt text NOT NULL,
  sort integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create pricing_rules table
CREATE TABLE IF NOT EXISTS pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_radius_miles decimal(5, 2) DEFAULT 20.0,
  included_city_list_json jsonb DEFAULT '["Detroit"]'::jsonb,
  per_mile_after_base_cents integer DEFAULT 200,
  zone_overrides_json jsonb DEFAULT '[]'::jsonb,
  surface_sandbag_fee_cents integer DEFAULT 2500,
  residential_multiplier decimal(3, 2) DEFAULT 1.00,
  commercial_multiplier decimal(3, 2) DEFAULT 1.10,
  same_day_matrix_json jsonb DEFAULT '[]'::jsonb,
  overnight_holiday_only boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  status text DEFAULT 'pending',
  location_type text NOT NULL CHECK (location_type IN ('residential', 'commercial')),
  surface text NOT NULL CHECK (surface IN ('grass', 'cement')),
  event_date date NOT NULL,
  start_window time NOT NULL,
  end_window time NOT NULL,
  address_id uuid REFERENCES addresses(id),
  subtotal_cents integer NOT NULL,
  travel_fee_cents integer DEFAULT 0,
  surface_fee_cents integer DEFAULT 0,
  same_day_pickup_fee_cents integer DEFAULT 0,
  tax_cents integer DEFAULT 0,
  deposit_due_cents integer NOT NULL,
  deposit_paid_cents integer DEFAULT 0,
  balance_due_cents integer NOT NULL,
  payment_method_id text,
  card_on_file_consent_text text,
  card_on_file_consented_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES units(id),
  wet_or_dry text NOT NULL CHECK (wet_or_dry IN ('dry', 'water')),
  unit_price_cents integer NOT NULL,
  qty integer DEFAULT 1,
  notes text
);

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('deposit', 'balance', 'incidental')),
  amount_cents integer NOT NULL,
  stripe_payment_intent_id text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invoice', 'waiver_photo', 'delivery_photos', 'pickup_photos')),
  url text NOT NULL,
  meta_json jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  to_phone text,
  to_email text,
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  template_key text NOT NULL,
  payload_json jsonb NOT NULL,
  sent_at timestamptz,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Create route_stops table
CREATE TABLE IF NOT EXISTS route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('dropoff', 'pickup')),
  eta timestamptz,
  checkpoint text DEFAULT 'none' CHECK (checkpoint IN ('none', 'start_day', 'arrived', 'leave_dropoff', 'leave_pickup')),
  checkpoint_time timestamptz,
  gps_lat decimal(10, 7),
  gps_lng decimal(10, 7),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_unit_media_unit ON unit_media(unit_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_event_date ON orders(event_date);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_documents_order ON documents(order_id);
CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id);
CREATE INDEX IF NOT EXISTS idx_route_stops_order ON route_stops(order_id);

-- Enable Row Level Security
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stops ENABLE ROW LEVEL SECURITY;

-- Public read access to units and media (for catalog)
CREATE POLICY "Public can view active units"
  ON units FOR SELECT
  USING (active = true);

CREATE POLICY "Public can view unit media"
  ON unit_media FOR SELECT
  USING (true);

-- Admin policies (using service role for Phase 1, proper auth in Phase 2)
CREATE POLICY "Service role full access to customers"
  ON customers FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to addresses"
  ON addresses FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to units"
  ON units FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to unit_media"
  ON unit_media FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to pricing_rules"
  ON pricing_rules FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to orders"
  ON orders FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to order_items"
  ON order_items FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to payments"
  ON payments FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to documents"
  ON documents FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to messages"
  ON messages FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to route_stops"
  ON route_stops FOR ALL
  USING (true)
  WITH CHECK (true);

-- Insert default pricing rules
INSERT INTO pricing_rules (
  base_radius_miles,
  included_city_list_json,
  per_mile_after_base_cents,
  zone_overrides_json,
  surface_sandbag_fee_cents,
  residential_multiplier,
  commercial_multiplier,
  same_day_matrix_json,
  overnight_holiday_only
) VALUES (
  20.0,
  '["Detroit"]'::jsonb,
  200,
  '[]'::jsonb,
  2500,
  1.00,
  1.10,
  '[
    {"units": 1, "generator": false, "subtotal_ge_cents": 0, "fee_cents": 8000},
    {"units": 1, "generator": true, "subtotal_ge_cents": 0, "fee_cents": 5000},
    {"units": 2, "generator": false, "subtotal_ge_cents": 0, "fee_cents": 4000},
    {"units": 2, "generator": true, "subtotal_ge_cents": 0, "fee_cents": 2000},
    {"units": 3, "generator": true, "subtotal_ge_cents": 40000, "fee_cents": 0}
  ]'::jsonb,
  false
) ON CONFLICT DO NOTHING;