-- =====================================================
-- COMPLETE DATABASE MIGRATION SCRIPT
-- Apply this entire script in the SQL Editor of your NEW Supabase project
-- =====================================================

-- This script combines all 43 migration files in the correct order
-- Each migration is separated by comments for clarity


-- =====================================================
-- MIGRATION: 20251001051900_000_create_user_roles.sql
-- =====================================================

/*
  # Create user_roles table

  1. New Tables
    - `user_roles`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `role` (text, CHECK constraint for ADMIN/CREW)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `user_roles` table
    - Users can read their own role
    - Only admins can manage roles (will be set up in later migration)
*/

-- Create user_roles table
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'CREW')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

-- Enable Row Level Security
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role
CREATE POLICY "Users can read own role"
  ON user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role has full access (will be refined in later migration)
CREATE POLICY "Service role full access to user_roles"
  ON user_roles FOR ALL
  USING (true)
  WITH CHECK (true);



-- =====================================================
-- MIGRATION: 20251001051901_001_create_core_schema.sql
-- =====================================================

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


-- =====================================================
-- MIGRATION: 20251001052039_002_seed_sample_units.sql
-- =====================================================

/*
  # Seed Sample Units for Bounce Party Club

  1. Sample Data
    - Insert 8 diverse inflatable units (bounce houses, combos, water slides)
    - Each unit includes realistic pricing, dimensions, and specifications
    - Mix of dry-only and combo (dry/water) units
    - Sample media URLs using Pexels stock photos
  
  2. Unit Types
    - Standard bounce houses
    - Combo units (bounce + slide)
    - Water slides
    - Different sizes and capacities for various age groups
*/

-- Insert sample units
INSERT INTO units (slug, name, type, is_combo, price_dry_cents, price_water_cents, dimensions, footprint_sqft, power_circuits, capacity, indoor_ok, outdoor_ok, active)
VALUES
  (
    'tropical-bounce-house',
    'Tropical Bounce House',
    'Bounce House',
    false,
    15000,
    NULL,
    '15L x 15W x 15H',
    225,
    1,
    8,
    true,
    true,
    true
  ),
  (
    'castle-combo',
    'Castle Combo with Slide',
    'Combo',
    true,
    25000,
    30000,
    '20L x 15W x 16H',
    300,
    1,
    10,
    false,
    true,
    true
  ),
  (
    'mega-water-slide',
    'Mega Water Slide',
    'Water Slide',
    true,
    35000,
    40000,
    '30L x 12W x 18H',
    360,
    2,
    12,
    false,
    true,
    true
  ),
  (
    'kiddie-bounce',
    'Kiddie Bounce',
    'Bounce House',
    false,
    12000,
    NULL,
    '10L x 10W x 10H',
    100,
    1,
    6,
    true,
    true,
    true
  ),
  (
    'obstacle-course',
    'Obstacle Course Challenge',
    'Obstacle Course',
    false,
    45000,
    NULL,
    '40L x 12W x 12H',
    480,
    2,
    15,
    false,
    true,
    true
  ),
  (
    'rainbow-combo',
    'Rainbow Combo Jumper',
    'Combo',
    true,
    22000,
    27000,
    '18L x 15W x 15H',
    270,
    1,
    10,
    false,
    true,
    true
  ),
  (
    'double-lane-slide',
    'Double Lane Water Slide',
    'Water Slide',
    true,
    38000,
    42000,
    '32L x 15W x 20H',
    480,
    2,
    16,
    false,
    true,
    true
  ),
  (
    'sports-bounce',
    'Sports Arena Bounce House',
    'Bounce House',
    false,
    18000,
    NULL,
    '15L x 15W x 15H',
    225,
    1,
    8,
    true,
    true,
    true
  )
ON CONFLICT (slug) DO NOTHING;

-- Insert sample media for units
INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'tropical-bounce-house'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'castle-combo'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'mega-water-slide'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'kiddie-bounce'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'obstacle-course'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'rainbow-combo'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'double-lane-slide'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'sports-bounce'
ON CONFLICT DO NOTHING;



-- =====================================================
-- MIGRATION: 20251001192425_004_add_new_order_fields.sql
-- =====================================================

/*
  # Add New Order and Pricing Fields

  1. Orders Table Updates
    - Add start_date and end_date for multi-day rentals
    - Add overnight_allowed flag
    - Add can_use_stakes flag for grass surface
    - Add generator_selected flag
    - Rename/clarify existing fee columns

  2. Pricing Rules Updates
    - Update surface_sandbag_fee_cents default to 3000 ($30)
    - Add extra_day_pct for multi-day pricing (default 50%)

  3. Notes
    - start_date defaults to event_date for single-day rentals
    - end_date defaults to event_date for single-day rentals
    - overnight_allowed defaults to true for residential, false for commercial
*/

-- Add new columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS overnight_allowed boolean DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS can_use_stakes boolean DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS generator_selected boolean DEFAULT false;

-- Update existing orders to have start_date and end_date from event_date
UPDATE orders 
SET start_date = event_date, end_date = event_date 
WHERE start_date IS NULL;

-- Make start_date and end_date non-nullable after backfilling
ALTER TABLE orders ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE orders ALTER COLUMN end_date SET NOT NULL;

-- Add extra_day_pct to pricing_rules
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS extra_day_pct decimal(5,2) DEFAULT 50.00;

-- Update sandbag fee to $30 (3000 cents)
UPDATE pricing_rules SET surface_sandbag_fee_cents = 3000;

-- Add index for date range queries
CREATE INDEX IF NOT EXISTS idx_orders_date_range ON orders(start_date, end_date);



-- =====================================================
-- MIGRATION: 20251002180149_005_update_home_base_wayne_mi.sql
-- =====================================================

/*
  # Update Home Base to Wayne, MI

  This migration updates the pricing configuration to reflect the correct home base location
  and service area coverage.

  ## Changes Made:
  
  1. **Home Base Location**: Changed from Detroit to Wayne, MI (4426 Woodward St, Wayne, MI 48184)
     - Coordinates: 42.2808° N, 83.3863° W
  
  2. **Service Area Coverage**:
     - Free delivery within 20-mile radius of Wayne, MI
     - Free delivery to the entire city of Detroit (regardless of distance)
     - Travel fee of $5.00 per mile beyond the 20-mile radius
  
  3. **Updated Included Cities**:
     - Added "Detroit" to the included_city_list_json to ensure free delivery
  
  ## Notes:
  - The base_radius_miles remains at 20 miles
  - The per_mile_after_base_cents is updated to 500 ($5.00 per mile)
  - Detroit is explicitly included in the free delivery zone
*/

UPDATE pricing_rules
SET 
  per_mile_after_base_cents = 500,
  included_city_list_json = '["Detroit"]'::jsonb,
  updated_at = now()
WHERE id IS NOT NULL;



-- =====================================================
-- MIGRATION: 20251002195907_006_add_unit_inventory.sql
-- =====================================================

/*
  # Add Unit Inventory Tracking

  1. Changes
    - Add `quantity_available` column to units table (default 1)
    - This tracks how many of each unit we have in inventory
    
  2. Purpose
    - Enable availability checking to prevent double-booking
    - Each unit can have multiple copies (quantity > 1)
*/

