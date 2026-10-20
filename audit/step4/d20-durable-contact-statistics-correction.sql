-- D20 DURABLE CORRECTION (DEVELOPMENT ONLY, project srxunxiytojjsuhcmzjg). PREPARED, NOT AUTHORIZED, NOT EXECUTED.
-- One transaction: one statistics mechanism (replaces the two competing writers), triggers covering every input of the statistic,
-- and the one-time repair of the stale contacts. Never touches orders, payments, invoices, deposits, order items or any amount.
-- Placement: AFTER the sealed executor stages (S5 to S7) and S12; the executor refuses any catalog drift before then (see d20-durable-correction-plan.md).
-- Authoritative order total = the application's definition (src/lib/pricing/orderMoney.ts composeOrderTotal):
--   subtotal + travel + surface + generator + setup + custom fees (whole, non-negative) + same-day pickup + weekday delivery
--   - discounts + stored tax; a discount = amount_cents when > 0, else percentage of the equipment subtotal, together never more
--   than what they discount. Orders in status draft, void or cancelled are not counted.
-- Expected on the 2026-10-20 Development data: 57 contacts repaired (41 total_spent_cents, 24 total_bookings, some both).
-- Preconditions are asserted first and the whole script stops, changing nothing, when any differs (so a changed database is never edited blindly).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-d20-durable'));
DO $bpc$
DECLARE
  n_target integer;
  n_left integer;
  r record;
BEGIN
  -- 0. preconditions: exactly the objects this script replaces or removes, in exactly the deployed state
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'update_contact_booking_stats') IS DISTINCT FROM '6725e093234175510332552d94f128ad' THEN RAISE EXCEPTION 'D20: update_contact_booking_stats differs from the reviewed version'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'update_contact_stats') IS DISTINCT FROM '274c74413a3123241fc9f669042b3e3d' THEN RAISE EXCEPTION 'D20: update_contact_stats differs from the reviewed version'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'public.orders'::regclass AND tgname IN ('trigger_update_contact_stats', 'update_contact_stats_trigger')) <> 2 THEN RAISE EXCEPTION 'D20: the two statistics triggers on orders are not as reviewed'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('refresh_contact_booking_stats', 'update_contact_booking_stats_from_order_child', 'update_contact_booking_stats_for_new_contact')) THEN RAISE EXCEPTION 'D20: a new object already exists'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trigger_update_contact_stats_order_fees', 'trigger_update_contact_stats_order_discounts', 'trigger_update_contact_stats_new_contact')) THEN RAISE EXCEPTION 'D20: a new trigger already exists'; END IF;

  -- 1. the one place that computes a contact's statistics (all contacts are keyed by e-mail through customers)
  CREATE OR REPLACE FUNCTION public.refresh_contact_booking_stats(p_email text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
DECLARE
  v_tb integer;
  v_ts integer;
  v_cc integer;
  v_fc date;
  v_lc date;
BEGIN
  IF p_email IS NULL THEN
    RETURN;
  END IF;
  SELECT
    COUNT(*) FILTER (WHERE s.status NOT IN ('draft', 'void', 'cancelled')),
    COALESCE(SUM(s.pre - LEAST(s.disc, GREATEST(0, s.pre)) + s.tax) FILTER (WHERE s.status NOT IN ('draft', 'void', 'cancelled')), 0),
    COUNT(*) FILTER (WHERE s.status = 'completed'),
    MIN(s.event_date::date) FILTER (WHERE s.status = 'completed'),
    MAX(s.event_date::date) FILTER (WHERE s.status = 'completed')
  INTO v_tb, v_ts, v_cc, v_fc, v_lc
  FROM (
    SELECT o.status, o.event_date, COALESCE(o.tax_cents, 0) AS tax,
      (COALESCE(o.subtotal_cents, 0) + COALESCE(o.travel_fee_cents, 0) + COALESCE(o.surface_fee_cents, 0) + COALESCE(o.generator_fee_cents, 0)
        + COALESCE(o.setup_fee_cents, 0) + COALESCE(o.same_day_pickup_fee_cents, 0) + COALESCE(o.same_day_weekday_delivery_fee_cents, 0)
        + COALESCE((SELECT SUM(CASE WHEN cf.amount_cents > 0 THEN cf.amount_cents ELSE 0 END) FROM public.order_custom_fees cf WHERE cf.order_id = o.id), 0)) AS pre,
      COALESCE((SELECT SUM(CASE WHEN od.amount_cents > 0 THEN ROUND(od.amount_cents)
                                WHEN od.percentage > 0 THEN ROUND(COALESCE(o.subtotal_cents, 0) * (od.percentage / 100.0)) ELSE 0 END)
                FROM public.order_discounts od WHERE od.order_id = o.id), 0) AS disc
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE c.email = p_email
  ) s;
  UPDATE public.contacts ct SET
    total_bookings = v_tb,
    total_spent_cents = v_ts,
    completed_bookings_count = v_cc,
    first_completed_booking_date = v_fc,
    last_completed_booking_date = v_lc,
    is_repeat_customer = (v_cc > 1)
  WHERE ct.email = p_email
    AND (ct.total_bookings IS DISTINCT FROM v_tb OR ct.total_spent_cents IS DISTINCT FROM v_ts
      OR ct.completed_bookings_count IS DISTINCT FROM v_cc OR ct.first_completed_booking_date IS DISTINCT FROM v_fc
      OR ct.last_completed_booking_date IS DISTINCT FROM v_lc OR ct.is_repeat_customer IS DISTINCT FROM (v_cc > 1));
END;
  $fn$;

  -- 2. the existing trigger function keeps its name and its trigger; it now covers insert, delete and every input column
  CREATE OR REPLACE FUNCTION public.update_contact_booking_stats()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT email INTO v_old FROM public.customers WHERE id = OLD.customer_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT email INTO v_new FROM public.customers WHERE id = NEW.customer_id;
  END IF;
  PERFORM public.refresh_contact_booking_stats(v_new);
  IF v_old IS NOT NULL AND v_old IS DISTINCT FROM v_new THEN
    PERFORM public.refresh_contact_booking_stats(v_old);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
  $fn$;

  -- 3. custom fees and discounts belong to an order: a change there changes the order total
  CREATE FUNCTION public.update_contact_booking_stats_from_order_child()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
DECLARE
  v_order uuid;
BEGIN
  FOR v_order IN
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.order_id END,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.order_id END]) AS x
    WHERE x IS NOT NULL
  LOOP
    PERFORM public.refresh_contact_booking_stats(
      (SELECT c.email FROM public.orders o JOIN public.customers c ON c.id = o.customer_id WHERE o.id = v_order));
  END LOOP;
  RETURN NULL;
