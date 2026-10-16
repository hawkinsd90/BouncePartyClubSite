/*
  # Add Billing Addresses Table

  ## Purpose
  Stores the billing address a customer enters at checkout or on the waiver/sign
  screen when it differs from their event/delivery address. This data is stored
  for legal/identity-tracing purposes only and is not currently displayed anywhere
  in the UI.

  ## New Tables
  - `billing_addresses`
    - `id` (uuid, primary key)
    - `order_id` (uuid, FK to orders) — one billing address per order
    - `customer_id` (uuid, FK to customers, nullable) — populated when known
    - `line1` (text) — street address
    - `line2` (text, nullable) — apt/suite
    - `city` (text)
    - `state` (text)
    - `zip` (text)
    - `source` (text) — where this was captured: 'checkout' or 'waiver'
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - Admins (master/admin/manager roles) can read all billing addresses
  - Anonymous and authenticated users can insert (needed for checkout and waiver flows)
  - No one can update or delete (immutable legal record)

  ## Notes
  - No lat/lng — billing addresses are never geocoded
  - Unique constraint on order_id + source so duplicate submissions are safe
*/

CREATE TABLE IF NOT EXISTS billing_addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  line1       text NOT NULL DEFAULT '',
  line2       text,
  city        text NOT NULL DEFAULT '',
  state       text NOT NULL DEFAULT '',
  zip         text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT 'checkout',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate entries for the same order + source
CREATE UNIQUE INDEX IF NOT EXISTS billing_addresses_order_source_uidx
  ON billing_addresses (order_id, source);

-- Index for admin lookups by order
CREATE INDEX IF NOT EXISTS billing_addresses_order_id_idx
  ON billing_addresses (order_id);

-- Index for lookups by customer
CREATE INDEX IF NOT EXISTS billing_addresses_customer_id_idx
  ON billing_addresses (customer_id);

ALTER TABLE billing_addresses ENABLE ROW LEVEL SECURITY;

-- Admins can read all billing addresses
CREATE POLICY "Admins can read billing addresses"
  ON billing_addresses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('master', 'admin', 'manager')
    )
  );

-- Anon can insert (checkout flow runs before auth)
CREATE POLICY "Anyone can insert billing address"
  ON billing_addresses
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Authenticated can also insert (logged-in checkout)
CREATE POLICY "Authenticated can insert billing address"
  ON billing_addresses
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