-- Add quantity tracking to units
ALTER TABLE units 
ADD COLUMN IF NOT EXISTS quantity_available integer DEFAULT 1 NOT NULL;

COMMENT ON COLUMN units.quantity_available IS 'Total number of this unit available in inventory';



-- =====================================================
-- MIGRATION: 20251002195922_007_add_availability_check_function.sql
-- =====================================================

/*
  # Add Availability Check Function

  1. New Function
    - `check_unit_availability` - Checks if requested units are available on a date
    - Takes unit_ids array and event_date
    - Returns array of unavailable unit IDs
    
  2. Purpose
    - Prevent double-booking of units
    - Check against confirmed and pending_review orders
*/

CREATE OR REPLACE FUNCTION check_unit_availability(
  p_unit_ids uuid[],
  p_event_date date
)
RETURNS TABLE(unit_id uuid, requested_qty integer, available_qty integer, is_available boolean)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH unit_requests AS (
    SELECT 
      unnest(p_unit_ids) AS uid,
      COUNT(*) AS requested
    FROM unnest(p_unit_ids) AS uid
    GROUP BY uid
  ),
  booked_units AS (
    SELECT 
      oi.unit_id,
      SUM(oi.qty) AS booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.event_date = p_event_date
      AND o.status IN ('pending_review', 'confirmed', 'in_progress')
      AND oi.unit_id = ANY(p_unit_ids)
    GROUP BY oi.unit_id
  )
  SELECT 
    ur.uid AS unit_id,
    ur.requested::integer AS requested_qty,
    COALESCE(u.quantity_available - COALESCE(bu.booked, 0), u.quantity_available)::integer AS available_qty,
    ur.requested <= COALESCE(u.quantity_available - COALESCE(bu.booked, 0), u.quantity_available) AS is_available
  FROM unit_requests ur
  JOIN units u ON u.id = ur.uid
  LEFT JOIN booked_units bu ON bu.unit_id = ur.uid;
END;
$$;

COMMENT ON FUNCTION check_unit_availability IS 'Check if requested units are available on a specific date';



-- =====================================================
-- MIGRATION: 20251002210020_008_add_admin_settings.sql
-- =====================================================

/*
  # Admin Settings Configuration

  1. New Tables
    - `admin_settings`
      - `id` (uuid, primary key)
      - `key` (text, unique) - Setting identifier
      - `value` (text) - Setting value
      - `description` (text) - Human-readable description
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `admin_settings` table
    - Add policies for authenticated admin users only

  3. Initial Data
    - Insert admin notification phone number
*/

CREATE TABLE IF NOT EXISTS admin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin users can read settings"
  ON admin_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admin users can update settings"
  ON admin_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admin users can insert settings"
  ON admin_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Insert admin notification phone number
INSERT INTO admin_settings (key, value, description)
VALUES (
  'admin_notification_phone',
  '+13138893860',
  'Phone number to receive SMS notifications for new bookings'
) ON CONFLICT (key) DO NOTHING;


-- =====================================================
-- MIGRATION: 20251003111105_009_add_sms_conversations.sql
-- =====================================================

/*
  # SMS Conversations Table

  1. New Tables
    - `sms_conversations`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders) - Links SMS to a specific booking
      - `from_phone` (text) - Phone number that sent the message
      - `to_phone` (text) - Phone number that received the message
      - `message_body` (text) - Content of the SMS
      - `direction` (text) - 'inbound' or 'outbound'
      - `twilio_message_sid` (text) - Twilio's unique message ID
      - `status` (text) - Message status (queued, sent, delivered, failed, received)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `sms_conversations` table
    - Add policies for authenticated admin users only

  3. Indexes
    - Index on order_id for fast lookup
    - Index on from_phone for customer lookup
    - Index on created_at for chronological ordering
*/

CREATE TABLE IF NOT EXISTS sms_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  from_phone text NOT NULL,
  to_phone text NOT NULL,
  message_body text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  twilio_message_sid text,
  status text DEFAULT 'received',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin users can read SMS conversations"
  ON sms_conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admin users can insert SMS conversations"
  ON sms_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Allow the edge function to insert (using service role key)
CREATE POLICY "Service role can insert SMS conversations"
  ON sms_conversations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sms_conversations_order_id ON sms_conversations(order_id);
CREATE INDEX IF NOT EXISTS idx_sms_conversations_from_phone ON sms_conversations(from_phone);
CREATE INDEX IF NOT EXISTS idx_sms_conversations_created_at ON sms_conversations(created_at DESC);


-- =====================================================
-- MIGRATION: 20251003122900_010_add_contacts_and_invoices.sql
-- =====================================================

/*
  # Add Contacts and Invoices Tables

  1. New Tables
    - `contacts`
      - `id` (uuid, primary key)
      - `customer_id` (uuid, foreign key to customers) - Links to customer record
      - `first_name` (text)
      - `last_name` (text)
      - `email` (text, unique)
      - `phone` (text)
      - `opt_in_email` (boolean) - Permission for marketing emails
      - `opt_in_sms` (boolean) - Permission for marketing SMS
      - `source` (text) - How they were added (booking, manual, import)
      - `tags` (text array) - For segmentation
      - `last_contact_date` (timestamptz) - Last time contacted
      - `total_bookings` (integer) - Number of bookings
      - `total_spent_cents` (integer) - Lifetime value
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `invoices`
      - `id` (uuid, primary key)
      - `invoice_number` (text, unique) - Human-readable invoice number
      - `order_id` (uuid, foreign key to orders)
      - `customer_id` (uuid, foreign key to customers)
      - `invoice_date` (date)
      - `due_date` (date)
      - `status` (text) - draft, sent, paid, cancelled
      - `subtotal_cents` (integer)
      - `tax_cents` (integer)
      - `travel_fee_cents` (integer)
      - `surface_fee_cents` (integer)
      - `same_day_pickup_fee_cents` (integer)
      - `total_cents` (integer)
      - `paid_amount_cents` (integer) - Amount paid so far
      - `payment_method` (text) - cash, card, check, etc.
      - `notes` (text)
      - `pdf_url` (text) - Stored invoice PDF
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Admin users can manage all records
    - Service role can insert/update for automation

  3. Indexes
    - Index on email and phone for quick lookups
    - Index on invoice_number for searching
    - Index on order_id for invoice lookups

  4. Functions
    - Auto-update contact stats when orders change
    - Generate invoice numbers automatically
*/

-- Create contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  opt_in_email boolean DEFAULT true,
  opt_in_sms boolean DEFAULT true,
  source text DEFAULT 'booking',
  tags text[] DEFAULT '{}',
  last_contact_date timestamptz,
  total_bookings integer DEFAULT 0,
  total_spent_cents integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  invoice_date date DEFAULT CURRENT_DATE,
  due_date date,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')),
  subtotal_cents integer NOT NULL,
  tax_cents integer DEFAULT 0,
  travel_fee_cents integer DEFAULT 0,
  surface_fee_cents integer DEFAULT 0,
  same_day_pickup_fee_cents integer DEFAULT 0,
  total_cents integer NOT NULL,
  paid_amount_cents integer DEFAULT 0,
  payment_method text,
  notes text,
  pdf_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- RLS Policies for contacts
