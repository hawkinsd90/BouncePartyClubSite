/*
  # Fix get_user_order_prefill Function

  1. Changes
    - Fix function to join customers and addresses tables correctly
    - Select from customers.first_name instead of orders.customer_first_name
    - Select from addresses.line1 instead of orders.address_line1
    - Properly join orders -> customers -> addresses

  2. Details
    - The orders table only has customer_id and address_id foreign keys
    - Customer details are in the customers table
    - Address details are in the addresses table
*/

DROP FUNCTION IF EXISTS public.get_user_order_prefill();

CREATE FUNCTION public.get_user_order_prefill()
RETURNS TABLE (
  first_name text,
  last_name text,
  email text,
  phone text,
  address_line1 text,
  city text,
  state text,
  zip text
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
    a.city,
    a.state,
    a.zip
  FROM public.orders o
  INNER JOIN public.customers c ON o.customer_id = c.id
  LEFT JOIN public.addresses a ON o.address_id = a.id
  WHERE o.customer_id = auth.uid()
    AND o.status NOT IN ('draft', 'void')
    AND c.email IS NOT NULL
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_order_prefill() TO authenticated;