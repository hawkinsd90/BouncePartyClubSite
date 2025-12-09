/*
  # Fix get_user_order_prefill Function

  1. Problem
    - The function was trying to select `customer_first_name`, `customer_last_name`, etc. from orders table
    - These columns don't exist - they're in the customers and addresses tables
  
  2. Solution
    - Properly join orders with customers and addresses tables
    - Return the correct column names from the joined tables
  
  3. Changes
    - Update function to join with customers table for name/email/phone
    - Join with addresses table for address information
    - Return data from the most recent completed order
*/

-- Drop and recreate the function with proper joins
DROP FUNCTION IF EXISTS public.get_user_order_prefill();

CREATE FUNCTION public.get_user_order_prefill()
RETURNS TABLE (
  first_name text,
  last_name text,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  lat numeric,
  lng numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    a.line1 as address_line1,
    a.line2 as address_line2,
    a.city,
    a.state,
    a.zip,
    a.lat,
    a.lng
  FROM public.orders o
  LEFT JOIN public.customers c ON o.customer_id = c.id
  LEFT JOIN public.addresses a ON o.address_id = a.id
  WHERE o.customer_id = auth.uid()
    AND o.status NOT IN ('draft', 'void')
    AND c.email IS NOT NULL
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_order_prefill() TO authenticated;