CREATE POLICY "Admin users can read all contacts"
  ON contacts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admin users can insert contacts"
  ON contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admin users can update contacts"
  ON contacts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Service role can manage contacts"
  ON contacts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for invoices
CREATE POLICY "Admin users can read all invoices"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admin users can insert invoices"
  ON invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admin users can update invoices"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Service role can manage invoices"
  ON invoices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_customer_id ON contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);

-- Function to generate invoice numbers
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
  invoice_num text;
BEGIN
  -- Get the next invoice number (format: INV-YYYY-0001)
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(invoice_number FROM 'INV-[0-9]{4}-([0-9]+)') AS integer)
  ), 0) + 1
  INTO next_num
  FROM invoices
  WHERE invoice_number LIKE 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-%';
  
  invoice_num := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(next_num::text, 4, '0');
  
  RETURN invoice_num;
END;
$$;

-- Function to update contact statistics
CREATE OR REPLACE FUNCTION update_contact_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update contact statistics when an order is approved
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    UPDATE contacts
    SET 
      total_bookings = total_bookings + 1,
      total_spent_cents = total_spent_cents + (
        NEW.subtotal_cents + NEW.travel_fee_cents + NEW.surface_fee_cents + 
        NEW.same_day_pickup_fee_cents + NEW.tax_cents
      ),
      updated_at = now()
    WHERE customer_id = NEW.customer_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger to update contact stats
CREATE TRIGGER update_contact_stats_trigger
AFTER UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION update_contact_stats();

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Triggers for updated_at
CREATE TRIGGER update_contacts_updated_at
BEFORE UPDATE ON contacts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- =====================================================
-- MIGRATION: 20251003135541_20251003200000_011_add_special_details.sql
-- =====================================================

/*
  # Add Special Details to Orders

  1. Orders Table Updates
    - Add special_details text field for customer notes
    - Examples: "It's a birthday party", "Need setup by 2pm", "Call before arriving"

  2. Notes
    - Field is optional (nullable)
    - Visible to admin and crew for event planning
    - Saved with order and displayed throughout workflow
*/

-- Add special_details column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_details text;

-- Add comment for documentation
COMMENT ON COLUMN orders.special_details IS 'Customer notes about the event (birthday, special needs, setup instructions, etc.)';



-- =====================================================
-- MIGRATION: 20251003142953_20251003210000_012_add_pets_field.sql
-- =====================================================

/*
  # Add Pets Field to Orders

  1. Orders Table Updates
    - Add has_pets boolean field
    - Defaults to false
    - Helps crew prepare for arrival at residential locations

  2. Notes
    - Only relevant for residential locations
    - Used to alert crew about potential pet waste or loose pets on property
*/

-- Add has_pets column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_pets boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN orders.has_pets IS 'Whether customer has pets at residential location (for crew safety and preparation)';



-- =====================================================
-- MIGRATION: 20251003152224_20251003210000_013_add_twilio_credentials.sql
-- =====================================================

/*
  # Add Twilio Credentials to Admin Settings

  1. Changes
    - Add Twilio Account SID setting
    - Add Twilio Auth Token setting
    - Add Twilio From Number setting

  2. Security
    - Uses existing RLS policies (admin-only access)
    - Credentials stored encrypted at rest by Supabase
*/

INSERT INTO admin_settings (key, value, description)
VALUES 
  ('twilio_account_sid', '', 'Twilio Account SID for SMS notifications'),
  ('twilio_auth_token', '', 'Twilio Auth Token for SMS notifications'),
  ('twilio_from_number', '', 'Twilio phone number to send SMS from (E.164 format)')
ON CONFLICT (key) DO NOTHING;



-- =====================================================
-- MIGRATION: 20251003164124_20251003220000_014_add_admin_check_function.sql
-- =====================================================

/*
  # Add function to check for admin users

  1. New Functions
    - `get_admin_users()` - Returns count of users with ADMIN role
    - Used by setup page to determine if initial setup is needed

  2. Security
    - Function is accessible to anonymous users (needed for setup page)
    - Only returns count, not sensitive user data
*/

