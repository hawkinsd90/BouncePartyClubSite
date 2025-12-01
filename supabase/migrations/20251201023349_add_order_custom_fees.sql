/*
  # Add Custom Fees for Orders

  1. New Tables
    - `order_custom_fees`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `name` (text) - Fee name/description
      - `amount_cents` (integer) - Fee amount in cents
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `order_custom_fees` table
    - Add policies for authenticated admin users to manage fees
*/

-- Create order_custom_fees table
CREATE TABLE IF NOT EXISTS order_custom_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE order_custom_fees ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users to manage custom fees
CREATE POLICY "Authenticated users can view custom fees"
  ON order_custom_fees
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert custom fees"
  ON order_custom_fees
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete custom fees"
  ON order_custom_fees
  FOR DELETE
  TO authenticated
  USING (true);

-- Add admin_message column to orders table for messages sent with edits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'admin_message'
  ) THEN
    ALTER TABLE orders ADD COLUMN admin_message text;
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_order_custom_fees_order_id ON order_custom_fees(order_id);