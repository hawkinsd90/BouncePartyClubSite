/*
  # Add Loyalty Fields to Contacts

  ## Summary
  Adds completion-specific loyalty tracking fields directly to the contacts table
  and updates the existing trigger function to populate them.

  ## Changes

  ### Modified Table: contacts
  - `completed_bookings_count` (integer, default 0) — count of orders with status = 'completed'
  - `first_completed_booking_date` (date, nullable) — event_date of earliest completed order
  - `last_completed_booking_date` (date, nullable) — event_date of most recent completed order
  - `is_repeat_customer` (boolean, default false) — true when completed_bookings_count > 1

  ### Modified Function: update_contact_booking_stats()
  - Extended to also compute and write the 4 new loyalty fields alongside existing fields

  ## Notes
  - Soft-add: uses IF NOT EXISTS guard so re-running is safe
  - A backfill runs at end of migration to populate all existing contacts
  - is_repeat_customer is a convenience boolean, always derived from completed_bookings_count
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'completed_bookings_count'
  ) THEN
    ALTER TABLE contacts ADD COLUMN completed_bookings_count integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'first_completed_booking_date'
  ) THEN
    ALTER TABLE contacts ADD COLUMN first_completed_booking_date date DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'last_completed_booking_date'
  ) THEN
    ALTER TABLE contacts ADD COLUMN last_completed_booking_date date DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'is_repeat_customer'
  ) THEN
    ALTER TABLE contacts ADD COLUMN is_repeat_customer boolean NOT NULL DEFAULT false;
  END IF;
END $$;

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
      COUNT(*) FILTER (WHERE o.status NOT IN ('draft', 'void')),
      COALESCE(SUM(
        o.subtotal_cents +
        o.travel_fee_cents +
        o.surface_fee_cents +
        COALESCE(o.same_day_pickup_fee_cents, 0) +
        COALESCE(o.generator_fee_cents, 0) +
        o.tax_cents
      ) FILTER (WHERE o.status NOT IN ('draft', 'void')), 0),
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

-- Backfill all existing contacts with loyalty stats
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
      COUNT(*) FILTER (WHERE o.status NOT IN ('draft', 'void')),
      COALESCE(SUM(
        o.subtotal_cents +
        o.travel_fee_cents +
        o.surface_fee_cents +
        COALESCE(o.same_day_pickup_fee_cents, 0) +
        COALESCE(o.generator_fee_cents, 0) +
        o.tax_cents
      ) FILTER (WHERE o.status NOT IN ('draft', 'void')), 0),
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
