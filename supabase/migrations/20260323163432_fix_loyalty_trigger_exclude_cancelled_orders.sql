/*
  # Fix Loyalty Trigger: Exclude Cancelled Orders from total_bookings and total_spent_cents

  ## Summary
  The update_contact_booking_stats() trigger previously counted cancelled orders
  in both total_bookings and total_spent_cents, inflating booking counts and
  lifetime spend for customers with cancelled orders.

  ## Business Rule
  - total_bookings: only count orders the customer actually completed or is in
    process of completing (confirmed, in_progress, completed, pending_review,
    awaiting_customer_approval) — NOT cancelled or draft or void
  - total_spent_cents: only count revenue from non-draft, non-void, non-cancelled
    orders — money that was actually or is expected to be collected
  - completed_bookings_count: already correct — only 'completed' status

  ## Changes
  - Replaces update_contact_booking_stats() trigger function
  - total_bookings filter: NOT IN ('draft', 'void', 'cancelled')
  - total_spent_cents filter: NOT IN ('draft', 'void', 'cancelled')
  - completed_bookings_count filter: unchanged (= 'completed')
  - Runs a backfill to correct all existing contacts

  ## Notes
  - No schema changes — only trigger function logic updated
  - Backfill re-runs for all contacts with email addresses
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
        o.tax_cents
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

-- Backfill all existing contacts to correct any inflated values
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
        o.tax_cents
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