CREATE OR REPLACE FUNCTION get_admin_users()
RETURNS TABLE (count bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT COUNT(*)::bigint
  FROM user_roles
  WHERE role = 'ADMIN';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;



-- =====================================================
-- MIGRATION: 20251003170350_015_create_demo_admin_user.sql
-- =====================================================

/*
  # Create Demo Admin User

  This migration creates a demo admin user for testing purposes.
  
  1. Changes
    - Creates admin user with email: admin@bouncepartyclub.com
    - Password: admin123
    - Adds ADMIN role to user_roles table
  
  2. Security
    - User is created with confirmed email
    - Role is properly set in user_roles table
*/

DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'admin@bouncepartyclub.com',
    crypt('admin123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"role":"ADMIN"}'::jsonb,
    '{"role":"ADMIN"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO admin_user_id;

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    admin_user_id,
    admin_user_id::text,
    format('{"sub":"%s","email":"admin@bouncepartyclub.com"}', admin_user_id)::jsonb,
    'email',
    now(),
    now(),
    now()
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (admin_user_id, 'ADMIN')
  ON CONFLICT (user_id, role) DO NOTHING;
  
END $$;



-- =====================================================
-- MIGRATION: 20251003182356_016_add_sms_message_templates.sql
-- =====================================================

/*
  # Add SMS Message Templates

  1. New Tables
    - `sms_message_templates`
      - `id` (uuid, primary key)
      - `template_key` (text, unique) - Identifier for the template type
      - `template_name` (text) - Human-readable name
      - `message_template` (text) - The message template with variable placeholders
      - `description` (text) - Description of when this template is used
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on `sms_message_templates` table
    - Add policy for authenticated users to read templates
    - Add policy for authenticated users to update templates
  
  3. Default Templates
    - Order confirmation template
    - Order rejection template
    - Payment reminder template
    - Delivery notification template
  
  4. Available Variables
    - {customer_first_name} - Customer's first name
    - {customer_last_name} - Customer's last name
    - {customer_full_name} - Customer's full name
    - {order_id} - Order ID (short format)
    - {event_date} - Event date
    - {total_amount} - Total order amount
*/

-- Create sms_message_templates table
CREATE TABLE IF NOT EXISTS sms_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text UNIQUE NOT NULL,
  template_name text NOT NULL,
  message_template text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE sms_message_templates ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users (admins)
CREATE POLICY "Authenticated users can view all templates"
  ON sms_message_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update templates"
  ON sms_message_templates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert default templates
INSERT INTO sms_message_templates (template_key, template_name, message_template, description) VALUES
  (
    'order_confirmation',
    'Order Confirmation',
    'Hi {customer_first_name}, thank you for booking with Bounce Party Club! Your order #{order_id} for {event_date} has been received and is pending review. We''ll confirm shortly!',
    'Sent automatically when a customer places an order'
  ),
  (
    'order_approved',
    'Order Approved',
    'Great news {customer_first_name}! Your booking for {event_date} has been approved. Order #{order_id} is confirmed. Total: {total_amount}. See you soon!',
    'Sent when admin approves an order'
  ),
  (
    'order_rejected',
    'Order Rejected',
    'Hi {customer_first_name}, unfortunately we cannot accommodate your booking for {event_date}. Reason: {rejection_reason}. Please contact us if you have questions.',
    'Sent when admin rejects an order'
  ),
  (
    'payment_reminder',
    'Payment Reminder',
    'Hi {customer_first_name}, this is a friendly reminder that your balance of {balance_amount} for order #{order_id} is due before {event_date}. Thank you!',
    'Sent as a payment reminder for outstanding balance'
  ),
  (
    'delivery_notification',
    'Delivery Notification',
    'Hi {customer_first_name}, we''re on our way to deliver your order #{order_id}! We''ll arrive within your scheduled window. See you soon!',
    'Sent when crew is en route to delivery location'
  ),
  (
    'test_message',
    'Test Message',
    'Hi {customer_first_name}, this is a test message from Bounce Party Club. Your order #{order_id} is confirmed!',
    'Used for testing SMS functionality'
  )
ON CONFLICT (template_key) DO NOTHING;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_sms_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sms_template_updated_at_trigger
  BEFORE UPDATE ON sms_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_sms_template_updated_at();



-- =====================================================
-- MIGRATION: 20251003183947_017_add_admin_email_setting.sql
-- =====================================================

/*
  # Add Admin Email Setting

  1. Changes
    - Add admin_email setting to admin_settings table for error notifications
    - Default value is deveehawk@gmail.com
  
  2. Security
    - Uses existing RLS policies for admin_settings table
*/

INSERT INTO admin_settings (key, value, description)
VALUES ('admin_email', 'deveehawk@gmail.com', 'Admin email address for error notifications and alerts')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, description = EXCLUDED.description;


-- =====================================================
-- MIGRATION: 20251003200000_011_add_special_details.sql
-- =====================================================

/*
  # Add Special Details to Orders

  1. Orders Table Updates
    - Add special_details text field for customer notes
    - Examples: "It's a birthday party", "Need setup by 2pm", "Call before arriving"

  2. Notes
    - Field is optional (nullable)
    - Visible to admin and crew for event planning
    - Saved with order and displayed throughout workflow
*/

-- Add special_details column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_details text;

-- Add comment for documentation
COMMENT ON COLUMN orders.special_details IS 'Customer notes about the event (birthday, special needs, setup instructions, etc.)';



-- =====================================================
-- MIGRATION: 20251003200318_018_fix_infinite_recursion_in_admin_check.sql
-- =====================================================

/*
  # Fix Infinite Recursion in Admin Check

  1. Changes
    - Drop and recreate all policies that use is_admin()
    - Recreate is_admin() function to use SQL instead of PL/pgSQL
    - Use direct EXISTS checks in policies to avoid recursion
  
  2. Security
    - Maintains admin-only access control
    - Prevents infinite recursion in policy checks
*/

DROP POLICY IF EXISTS "Users can read own role" ON user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON user_roles;
DROP POLICY IF EXISTS "Admin users can read settings" ON admin_settings;
DROP POLICY IF EXISTS "Admin users can insert settings" ON admin_settings;
DROP POLICY IF EXISTS "Admin users can update settings" ON admin_settings;

DROP FUNCTION IF EXISTS is_admin() CASCADE;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'ADMIN'
  );
$$;

CREATE POLICY "Users can read own role"
  ON user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can insert roles"
  ON user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update roles"
  ON user_roles
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete roles"
  ON user_roles
  FOR DELETE
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admin users can read settings"
  ON admin_settings
  FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admin users can insert settings"
  ON admin_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admin users can update settings"
  ON admin_settings
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- =====================================================
-- MIGRATION: 20251004233954_20251004000000_019_add_sms_consent.sql
-- =====================================================

/*
  # Add SMS Consent Fields to Orders Table

  1. Changes
    - Add `sms_consent_text` column to store the exact consent language
    - Add `sms_consented_at` column to store timestamp of consent
  
  2. Notes
    - Required for Twilio toll-free messaging compliance
    - Stores explicit customer consent to receive SMS notifications
    - Consent text includes opt-out instructions (STOP to unsubscribe)
*/

DO $$
BEGIN
  -- Add SMS consent text field
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'sms_consent_text'
  ) THEN
    ALTER TABLE orders ADD COLUMN sms_consent_text text;
  END IF;

  -- Add SMS consent timestamp field
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'sms_consented_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN sms_consented_at timestamptz;
  END IF;
END $$;


-- =====================================================
-- MIGRATION: 20251006142419_20251006000000_020_add_travel_fee_breakdown.sql
-- =====================================================

/*
  # Add Travel Fee Breakdown Columns

  1. New Columns
    - `travel_total_miles` (numeric) - Total distance from home base to event
    - `travel_base_radius_miles` (numeric) - Free radius (e.g., 25 miles)
    - `travel_chargeable_miles` (numeric) - Miles beyond base radius that are charged
    - `travel_per_mile_cents` (integer) - Rate per mile in cents
    - `travel_is_flat_fee` (boolean) - Whether fee is flat zone override vs per-mile
  
  2. Purpose
    - Provide transparency in travel fee calculations
    - Show "our work" for travel charges
    - Help customers understand pricing
*/

DO $$
BEGIN
  -- Add total miles traveled
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_total_miles'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_total_miles numeric(8,2);
  END IF;

  -- Add base radius (free zone)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_base_radius_miles'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_base_radius_miles numeric(8,2);
  END IF;

  -- Add chargeable miles (miles beyond base)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_chargeable_miles'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_chargeable_miles numeric(8,2);
  END IF;

  -- Add per-mile rate
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_per_mile_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_per_mile_cents integer;
  END IF;

  -- Add flag for flat fee vs per-mile
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'travel_is_flat_fee'
  ) THEN
    ALTER TABLE orders ADD COLUMN travel_is_flat_fee boolean DEFAULT false;
  END IF;
END $$;


-- =====================================================
-- MIGRATION: 20251006222941_021_add_stripe_payments.sql
-- =====================================================

