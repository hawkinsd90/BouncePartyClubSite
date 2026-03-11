/*
  # Create Transaction Receipts System

  1. New Tables
    - `transaction_receipts`
      - `id` (uuid, primary key)
      - `transaction_type` (text) - 'deposit', 'balance', 'refund', 'tip'
      - `order_id` (uuid) - references orders
      - `customer_id` (uuid) - references customers
      - `payment_id` (uuid) - references payments
      - `amount_cents` (integer) - transaction amount
      - `payment_method` (text) - card type, cash, etc
      - `stripe_charge_id` (text) - stripe transaction ID
      - `receipt_number` (text, unique) - unique receipt number
      - `receipt_sent_to_admin` (boolean) - flag if admin was notified
      - `transaction_date` (timestamptz) - when transaction occurred
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `transaction_receipts` table
    - Admin users can view all transaction receipts
    - Customers can view their own transaction receipts

  3. Function
    - `generate_receipt_number()` - generates unique receipt numbers
*/

-- Create receipt number sequence
CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START WITH 10001;

-- Function to generate receipt numbers
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
  receipt_num text;
BEGIN
  next_num := nextval('receipt_number_seq');
  receipt_num := 'RCP-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(next_num::text, 5, '0');
  RETURN receipt_num;
END;
$$;

-- Create transaction_receipts table
CREATE TABLE IF NOT EXISTS transaction_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type text NOT NULL CHECK (transaction_type IN ('deposit', 'balance', 'refund', 'tip', 'full_payment')),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL,
  payment_method text,
  payment_method_brand text,
  stripe_charge_id text,
  stripe_payment_intent_id text,
  receipt_number text UNIQUE NOT NULL DEFAULT generate_receipt_number(),
  receipt_sent_to_admin boolean DEFAULT false,
  admin_notified_at timestamptz,
  transaction_date timestamptz DEFAULT now(),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_order_id ON transaction_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_customer_id ON transaction_receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_payment_id ON transaction_receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_transaction_date ON transaction_receipts(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_receipts_receipt_number ON transaction_receipts(receipt_number);

-- Enable RLS
ALTER TABLE transaction_receipts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admin users can view all transaction receipts"
  ON transaction_receipts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN')
    )
  );

CREATE POLICY "Customers can view their own transaction receipts"
  ON transaction_receipts
  FOR SELECT
  TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admin users can insert transaction receipts"
  ON transaction_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN')
    )
  );

CREATE POLICY "System can insert transaction receipts"
  ON transaction_receipts
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Update trigger
CREATE OR REPLACE FUNCTION update_transaction_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_transaction_receipts_timestamp
  BEFORE UPDATE ON transaction_receipts
  FOR EACH ROW
  EXECUTE FUNCTION update_transaction_receipts_updated_at();
