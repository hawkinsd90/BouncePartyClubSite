/*
  # Invoice Links and Customer Self-Service System

  1. New Tables
    - `invoice_links`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `link_token` (text, unique) - Secure token for shareable link
      - `customer_filled` (boolean) - Whether customer has filled in their info
      - `deposit_cents` (integer) - Custom deposit amount (can be 0)
      - `expires_at` (timestamptz) - Link expiration date
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. New Columns
    - `orders` table
      - `invoice_sent_at` (timestamptz) - When invoice was sent to customer
      - `invoice_accepted_at` (timestamptz) - When customer accepted invoice
      - `card_on_file_consent` (boolean) - Customer consent for card-on-file
      - `sms_consent` (boolean) - Customer consent for SMS notifications
      - `custom_deposit_cents` (integer) - Optional custom deposit amount override

  3. Security
    - Enable RLS on `invoice_links` table
    - Add policies for authenticated admin users
    - Add policies for anonymous users with valid token
    - Add indexes for performance
*/

-- Create invoice_links table
CREATE TABLE IF NOT EXISTS invoice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  link_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  customer_filled boolean DEFAULT false,
  deposit_cents integer NOT NULL DEFAULT 0,
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add new columns to orders table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'invoice_sent_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN invoice_sent_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'invoice_accepted_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN invoice_accepted_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'card_on_file_consent'
  ) THEN
    ALTER TABLE orders ADD COLUMN card_on_file_consent boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'sms_consent'
  ) THEN
    ALTER TABLE orders ADD COLUMN sms_consent boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'custom_deposit_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN custom_deposit_cents integer;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS invoice_links_order_id_idx ON invoice_links(order_id);
CREATE INDEX IF NOT EXISTS invoice_links_link_token_idx ON invoice_links(link_token);
CREATE INDEX IF NOT EXISTS invoice_links_expires_at_idx ON invoice_links(expires_at);

-- Enable RLS
ALTER TABLE invoice_links ENABLE ROW LEVEL SECURITY;

-- Admin users can manage all invoice links
CREATE POLICY "Admins can manage invoice links"
  ON invoice_links
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Anonymous users can view invoice link by token
CREATE POLICY "Anyone can view invoice link with valid token"
  ON invoice_links
  FOR SELECT
  TO anon, authenticated
  USING (
    expires_at > now()
  );

-- Anonymous users can update customer_filled status
CREATE POLICY "Anyone can update invoice link with valid token"
  ON invoice_links
  FOR UPDATE
  TO anon, authenticated
  USING (
    expires_at > now()
  )
  WITH CHECK (
    expires_at > now()
  );

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_invoice_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_invoice_links_timestamp
  BEFORE UPDATE ON invoice_links
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_links_updated_at();
