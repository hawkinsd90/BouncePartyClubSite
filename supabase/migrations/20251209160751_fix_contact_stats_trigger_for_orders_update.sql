/*
  # Fix Contact Stats Trigger for Orders Updates

  1. Problem
    - The update_contact_stats() function references NEW.customer_email
    - But orders table only has customer_id, not customer_email
    - This causes UPDATE queries on orders to fail

  2. Solution
    - Fix the function to use customer_id and join to customers table for email
    - Handle both INSERT and UPDATE operations correctly
*/

CREATE OR REPLACE FUNCTION public.update_contact_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_customer_email TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    -- Get the customer email from the customers table
    SELECT email INTO v_customer_email
    FROM public.customers
    WHERE id = NEW.customer_id;
    
    IF v_customer_email IS NOT NULL THEN
      UPDATE public.contacts
      SET
        total_bookings = (
          SELECT COUNT(*) 
          FROM public.orders o
          JOIN public.customers c ON c.id = o.customer_id
          WHERE c.email = v_customer_email
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
          WHERE c.email = v_customer_email
          AND o.status IN ('confirmed', 'approved', 'completed')
        ),
        updated_at = now()
      WHERE email = v_customer_email;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;