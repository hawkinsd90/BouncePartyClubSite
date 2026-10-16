/*
  # Fix get_user_order_prefill to use current schema

  ## Summary
  The existing function used an obsolete customer_profiles/contacts schema that no longer exists.
  Drops and recreates it to use the current customers table with user_id field.

  ## Changes
  - Drop old function with obsolete return type
  - Recreate using customers.user_id to find the customer
  - Priority 1: use customers.default_address_id if set
  - Priority 2: fall back to most recent non-draft/void order address
  - Returns first_name, last_name, email, phone, full address fields, lat, lng
*/

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
  lat decimal,
  lng decimal
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_default_address_id uuid;
BEGIN
  SELECT c.id, c.default_address_id
  INTO v_customer_id, v_default_address_id
  FROM public.customers c
  WHERE c.user_id = auth.uid()
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF v_default_address_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      c.first_name,
      c.last_name,
      c.email,
      c.phone,
      a.line1,
      a.line2,
      a.city,
      a.state,
      a.zip,
      a.lat,
      a.lng
    FROM public.customers c
    JOIN public.addresses a ON a.id = v_default_address_id
    WHERE c.id = v_customer_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    a.line1,
    a.line2,
    a.city,
    a.state,
    a.zip,
    a.lat,
    a.lng
  FROM public.customers c
  LEFT JOIN public.orders o ON o.customer_id = c.id
    AND o.status NOT IN ('draft', 'void')
  LEFT JOIN public.addresses a ON a.id = o.address_id
  WHERE c.id = v_customer_id
  ORDER BY o.created_at DESC NULLS LAST
  LIMIT 1;
END;
$$;
