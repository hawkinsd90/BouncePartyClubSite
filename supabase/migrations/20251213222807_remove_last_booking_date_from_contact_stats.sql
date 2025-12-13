/*
  # Remove last_booking_date from contact stats function

  1. Problem
    - update_contact_booking_stats tries to set last_booking_date column
    - This column doesn't exist in contacts table
    
  2. Solution
    - Remove last_booking_date from the UPDATE statement
*/

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