END;
  $fn$;

  -- 4. a contact created after its orders (checkout, sign-up) starts with the right statistics
  CREATE FUNCTION public.update_contact_booking_stats_for_new_contact()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
BEGIN
  PERFORM public.refresh_contact_booking_stats(NEW.email);
  RETURN NEW;
END;
  $fn$;

  REVOKE ALL ON FUNCTION public.refresh_contact_booking_stats(text) FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public.update_contact_booking_stats() FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public.update_contact_booking_stats_from_order_child() FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public.update_contact_booking_stats_for_new_contact() FROM PUBLIC, anon, authenticated, service_role;

  -- 5. triggers: the existing one is widened; three are added; the obsolete writer is removed
  DROP TRIGGER trigger_update_contact_stats ON public.orders;
  CREATE TRIGGER trigger_update_contact_stats
    AFTER INSERT OR DELETE OR UPDATE OF status, customer_id, event_date, subtotal_cents, travel_fee_cents, surface_fee_cents, generator_fee_cents,
      setup_fee_cents, same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents, tax_cents
    ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_contact_booking_stats();
  CREATE TRIGGER trigger_update_contact_stats_order_fees
    AFTER INSERT OR UPDATE OR DELETE ON public.order_custom_fees FOR EACH ROW EXECUTE FUNCTION public.update_contact_booking_stats_from_order_child();
  CREATE TRIGGER trigger_update_contact_stats_order_discounts
    AFTER INSERT OR UPDATE OR DELETE ON public.order_discounts FOR EACH ROW EXECUTE FUNCTION public.update_contact_booking_stats_from_order_child();
  CREATE TRIGGER trigger_update_contact_stats_new_contact
    AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_contact_booking_stats_for_new_contact();
  DROP TRIGGER update_contact_stats_trigger ON public.orders;
  DROP FUNCTION public.update_contact_stats();

  -- 6. one-time repair, judged by an independent implementation of the same definition (so the helper is checked, not trusted)
  CREATE TEMP TABLE d20_expected ON COMMIT DROP AS
  WITH oc AS (
    SELECT c.email, o.status, o.event_date,
      (o.subtotal_cents + o.travel_fee_cents + o.surface_fee_cents + COALESCE(o.generator_fee_cents, 0) + COALESCE(o.setup_fee_cents, 0)
        + COALESCE((SELECT SUM(CASE WHEN cf.amount_cents > 0 THEN cf.amount_cents ELSE 0 END) FROM public.order_custom_fees cf WHERE cf.order_id = o.id), 0)
        + COALESCE(o.same_day_pickup_fee_cents, 0) + COALESCE(o.same_day_weekday_delivery_fee_cents, 0)) AS pre,
      COALESCE((SELECT SUM(CASE WHEN od.amount_cents > 0 THEN ROUND(od.amount_cents)
                               WHEN od.percentage > 0 THEN ROUND(o.subtotal_cents * (od.percentage / 100.0)) ELSE 0 END)
                FROM public.order_discounts od WHERE od.order_id = o.id), 0) AS disc,
      o.tax_cents AS tax
    FROM public.orders o JOIN public.customers c ON c.id = o.customer_id WHERE c.email IS NOT NULL
  )
  SELECT email,
    COUNT(*) FILTER (WHERE status NOT IN ('draft', 'void', 'cancelled'))::integer AS tb,
    COALESCE(SUM(pre - LEAST(disc, GREATEST(0, pre)) + tax) FILTER (WHERE status NOT IN ('draft', 'void', 'cancelled')), 0)::integer AS ts,
    COUNT(*) FILTER (WHERE status = 'completed')::integer AS cc,
    MIN(event_date::date) FILTER (WHERE status = 'completed') AS fc,
    MAX(event_date::date) FILTER (WHERE status = 'completed') AS lc
  FROM oc GROUP BY email;
  CREATE TEMP TABLE d20_target ON COMMIT DROP AS
  SELECT ct.email FROM public.contacts ct JOIN d20_expected e ON e.email = ct.email
  WHERE ct.total_bookings IS DISTINCT FROM e.tb OR ct.total_spent_cents IS DISTINCT FROM e.ts OR ct.completed_bookings_count IS DISTINCT FROM e.cc
     OR ct.first_completed_booking_date IS DISTINCT FROM e.fc OR ct.last_completed_booking_date IS DISTINCT FROM e.lc OR ct.is_repeat_customer IS DISTINCT FROM (e.cc > 1);
  SELECT count(*) INTO n_target FROM d20_target;
  IF n_target <> 57 THEN RAISE EXCEPTION 'D20 target count % differs from the authorized 57', n_target; END IF;
  FOR r IN SELECT email FROM d20_target LOOP
    PERFORM public.refresh_contact_booking_stats(r.email);
  END LOOP;
  SELECT count(*) INTO n_left FROM public.contacts ct JOIN d20_expected e ON e.email = ct.email
   WHERE ct.total_bookings IS DISTINCT FROM e.tb OR ct.total_spent_cents IS DISTINCT FROM e.ts OR ct.completed_bookings_count IS DISTINCT FROM e.cc
      OR ct.first_completed_booking_date IS DISTINCT FROM e.fc OR ct.last_completed_booking_date IS DISTINCT FROM e.lc OR ct.is_repeat_customer IS DISTINCT FROM (e.cc > 1);
  IF n_left <> 0 THEN RAISE EXCEPTION 'D20 post-check failed for % contacts', n_left; END IF;

  -- 7. the catalog ends exactly as designed
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%contact_stats%') <> 4 THEN RAISE EXCEPTION 'D20: unexpected statistics trigger set'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_contact_stats_trigger') OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'update_contact_stats') THEN RAISE EXCEPTION 'D20: the obsolete writer is still present'; END IF;
END $bpc$;
-- Rollback after commit: d20-durable-correction-plan.md section 6 and d20-durable-rollback.sql (restores the deployed functions and triggers and the captured contact rows).