/*
  # Add Stripe Payment Tracking

  1. New Tables
    - `payments` - Tracks all payment transactions
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `stripe_payment_intent_id` (text, unique) - Stripe Payment Intent ID
      - `stripe_payment_method_id` (text) - Stored payment method for future charges
      - `amount_cents` (integer) - Amount charged in cents
      - `payment_type` (text) - Type: 'deposit', 'balance', 'damage', 'refund'
      - `status` (text) - Status: 'pending', 'succeeded', 'failed', 'refunded'
      - `description` (text) - Human readable description
      - `metadata` (jsonb) - Additional payment metadata
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. New Columns for Orders
    - `stripe_customer_id` (text) - Stripe Customer ID for this order
    - `stripe_payment_method_id` (text) - Default payment method on file
    - `balance_paid_cents` (integer) - Amount of balance paid
    - `damage_charged_cents` (integer) - Amount charged for damages
    - `total_refunded_cents` (integer) - Total amount refunded
    
    Note: deposit_paid_cents already exists in orders table

  3. Security
    - Enable RLS on `payments` table
    - Admins can view all payments
    - Users can only view their own order payments
*/

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  stripe_payment_intent_id text UNIQUE,
  stripe_payment_method_id text,
  amount_cents integer NOT NULL,
  payment_type text NOT NULL CHECK (payment_type IN ('deposit', 'balance', 'damage', 'refund')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Add Stripe columns to orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'stripe_customer_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN stripe_customer_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'stripe_payment_method_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN stripe_payment_method_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'balance_paid_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN balance_paid_cents integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'damage_charged_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN damage_charged_cents integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'total_refunded_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN total_refunded_cents integer DEFAULT 0;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_payment_intent ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_customer ON orders(stripe_customer_id);

-- Enable RLS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Admins can do everything with payments
CREATE POLICY "Admins can view all payments"
  ON payments FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can insert payments"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update payments"
  ON payments FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Users can view payments for their own orders (through customer_id match with contacts)
CREATE POLICY "Users can view own order payments"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      JOIN contacts ON orders.customer_id = contacts.customer_id
      WHERE orders.id = payments.order_id
      AND contacts.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Create function to update payment updated_at timestamp
CREATE OR REPLACE FUNCTION update_payment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for payments updated_at
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_updated_at();


-- =====================================================
-- MIGRATION: 20251007210840_022_add_stripe_publishable_key.sql
-- =====================================================

/*
  # Add Stripe Publishable Key Setting

  1. Changes
    - Adds `stripe_publishable_key` to admin_settings table
    - This key is needed on the frontend to initialize Stripe Elements
  
  2. Security
    - Publishable keys are safe to expose on the frontend
    - They can only create payment intents, not charge cards directly
*/

INSERT INTO admin_settings (key, value, description)
VALUES ('stripe_publishable_key', '', 'Stripe publishable key for frontend (pk_test_... or pk_live_...)')
ON CONFLICT (key) DO NOTHING;



-- =====================================================
-- MIGRATION: 20251007214737_023_update_availability_check_for_date_range.sql
-- =====================================================

/*
  # Update Availability Check Function for Date Ranges

  1. Changes
    - Drop old `check_unit_availability` function
    - Create new version that accepts start and end dates
    - Check availability across entire date range
    - Return format that includes unit name for better error messages

  2. Purpose
    - Support multi-day rentals
    - Prevent conflicts across date ranges
    - Better error messages with unit names
*/

DROP FUNCTION IF EXISTS check_unit_availability(uuid[], date);

CREATE OR REPLACE FUNCTION check_unit_availability(
  p_unit_ids uuid[],
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  unit_id uuid, 
  unit_name text,
  requested_qty integer, 
  available_qty integer, 
  available boolean
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH unit_requests AS (
    SELECT 
      unnest(p_unit_ids) AS uid,
      COUNT(*) AS requested
    FROM unnest(p_unit_ids) AS uid
    GROUP BY uid
  ),
  booked_units AS (
    SELECT 
      oi.unit_id,
      MAX(SUM(oi.qty)) AS max_booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status IN ('pending_review', 'confirmed', 'in_progress')
      AND oi.unit_id = ANY(p_unit_ids)
      AND (
        -- Check for any overlap with the requested date range
        (o.start_date <= p_end_date AND o.end_date >= p_start_date)
        OR
        (o.event_date >= p_start_date AND o.event_date <= p_end_date)
      )
    GROUP BY oi.unit_id, o.event_date
  )
  SELECT 
    ur.uid AS unit_id,
    u.name AS unit_name,
    ur.requested::integer AS requested_qty,
    COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available)::integer AS available_qty,
    ur.requested <= COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available) AS available
  FROM unit_requests ur
  JOIN units u ON u.id = ur.uid
  LEFT JOIN booked_units bu ON bu.unit_id = ur.uid;
END;
$$;

COMMENT ON FUNCTION check_unit_availability IS 'Check if requested units are available across a date range';



-- =====================================================
-- MIGRATION: 20251007215413_024_fix_availability_check_nested_aggregate.sql
-- =====================================================

/*
  # Fix Availability Check Function - Remove Nested Aggregate

  1. Changes
    - Fix "aggregate function calls cannot be nested" error
    - Use subquery to properly calculate max bookings per unit across date range
    - Correctly handle both event_date and start_date/end_date fields

  2. Purpose
    - Ensure function works without SQL errors
    - Properly check availability across date ranges
*/

DROP FUNCTION IF EXISTS check_unit_availability(uuid[], date, date);

CREATE OR REPLACE FUNCTION check_unit_availability(
  p_unit_ids uuid[],
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  unit_id uuid, 
  unit_name text,
  requested_qty integer, 
  available_qty integer, 
  available boolean
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH unit_requests AS (
    SELECT 
      unnest(p_unit_ids) AS uid,
      COUNT(*) AS requested
    FROM unnest(p_unit_ids) AS uid
    GROUP BY uid
  ),
  -- First aggregate per unit and date
  daily_bookings AS (
    SELECT 
      oi.unit_id,
      COALESCE(o.event_date, o.start_date) as booking_date,
      SUM(oi.qty) AS qty_booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status IN ('pending_review', 'confirmed', 'in_progress')
      AND oi.unit_id = ANY(p_unit_ids)
      AND (
        -- Check for any overlap with the requested date range
        (o.start_date IS NOT NULL AND o.end_date IS NOT NULL 
         AND o.start_date <= p_end_date AND o.end_date >= p_start_date)
        OR
        (o.event_date IS NOT NULL 
         AND o.event_date >= p_start_date AND o.event_date <= p_end_date)
      )
    GROUP BY oi.unit_id, booking_date
  ),
  -- Then find the maximum for each unit
  booked_units AS (
    SELECT 
      unit_id,
      MAX(qty_booked) AS max_booked
    FROM daily_bookings
    GROUP BY unit_id
  )
  SELECT 
    ur.uid AS unit_id,
    u.name AS unit_name,
    ur.requested::integer AS requested_qty,
    COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available)::integer AS available_qty,
    ur.requested <= COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available) AS available
  FROM unit_requests ur
  JOIN units u ON u.id = ur.uid
  LEFT JOIN booked_units bu ON bu.unit_id = ur.uid;
END;
$$;

COMMENT ON FUNCTION check_unit_availability IS 'Check if requested units are available across a date range';



-- =====================================================
-- MIGRATION: 20251007215603_025_fix_availability_ambiguous_columns.sql
-- =====================================================

/*
  # Fix Availability Check Function - Resolve Ambiguous Column Names

  1. Changes
    - Fix "column reference 'unit_id' is ambiguous" error
    - Use proper table aliases to avoid conflicts with return column names
    - Fully qualify all column references

  2. Purpose
    - Ensure function works without SQL errors
    - Properly check availability across date ranges
*/

DROP FUNCTION IF EXISTS check_unit_availability(uuid[], date, date);

