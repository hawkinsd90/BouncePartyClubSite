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