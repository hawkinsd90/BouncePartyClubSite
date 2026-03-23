/*
  # Fix total_spent_cents to Include Custom Fees and Subtract Discounts

  ## Summary
  The update_contact_booking_stats() trigger was computing total_spent_cents
  using only the flat fee columns on the orders row. It missed:
    - order_custom_fees (stored in a separate child table)
    - order_discounts (stored in a separate child table)
  
  This caused understated lifetime spend for customers with custom fees and
  overstated spend for customers with discounts.

  ## Changes
  - Replaces update_contact_booking_stats() with a version that subquery-joins
    order_custom_fees and order_discounts per order to compute the true
    gross order value.
  - Formula per order:
      subtotal + travel_fee + surface_fee + same_day_pickup_fee +
      generator_fee + tax + SUM(custom_fees) - SUM(discount amounts/pcts)
  - tip is intentionally excluded (tracked separately, not part of order cost)
  - Runs a backfill to correct all existing contacts

  ## Notes
  - Percentage discounts are applied against subtotal_cents (same as app logic)
  - No schema changes — trigger function logic only
  - Trigger fires on orders INSERT/UPDATE (unchanged)
*/

CREATE OR REPLACE FUNCTION update_contact_booking_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_email text;
  v_total_bookings integer;
  v_total_spent bigint;
  v_completed_count integer;
  v_first_completed date;
  v_last_completed date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT email INTO target_email FROM public.customers WHERE id = OLD.customer_id;
  ELSE
    SELECT email INTO target_email FROM public.customers WHERE id = NEW.customer_id;
  END IF;

  IF target_email IS NOT NULL THEN
    SELECT
      COUNT(*) FILTER (WHERE o.status NOT IN ('draft', 'void', 'cancelled')),
      COALESCE(SUM(
        o.subtotal_cents +
        o.travel_fee_cents +
        o.surface_fee_cents +
        COALESCE(o.same_day_pickup_fee_cents, 0) +
        COALESCE(o.generator_fee_cents, 0) +
        o.tax_cents +
        COALESCE((
          SELECT SUM(cf.amount_cents)
          FROM public.order_custom_fees cf
          WHERE cf.order_id = o.id
        ), 0) -
        COALESCE((
          SELECT SUM(
            CASE
              WHEN od.percentage IS NOT NULL AND od.percentage > 0
                THEN ROUND(o.subtotal_cents * (od.percentage / 100.0))
              ELSE COALESCE(od.amount_cents, 0)
            END
          )
          FROM public.order_discounts od
          WHERE od.order_id = o.id
        ), 0)
      ) FILTER (WHERE o.status NOT IN ('draft', 'void', 'cancelled')), 0),
      COUNT(*) FILTER (WHERE o.status = 'completed'),
      MIN(o.event_date::date) FILTER (WHERE o.status = 'completed'),
      MAX(o.event_date::date) FILTER (WHERE o.status = 'completed')
    INTO
      v_total_bookings,
      v_total_spent,
      v_completed_count,
      v_first_completed,
      v_last_completed
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE c.email = target_email;

    UPDATE public.contacts
    SET
      total_bookings = COALESCE(v_total_bookings, 0),
      total_spent_cents = COALESCE(v_total_spent, 0),
      completed_bookings_count = COALESCE(v_completed_count, 0),
      first_completed_booking_date = v_first_completed,
      last_completed_booking_date = v_last_completed,
      is_repeat_customer = COALESCE(v_completed_count, 0) > 1,
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

-- Backfill all existing contacts with corrected total_spent_cents
DO $$
DECLARE
  v_contact RECORD;
  v_total_bookings integer;
  v_total_spent bigint;
  v_completed_count integer;
  v_first_completed date;
  v_last_completed date;
BEGIN
  FOR v_contact IN SELECT id, email FROM contacts WHERE email IS NOT NULL LOOP
    SELECT
      COUNT(*) FILTER (WHERE o.status NOT IN ('draft', 'void', 'cancelled')),
      COALESCE(SUM(
        o.subtotal_cents +
        o.travel_fee_cents +
        o.surface_fee_cents +
        COALESCE(o.same_day_pickup_fee_cents, 0) +
        COALESCE(o.generator_fee_cents, 0) +
        o.tax_cents +
        COALESCE((
          SELECT SUM(cf.amount_cents)
          FROM public.order_custom_fees cf
          WHERE cf.order_id = o.id
        ), 0) -
        COALESCE((
          SELECT SUM(
            CASE
              WHEN od.percentage IS NOT NULL AND od.percentage > 0
                THEN ROUND(o.subtotal_cents * (od.percentage / 100.0))
              ELSE COALESCE(od.amount_cents, 0)
            END
          )
          FROM public.order_discounts od
          WHERE od.order_id = o.id
        ), 0)
      ) FILTER (WHERE o.status NOT IN ('draft', 'void', 'cancelled')), 0),
      COUNT(*) FILTER (WHERE o.status = 'completed'),
      MIN(o.event_date::date) FILTER (WHERE o.status = 'completed'),
      MAX(o.event_date::date) FILTER (WHERE o.status = 'completed')
    INTO
      v_total_bookings,
      v_total_spent,
      v_completed_count,
      v_first_completed,
      v_last_completed
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE c.email = v_contact.email;

    UPDATE contacts SET
      total_bookings = COALESCE(v_total_bookings, 0),
      total_spent_cents = COALESCE(v_total_spent, 0),
      completed_bookings_count = COALESCE(v_completed_count, 0),
      first_completed_booking_date = v_first_completed,
      last_completed_booking_date = v_last_completed,
      is_repeat_customer = COALESCE(v_completed_count, 0) > 1,
      updated_at = now()
    WHERE id = v_contact.id;
  END LOOP;
END $$;
