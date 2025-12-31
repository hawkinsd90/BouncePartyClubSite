/*
  # Add Payment Method Validation Fields

  1. Changes to `orders` table
    - Add `payment_method_validated_at` (timestamptz) - Last validation timestamp
    - Add `payment_method_last_four` (text) - Last 4 digits for quick reference
    - Add `payment_method_exp_month` (integer) - Card expiration month
    - Add `payment_method_exp_year` (integer) - Card expiration year

  2. New Functions
    - `check_expiring_cards()` - Returns orders with expiring cards (within 30 days)

  3. Purpose
    - Track payment method validity
    - Enable proactive notification of expiring cards
    - Improve payment success rates by catching expired cards early
*/

-- Add payment method validation fields to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS payment_method_validated_at timestamptz,
ADD COLUMN IF NOT EXISTS payment_method_last_four text,
ADD COLUMN IF NOT EXISTS payment_method_exp_month integer,
ADD COLUMN IF NOT EXISTS payment_method_exp_year integer;

-- Function to check for expiring cards (within 30 days)
CREATE OR REPLACE FUNCTION check_expiring_cards()
RETURNS TABLE (
  order_id uuid,
  customer_email text,
  customer_name text,
  exp_date text,
  days_until_expiry integer
) AS $$
  SELECT 
    o.id as order_id,
    c.email as customer_email,
    (c.first_name || ' ' || c.last_name) as customer_name,
    o.payment_method_exp_month || '/' || o.payment_method_exp_year as exp_date,
    (make_date(o.payment_method_exp_year, o.payment_method_exp_month, 1) - CURRENT_DATE)::integer as days_until_expiry
  FROM orders o
  JOIN customers c ON o.customer_id = c.id
  WHERE 
    o.stripe_payment_method_id IS NOT NULL
    AND o.payment_method_exp_year IS NOT NULL
    AND o.payment_method_exp_month IS NOT NULL
    AND make_date(
      o.payment_method_exp_year, 
      o.payment_method_exp_month, 
      1
    ) BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
    AND o.status NOT IN ('completed', 'cancelled', 'void')
  ORDER BY days_until_expiry ASC;
$$ LANGUAGE sql SECURITY DEFINER
SET search_path = public;