CREATE OR REPLACE FUNCTION check_unit_availability(
  p_unit_ids uuid[],
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  unit_id uuid, 
  unit_name text,
  requested_qty integer, 
  available_qty integer, 
  available boolean
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH unit_requests AS (
    SELECT 
      unnest(p_unit_ids) AS uid,
      COUNT(*) AS requested
    FROM unnest(p_unit_ids) AS uid
    GROUP BY uid
  ),
  -- First aggregate per unit and date
  daily_bookings AS (
    SELECT 
      oi.unit_id AS db_unit_id,
      COALESCE(o.event_date, o.start_date) as booking_date,
      SUM(oi.qty) AS qty_booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status IN ('pending_review', 'confirmed', 'in_progress')
      AND oi.unit_id = ANY(p_unit_ids)
      AND (
        -- Check for any overlap with the requested date range
        (o.start_date IS NOT NULL AND o.end_date IS NOT NULL 
         AND o.start_date <= p_end_date AND o.end_date >= p_start_date)
        OR
        (o.event_date IS NOT NULL 
         AND o.event_date >= p_start_date AND o.event_date <= p_end_date)
      )
    GROUP BY oi.unit_id, booking_date
  ),
  -- Then find the maximum for each unit
  booked_units AS (
    SELECT 
      db.db_unit_id AS bu_unit_id,
      MAX(db.qty_booked) AS max_booked
    FROM daily_bookings db
    GROUP BY db.db_unit_id
  )
  SELECT 
    ur.uid,
    u.name,
    ur.requested::integer,
    COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available)::integer,
    ur.requested <= COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available)
  FROM unit_requests ur
  JOIN units u ON u.id = ur.uid
  LEFT JOIN booked_units bu ON bu.bu_unit_id = ur.uid;
END;
$$;

COMMENT ON FUNCTION check_unit_availability IS 'Check if requested units are available across a date range';



-- =====================================================
-- MIGRATION: 20251007220415_026_add_payment_pending_status.sql
-- =====================================================

/*
  # Add Payment Pending Status
  
  1. Updates
    - Add 'payment_pending' as a valid order status
    - This status indicates an order was created but payment hasn't been completed
    - These orders should be filtered out from admin views until payment succeeds
  
  2. Notes
    - Orders with 'payment_pending' status will be updated to 'pending' once payment succeeds
    - Failed or abandoned payments will remain in 'payment_pending' status
    - Admin can filter these out or clean them up periodically
*/

-- Add comment to explain the status field values
COMMENT ON COLUMN orders.status IS 'Order status: payment_pending (awaiting payment), pending (paid, awaiting processing), confirmed, in_progress, completed, cancelled';

-- Update any existing orders to ensure they have a valid status
UPDATE orders 
SET status = 'pending' 
WHERE status IS NULL OR status = '';



-- =====================================================
-- MIGRATION: 20251007221227_027_update_order_status_to_draft.sql
-- =====================================================

/*
  # Update Order Status to Draft for Unpaid Invoices
  
  1. Changes
    - Rename 'payment_pending' status to 'draft' to better represent unpaid invoices
    - These are essentially drafted invoices that need payment
    - Units are NOT reserved for draft orders - they can be booked by others
    - Draft orders can be paid via shareable link
  
  2. Status Flow
    - draft: Invoice created, awaiting payment (units not reserved)
    - pending: Payment received, awaiting admin review/confirmation
    - confirmed: Admin confirmed the booking
    - cancelled: Booking cancelled
*/

-- Update comment to reflect new status flow
COMMENT ON COLUMN orders.status IS 'Order status: draft (unpaid invoice), pending (paid, awaiting review), confirmed, in_progress, completed, cancelled';

-- Update any existing payment_pending orders to draft
UPDATE orders 
SET status = 'draft' 
WHERE status = 'payment_pending';



-- =====================================================
-- MIGRATION: 20251007221817_028_add_deposit_required_flag.sql
-- =====================================================

/*
  # Add Deposit Required Flag to Orders
  
  1. New Column
    - `deposit_required` (boolean, default true)
      - For bookings through website: always true (deposit must be paid)
      - For manual invoices: can be set to false (no deposit needed)
  
  2. Logic
    - Unpaid invoices: orders where deposit_required = true AND deposit_paid_cents = 0
    - Pending review: orders where deposit has been paid (deposit_paid_cents > 0)
    - Draft status is ONLY for unpaid invoices, NOT for orders that paid deposit
  
  3. Status Flow
    - draft: Invoice created, no payment made (only if deposit_required = true)
    - pending: Deposit paid, awaiting admin review
    - confirmed: Admin approved the booking
    - in_progress: Booking is active
    - completed: Event finished
    - cancelled: Booking cancelled
*/

-- Add deposit_required column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS deposit_required boolean DEFAULT true;

-- Update comment to reflect status flow
COMMENT ON COLUMN orders.status IS 'Order status: draft (unpaid invoice - no payment yet), pending (deposit paid, awaiting admin review), confirmed (admin approved), in_progress, completed, cancelled';

-- Ensure all existing orders have deposit_required set
UPDATE orders 
SET deposit_required = true 
WHERE deposit_required IS NULL;



-- =====================================================
-- MIGRATION: 20251008132209_029_add_stripe_payment_status_column.sql
-- =====================================================

/*
  # Add Stripe Payment Status Column

  1. Changes
    - Add `stripe_payment_status` column to `orders` table
      - Values: 'unpaid', 'pending', 'paid', 'failed', 'refunded'
      - Default: 'unpaid'
      - Used to track payment status when using Stripe Checkout
  
  2. Notes
    - This column allows the frontend to poll for payment completion
    - Updates when Stripe webhook confirms payment
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'stripe_payment_status'
  ) THEN
    ALTER TABLE orders ADD COLUMN stripe_payment_status text DEFAULT 'unpaid';
  END IF;
END $$;


-- =====================================================
-- MIGRATION: 20251008141359_030_add_anon_orders_policy.sql
-- =====================================================

/*
  # Add anonymous access to orders table for payment polling

  1. Changes
    - Add policy allowing anonymous users to SELECT from orders table
    - This is needed for the checkout page to poll order status while waiting for payment
    - Security: Only SELECT access, no INSERT/UPDATE/DELETE for anonymous users
  
  2. Security
    - Anonymous users can only read orders, not modify them
    - This allows the payment polling to work without authentication
*/

CREATE POLICY "Anonymous users can read orders"
  ON orders
  FOR SELECT
  TO anon
  USING (true);


-- =====================================================
-- MIGRATION: 20251008144308_031_add_admin_notification_template.sql
-- =====================================================

/*
  # Add Admin Notification Template and Phone Setting

  1. New Template
    - Add `booking_received_admin` template for notifying admin of new bookings
  
  2. Admin Settings
    - Add `admin_phone` setting for receiving SMS notifications
  
  3. Notes
    - Admin will receive SMS when a customer completes payment
    - Template uses order details to inform admin
*/

-- Add admin notification template
INSERT INTO sms_message_templates (template_key, template_name, message_template, description)
VALUES (
  'booking_received_admin',
  'Admin - New Booking Notification',
  'New booking received! Order #{order_id} from {customer_name} for {event_date} at {event_address}. Check admin panel to review.',
  'Notifies admin when a new booking is received and paid'
)
ON CONFLICT (template_key) DO UPDATE 
SET message_template = EXCLUDED.message_template,
    template_name = EXCLUDED.template_name,
    description = EXCLUDED.description;

