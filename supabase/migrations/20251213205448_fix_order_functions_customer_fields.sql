/*
  # Fix Order Functions - Remove Customer Email References

  1. Problem
    - Multiple functions reference customer_email, customer_first_name, etc. on orders table
    - These columns don't exist - orders only has customer_id (foreign key to customers table)
    - This causes INSERT operations to fail with "record has no field" errors

  2. Solution
    - Fix get_user_order_prefill to join with customers table
    - Fix update_contact_booking_stats to join with customers table
    - Both functions now properly use customer_id to get contact information
*/

-- Drop and recreate get_user_order_prefill
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
    a.address_line1,
    a.city,
    a.state,
    a.zip
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.addresses a ON a.id = o.address_id
  WHERE o.customer_id = auth.uid()
    AND o.status NOT IN ('draft', 'void')
    AND c.email IS NOT NULL
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

-- Fix update_contact_booking_stats to join with customers table
CREATE OR REPLACE FUNCTION public.update_contact_booking_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  target_email text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT email INTO target_email
    FROM public.customers
    WHERE id = OLD.customer_id;
  ELSE
    SELECT email INTO target_email
    FROM public.customers
    WHERE id = NEW.customer_id;
  END IF;

  IF target_email IS NOT NULL THEN
    UPDATE public.contacts
    SET
      total_bookings = (
        SELECT COUNT(*)
        FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE c.email = target_email
          AND o.status NOT IN ('draft', 'void')
      ),
      total_spent_cents = (
        SELECT COALESCE(SUM(
          o.subtotal_cents + 
          o.travel_fee_cents + 
          o.surface_fee_cents + 
          COALESCE(o.same_day_pickup_fee_cents, 0) + 
          COALESCE(o.generator_fee_cents, 0) + 
          o.tax_cents
        ), 0)
        FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE c.email = target_email
          AND o.status NOT IN ('draft', 'void')
      ),
      last_booking_date = (
        SELECT MAX(o.event_date)
        FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE c.email = target_email
          AND o.status NOT IN ('draft', 'void')
      ),
      updated_at = now()
    WHERE email = target_email;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;