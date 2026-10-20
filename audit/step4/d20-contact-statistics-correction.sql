-- SUPERSEDED by d20-durable-contact-statistics-correction.sql: do NOT run this file alone (the obsolete trigger would overwrite the repair on the next order update).
-- D20 PART 1: correct the stale contact statistics in DEVELOPMENT ONLY (project srxunxiytojjsuhcmzjg). PREPARED, NOT AUTHORIZED, NOT EXECUTED.
-- Touches only public.contacts (statistics columns). Never touches orders, payments, invoices, deposits, order items or amounts.
-- The authoritative order total is the application's own definition (src/lib/pricing/orderMoney.ts composeOrderTotal):
--   subtotal + travel + surface + generator + setup + custom fees + same-day pickup + weekday delivery - discounts + stored tax,
--   a discount = amount_cents when > 0, else percentage of the equipment subtotal, together never more than what they discount.
-- Orders in status draft, void or cancelled are not counted (as in the historical D20 function).
-- Expected target on 2026-10-20: 57 contacts (41 total_spent_cents stale, 24 total_bookings stale, some in both).
-- The script stops (no change) when the target count differs, so a changed database is never corrected blindly.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-d20-contact-stats'));
DO $bpc$
DECLARE
  n_target integer;
  n_updated integer;
  n_left integer;
BEGIN
  CREATE TEMP TABLE d20_target ON COMMIT DROP AS
  WITH oc AS (
    SELECT c.email, o.id, o.status, o.event_date,
      o.subtotal_cents AS sub,
      (o.subtotal_cents + o.travel_fee_cents + o.surface_fee_cents + COALESCE(o.generator_fee_cents, 0) + COALESCE(o.setup_fee_cents, 0)
        + COALESCE((SELECT SUM(CASE WHEN cf.amount_cents > 0 THEN cf.amount_cents ELSE 0 END) FROM public.order_custom_fees cf WHERE cf.order_id = o.id), 0)
        + COALESCE(o.same_day_pickup_fee_cents, 0) + COALESCE(o.same_day_weekday_delivery_fee_cents, 0)) AS pre,
      COALESCE((SELECT SUM(CASE WHEN od.amount_cents > 0 THEN ROUND(od.amount_cents)
                               WHEN od.percentage > 0 THEN ROUND(o.subtotal_cents * (od.percentage / 100.0)) ELSE 0 END)
                FROM public.order_discounts od WHERE od.order_id = o.id), 0) AS disc_raw,
      o.tax_cents AS tax
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE c.email IS NOT NULL
  ), agg AS (
    SELECT email,
      COUNT(*) FILTER (WHERE status NOT IN ('draft', 'void', 'cancelled'))::integer AS tb,
      COALESCE(SUM(pre - LEAST(disc_raw, GREATEST(0, pre)) + tax) FILTER (WHERE status NOT IN ('draft', 'void', 'cancelled')), 0)::integer AS ts,
      COUNT(*) FILTER (WHERE status = 'completed')::integer AS cc,
      MIN(event_date::date) FILTER (WHERE status = 'completed') AS fc,
      MAX(event_date::date) FILTER (WHERE status = 'completed') AS lc
    FROM oc GROUP BY email
  )
  SELECT ct.id, agg.tb, agg.ts, agg.cc, agg.fc, agg.lc
  FROM public.contacts ct JOIN agg ON agg.email = ct.email
  WHERE ct.total_bookings IS DISTINCT FROM agg.tb
     OR ct.total_spent_cents IS DISTINCT FROM agg.ts
     OR ct.completed_bookings_count IS DISTINCT FROM agg.cc
     OR ct.first_completed_booking_date IS DISTINCT FROM agg.fc
     OR ct.last_completed_booking_date IS DISTINCT FROM agg.lc
     OR ct.is_repeat_customer IS DISTINCT FROM (agg.cc > 1);
  SELECT count(*) INTO n_target FROM d20_target;
  IF n_target <> 57 THEN RAISE EXCEPTION 'D20 target count % differs from the authorized 57', n_target; END IF;
  UPDATE public.contacts c SET
    total_bookings = t.tb, total_spent_cents = t.ts, completed_bookings_count = t.cc,
    first_completed_booking_date = t.fc, last_completed_booking_date = t.lc, is_repeat_customer = (t.cc > 1)
  FROM d20_target t WHERE c.id = t.id;
  GET DIAGNOSTICS n_updated = ROW_COUNT;
  IF n_updated <> 57 THEN RAISE EXCEPTION 'D20 updated % rows, expected 57', n_updated; END IF;
  SELECT count(*) INTO n_left FROM public.contacts ct JOIN d20_target t ON t.id = ct.id
   WHERE ct.total_bookings IS DISTINCT FROM t.tb OR ct.total_spent_cents IS DISTINCT FROM t.ts;
  IF n_left <> 0 THEN RAISE EXCEPTION 'D20 post-check failed for % contacts', n_left; END IF;
END $bpc$;
-- Note: the BEFORE UPDATE trigger update_contacts_updated_at sets contacts.updated_at for the 57 rows; nothing else changes.
-- Rollback: restore the 57 rows from the pre-change capture (d20-contact-statistics-correction-plan.md section 5); never by re-running a migration.
