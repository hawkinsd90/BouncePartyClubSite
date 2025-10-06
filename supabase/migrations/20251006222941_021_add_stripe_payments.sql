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