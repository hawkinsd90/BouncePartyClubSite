-- D20 DURABLE CORRECTION: ROLLBACK (DEVELOPMENT ONLY). PREPARED, NOT AUTHORIZED, NOT EXECUTED. Needs the owner's separate instruction.
-- Restores the objects exactly as deployed on 2026-10-20 (function bodies by md5 6725e093... and 274c7441...) and the captured contact rows.
-- {{CAPTURE_JSON}} is replaced at execution by the pre-change capture of the 57 target contacts (a jsonb array of objects with
-- id, total_bookings, total_spent_cents, completed_bookings_count, first_completed_booking_date, last_completed_booking_date, is_repeat_customer),
-- taken read-only immediately before the correction and kept outside Git. No order, payment or invoice is involved either way.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-d20-durable'));
DO $bpc$
DECLARE
  n_cap integer;
  n_upd integer;
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trigger_update_contact_stats', 'trigger_update_contact_stats_order_fees', 'trigger_update_contact_stats_order_discounts', 'trigger_update_contact_stats_new_contact')) <> 4 THEN RAISE EXCEPTION 'D20 rollback: the durable trigger set is not present'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_contact_stats_trigger') THEN RAISE EXCEPTION 'D20 rollback: the legacy trigger already exists'; END IF;

  DROP TRIGGER trigger_update_contact_stats_new_contact ON public.contacts;
  DROP TRIGGER trigger_update_contact_stats_order_discounts ON public.order_discounts;
  DROP TRIGGER trigger_update_contact_stats_order_fees ON public.order_custom_fees;
  DROP TRIGGER trigger_update_contact_stats ON public.orders;

  CREATE OR REPLACE FUNCTION public.update_contact_booking_stats()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
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
$fn$;

  CREATE FUNCTION public.update_contact_stats()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $fn$
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
$fn$;

  DROP FUNCTION public.update_contact_booking_stats_for_new_contact();
  DROP FUNCTION public.update_contact_booking_stats_from_order_child();
  DROP FUNCTION public.refresh_contact_booking_stats(text);
  -- both deployed functions had the default (empty) ACL; GRANT to PUBLIC returns them to it
  GRANT EXECUTE ON FUNCTION public.update_contact_booking_stats() TO PUBLIC;
  GRANT EXECUTE ON FUNCTION public.update_contact_stats() TO PUBLIC;

  CREATE TRIGGER trigger_update_contact_stats AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_contact_booking_stats();
  CREATE TRIGGER update_contact_stats_trigger AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_contact_stats();

  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'update_contact_booking_stats') <> '6725e093234175510332552d94f128ad'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'update_contact_stats') <> '274c74413a3123241fc9f669042b3e3d'
  THEN RAISE EXCEPTION 'D20 rollback: restored function bodies do not match the deployed originals'; END IF;

  SELECT jsonb_array_length('{{CAPTURE_JSON}}'::jsonb) INTO n_cap;
  IF n_cap <> 57 THEN RAISE EXCEPTION 'D20 rollback: the capture holds % rows, expected 57', n_cap; END IF;
  UPDATE public.contacts c SET
    total_bookings = r.total_bookings, total_spent_cents = r.total_spent_cents, completed_bookings_count = r.completed_bookings_count,
    first_completed_booking_date = r.first_completed_booking_date, last_completed_booking_date = r.last_completed_booking_date, is_repeat_customer = r.is_repeat_customer
  FROM jsonb_to_recordset('{{CAPTURE_JSON}}'::jsonb) AS r(id uuid, total_bookings integer, total_spent_cents integer, completed_bookings_count integer,
    first_completed_booking_date date, last_completed_booking_date date, is_repeat_customer boolean)
  WHERE c.id = r.id;
  GET DIAGNOSTICS n_upd = ROW_COUNT;
  IF n_upd <> 57 THEN RAISE EXCEPTION 'D20 rollback: restored % contacts, expected 57', n_upd; END IF;
END $bpc$;
