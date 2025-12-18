/*
  # Fix get_user_order_prefill Function - Correct Table Joins

  1. Problem
    - Function tries to match orders.customer_id with auth.uid()
    - These are unrelated UUIDs - customer_id references customers table
    - auth.uid() references auth.users table
    - Causes 400 errors when calling the function

  2. Database Structure
    - auth.users.id → customer_profiles.user_id
    - customer_profiles.contact_id → contacts.id
    - contacts.customer_id → customers.id
    - orders.customer_id → customers.id

  3. Solution
    - Fix function to properly join through customer_profiles and contacts
    - Return prefill data from the user's most recent non-draft order
*/

-- Drop existing function
DROP FUNCTION IF EXISTS public.get_user_order_prefill();

-- Recreate with correct joins
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
DECLARE
  user_customer_id uuid;
BEGIN
  -- First, find the customer_id for this authenticated user
  -- by joining through customer_profiles and contacts
  SELECT c.customer_id INTO user_customer_id
  FROM public.customer_profiles cp
  JOIN public.contacts c ON c.id = cp.contact_id
  WHERE cp.user_id = auth.uid()
  LIMIT 1;

  -- If no customer found, return empty result
  IF user_customer_id IS NULL THEN
    RETURN;
  END IF;

  -- Now get the prefill data from the most recent order
  RETURN QUERY
  SELECT
    cust.first_name,
    cust.last_name,
    cust.email,
    cust.phone,
    a.address_line1,
    a.city,
    a.state,
    a.zip
  FROM public.orders o
  JOIN public.customers cust ON cust.id = o.customer_id
  LEFT JOIN public.addresses a ON a.id = o.address_id
  WHERE o.customer_id = user_customer_id
    AND o.status NOT IN ('draft', 'void')
    AND cust.email IS NOT NULL
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_user_order_prefill() TO authenticated;

COMMENT ON FUNCTION public.get_user_order_prefill() IS 'Returns prefill data from the authenticated user''s most recent order by joining through customer_profiles → contacts → customers → orders';