-- Add admin phone setting (you'll need to update this with actual phone number)
INSERT INTO admin_settings (key, value, description)
VALUES (
  'admin_phone',
  '+13138893860',
  'Phone number for admin SMS notifications'
)
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value,
    description = EXCLUDED.description;


-- =====================================================
-- MIGRATION: 20251008153245_032_fix_contacts_bookings_counter.sql
-- =====================================================

/*
  # Fix contacts bookings counter
  
  1. Changes
    - Create trigger to automatically update contacts.total_bookings when orders are created
    - Create trigger to update contacts.total_spent_cents when orders are paid
    - Backfill existing data to fix current contacts
  
  2. Security
    - Triggers run with appropriate permissions
*/

-- Function to update contact bookings count
CREATE OR REPLACE FUNCTION update_contact_booking_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the contact's total bookings and total spent
  UPDATE contacts
  SET 
    total_bookings = (
      SELECT COUNT(*)
      FROM orders
      WHERE customer_id = NEW.customer_id
        AND status NOT IN ('cancelled', 'draft')
    ),
    total_spent_cents = (
      SELECT COALESCE(SUM(subtotal_cents + travel_fee_cents + surface_fee_cents + same_day_pickup_fee_cents + tax_cents), 0)
      FROM orders
      WHERE customer_id = NEW.customer_id
        AND status IN ('confirmed', 'completed')
    ),
    last_contact_date = NOW()
  WHERE customer_id = NEW.customer_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new orders
DROP TRIGGER IF EXISTS trigger_update_contact_stats ON orders;
CREATE TRIGGER trigger_update_contact_stats
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_booking_stats();

-- Backfill existing contacts
UPDATE contacts c
SET 
  total_bookings = (
    SELECT COUNT(*)
    FROM orders o
    WHERE o.customer_id = c.customer_id
      AND o.status NOT IN ('cancelled', 'draft')
  ),
  total_spent_cents = (
    SELECT COALESCE(SUM(o.subtotal_cents + o.travel_fee_cents + o.surface_fee_cents + o.same_day_pickup_fee_cents + o.tax_cents), 0)
    FROM orders o
    WHERE o.customer_id = c.customer_id
      AND o.status IN ('confirmed', 'completed')
  );



-- =====================================================
-- MIGRATION: 20251008153325_033_add_order_workflow_and_features.sql
-- =====================================================

/*
  # Add order workflow and extended features
  
  1. New Tables
    - `order_notes` - Notes added by admins to orders
    - `order_workflow_events` - Track workflow progression (on the way, arrived, finished setup)
    - `order_refunds` - Track all refunds with reasons
    - `admin_settings_changelog` - Track changes to admin settings
    - `order_documents` - Enhanced document tracking with metadata
  
  2. Changes to existing tables
    - Add workflow status fields to orders
    - Add search indexing
  
  3. Security
    - Enable RLS on all new tables
    - Add policies for admin-only access
*/

-- Order notes table
CREATE TABLE IF NOT EXISTS order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  note text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage order notes"
  ON order_notes FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Order workflow events table
CREATE TABLE IF NOT EXISTS order_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('on_the_way', 'arrived', 'setup_started', 'setup_completed', 'pickup_started', 'pickup_completed')),
  user_id uuid REFERENCES auth.users(id),
  eta timestamptz,
  notes text,
  latitude numeric,
  longitude numeric,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_workflow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and crew can manage workflow events"
  ON order_workflow_events FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'CREW')
    )
  );

-- Order refunds table
CREATE TABLE IF NOT EXISTS order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  reason text NOT NULL,
  stripe_refund_id text,
  refunded_by uuid REFERENCES auth.users(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage refunds"
  ON order_refunds FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Admin settings changelog
CREATE TABLE IF NOT EXISTS admin_settings_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES auth.users(id),
  change_description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_settings_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view changelog"
  ON admin_settings_changelog FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admins can insert changelog"
  ON admin_settings_changelog FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Add workflow status to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS workflow_status text DEFAULT 'pending' 
  CHECK (workflow_status IN ('pending', 'on_the_way', 'arrived', 'setup_in_progress', 'setup_completed', 'pickup_scheduled', 'pickup_in_progress', 'completed'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS current_eta timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS waiver_signed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS waiver_signature_data text;

-- Create indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_orders_event_date ON orders(event_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_workflow_status ON orders(workflow_status);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_order_notes_order_id ON order_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_order_workflow_events_order_id ON order_workflow_events(order_id);

-- Function to log admin settings changes
CREATE OR REPLACE FUNCTION log_admin_settings_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO admin_settings_changelog (
    setting_key,
    old_value,
    new_value,
    changed_by,
    change_description
  ) VALUES (
    NEW.key,
    OLD.value,
    NEW.value,
    auth.uid(),
    NEW.description
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for admin settings changes
DROP TRIGGER IF EXISTS trigger_log_admin_settings_change ON admin_settings;
CREATE TRIGGER trigger_log_admin_settings_change
  AFTER UPDATE ON admin_settings
  FOR EACH ROW
  WHEN (OLD.value IS DISTINCT FROM NEW.value)
  EXECUTE FUNCTION log_admin_settings_change();



-- =====================================================
-- MIGRATION: 20251008155607_034_add_order_changelog.sql
-- =====================================================

/*
  # Add Order-Specific Changelog

  1. New Tables
    - `order_changelog`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `user_id` (uuid, foreign key to auth.users)
      - `field_changed` (text) - what field was changed
      - `old_value` (text) - previous value
      - `new_value` (text) - new value
      - `change_type` (text) - 'edit', 'add', 'remove', 'status_change'
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `order_changelog` table
    - Add policy for authenticated users to read changelog
    - Add policy for authenticated users to create changelog entries

  3. Important Notes
    - This table tracks all changes made to orders
    - Provides audit trail for order modifications
    - Includes user tracking for accountability
*/

CREATE TABLE IF NOT EXISTS order_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  change_type text NOT NULL DEFAULT 'edit',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view order changelog"
  ON order_changelog
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create changelog entries"
  ON order_changelog
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_order_changelog_order_id ON order_changelog(order_id);
CREATE INDEX IF NOT EXISTS idx_order_changelog_created_at ON order_changelog(created_at DESC);



-- =====================================================
-- MIGRATION: 20251008155627_034_add_order_changelog.sql
-- =====================================================

/*
  # Add Order-Specific Changelog

  1. New Tables
    - `order_changelog`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `user_id` (uuid, foreign key to auth.users)
      - `field_changed` (text) - what field was changed
      - `old_value` (text) - previous value
      - `new_value` (text) - new value
      - `change_type` (text) - 'edit', 'add', 'remove', 'status_change'
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `order_changelog` table
    - Add policy for authenticated users to read changelog
    - Add policy for authenticated users to create changelog entries

  3. Important Notes
    - This table tracks all changes made to orders
    - Provides audit trail for order modifications
    - Includes user tracking for accountability
*/

CREATE TABLE IF NOT EXISTS order_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  change_type text NOT NULL DEFAULT 'edit',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view order changelog"
  ON order_changelog
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create changelog entries"
  ON order_changelog
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_order_changelog_order_id ON order_changelog(order_id);
CREATE INDEX IF NOT EXISTS idx_order_changelog_created_at ON order_changelog(created_at DESC);



-- =====================================================
-- MIGRATION: 20251008170619_035_add_void_status.sql
-- =====================================================

/*
  # Add void status to orders
  
  1. Changes
    - Update order status check constraint to include 'void' status
    - Void status is for orders that are no longer valid (e.g., availability conflicts)
  
  2. Notes
    - Void orders won't count against inventory
    - Can be used when payment link expires or availability check fails
*/

-- Drop existing constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add new constraint with void status
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('draft', 'pending_review', 'confirmed', 'in_progress', 'completed', 'cancelled', 'void'));



-- =====================================================
-- MIGRATION: 20251008180000_036_add_order_discounts.sql
-- =====================================================

/*
  # Add Order Discounts Table

  1. New Tables
    - `order_discounts`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `name` (text) - Description of the discount (e.g., "Military Discount", "Promo Code SAVE20")
      - `amount_cents` (integer) - Fixed dollar amount discount (mutually exclusive with percentage)
      - `percentage` (decimal) - Percentage discount (mutually exclusive with amount_cents)
      - `created_at` (timestamptz)
      - `created_by` (uuid, foreign key to auth.users)

  2. Security
    - Enable RLS on `order_discounts` table
    - Add policies for authenticated admin users to manage discounts

  3. Notes
    - Either amount_cents OR percentage should be set, not both
    - Multiple discounts can be applied to a single order
*/

CREATE TABLE IF NOT EXISTS order_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount_cents integer DEFAULT 0,
  percentage decimal DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE order_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view order discounts"
  ON order_discounts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert order discounts"
  ON order_discounts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update order discounts"
  ON order_discounts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete order discounts"
  ON order_discounts FOR DELETE
  TO authenticated
  USING (true);

-- Remove old discount columns from orders if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'discount_amount_cents'
  ) THEN
    ALTER TABLE orders DROP COLUMN discount_amount_cents;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'discount_percentage'
  ) THEN
    ALTER TABLE orders DROP COLUMN discount_percentage;
  END IF;
END $$;



-- =====================================================
-- MIGRATION: 20251008180045_036_add_order_discounts.sql
-- =====================================================

/*
  # Add Order Discounts Table

  1. New Tables
    - `order_discounts`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `name` (text) - Description of the discount (e.g., "Military Discount", "Promo Code SAVE20")
      - `amount_cents` (integer) - Fixed dollar amount discount (mutually exclusive with percentage)
      - `percentage` (decimal) - Percentage discount (mutually exclusive with amount_cents)
      - `created_at` (timestamptz)
      - `created_by` (uuid, foreign key to auth.users)

  2. Security
    - Enable RLS on `order_discounts` table
    - Add policies for authenticated admin users to manage discounts

  3. Notes
    - Either amount_cents OR percentage should be set, not both
    - Multiple discounts can be applied to a single order
*/

CREATE TABLE IF NOT EXISTS order_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount_cents integer DEFAULT 0,
  percentage decimal DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE order_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view order discounts"
  ON order_discounts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert order discounts"
  ON order_discounts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update order discounts"
  ON order_discounts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete order discounts"
  ON order_discounts FOR DELETE
  TO authenticated
  USING (true);

-- Remove old discount columns from orders if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'discount_amount_cents'
  ) THEN
    ALTER TABLE orders DROP COLUMN discount_amount_cents;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'discount_percentage'
  ) THEN
    ALTER TABLE orders DROP COLUMN discount_percentage;
  END IF;
