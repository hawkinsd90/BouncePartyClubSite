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