END $$;


-- =====================================================
-- MIGRATION: 20251008190000_037_setup_unit_images_storage.sql
-- =====================================================

/*
  # Setup Unit Images Storage

  1. Storage
    - Create 'unit-images' storage bucket for public unit photos
    - Set up RLS policies for public read access
    - Allow authenticated users to upload images

  2. Security
    - Public read access for browsing catalog
    - Authenticated write access for admin uploads
*/

-- Create storage bucket for unit images
INSERT INTO storage.buckets (id, name, public)
VALUES ('unit-images', 'unit-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public to view unit images
CREATE POLICY "Public can view unit images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'unit-images');

-- Allow authenticated users to upload unit images
CREATE POLICY "Authenticated users can upload unit images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'unit-images');

-- Allow authenticated users to update unit images
CREATE POLICY "Authenticated users can update unit images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'unit-images')
  WITH CHECK (bucket_id = 'unit-images');

-- Allow authenticated users to delete unit images
CREATE POLICY "Authenticated users can delete unit images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'unit-images');



-- =====================================================
-- MIGRATION: 20251008201708_037_setup_unit_images_storage.sql
-- =====================================================

/*
  # Setup Unit Images Storage

  1. Storage
    - Create 'unit-images' storage bucket for public unit photos
    - Set up RLS policies for public read access
    - Allow authenticated users to upload images

  2. Security
    - Public read access for browsing catalog
    - Authenticated write access for admin uploads
*/

-- Create storage bucket for unit images
INSERT INTO storage.buckets (id, name, public)
VALUES ('unit-images', 'unit-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public to view unit images
CREATE POLICY "Public can view unit images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'unit-images');

-- Allow authenticated users to upload unit images
CREATE POLICY "Authenticated users can upload unit images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'unit-images');

-- Allow authenticated users to update unit images
CREATE POLICY "Authenticated users can update unit images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'unit-images')
  WITH CHECK (bucket_id = 'unit-images');

-- Allow authenticated users to delete unit images
CREATE POLICY "Authenticated users can delete unit images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'unit-images');


-- =====================================================
-- MIGRATION: 20251008202716_038_add_wet_mode_images_and_dimensions.sql
-- =====================================================

/*
  # Add Wet Mode Support for Units

  1. Changes to Tables
    - Add `mode` column to `unit_media` table to distinguish dry/wet images
    - Add `dimensions_water` column to `units` table for separate wet dimensions

  2. Notes
    - Mode can be 'dry' or 'water'
    - Water dimensions are optional (null means same as dry dimensions)
    - Existing images will default to 'dry' mode
*/

-- Add mode column to unit_media
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'unit_media' AND column_name = 'mode'
  ) THEN
    ALTER TABLE unit_media ADD COLUMN mode text DEFAULT 'dry' CHECK (mode IN ('dry', 'water'));
  END IF;
END $$;

-- Add dimensions_water column to units
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'units' AND column_name = 'dimensions_water'
  ) THEN
    ALTER TABLE units ADD COLUMN dimensions_water text;
  END IF;
END $$;


-- =====================================================
-- MIGRATION: 20251008210000_038_add_wet_mode_images_and_dimensions.sql
-- =====================================================

/*
  # Add Wet Mode Support for Units

  1. Changes to Tables
    - Add `mode` column to `unit_media` table to distinguish dry/wet images
    - Add `dimensions_water` column to `units` table for separate wet dimensions

  2. Notes
    - Mode can be 'dry' or 'water'
    - Water dimensions are optional (null means same as dry dimensions)
    - Existing images will default to 'dry' mode
*/

-- Add mode column to unit_media
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'unit_media' AND column_name = 'mode'
  ) THEN
    ALTER TABLE unit_media ADD COLUMN mode text DEFAULT 'dry' CHECK (mode IN ('dry', 'water'));
  END IF;
END $$;

-- Add dimensions_water column to units
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'units' AND column_name = 'dimensions_water'
  ) THEN
    ALTER TABLE units ADD COLUMN dimensions_water text;
  END IF;
END $$;


