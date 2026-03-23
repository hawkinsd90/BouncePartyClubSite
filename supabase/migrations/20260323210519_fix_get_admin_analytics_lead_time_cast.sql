/*
  # Fix get_admin_analytics() — lead time calculation

  The previous fix still used EXTRACT(EPOCH FROM ...) which fails because
  subtracting a date from a date yields an integer (days), not an interval.

  Fix: use (event_date - created_at::date) directly which returns integer days.
  All other column fixes from the previous migration are preserved here.
*/

CREATE OR REPLACE FUNCTION get_admin_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  now_ts timestamptz := now();
  month_start timestamptz := date_trunc('month', now_ts);
  last_month_start timestamptz := date_trunc('month', now_ts - interval '1 month');
  last_month_end timestamptz := month_start;
BEGIN
  SELECT jsonb_build_object(

    'total_revenue_cents', COALESCE((
      SELECT SUM(
        o.subtotal_cents
        + COALESCE(o.tax_cents, 0)
        + COALESCE(o.travel_fee_cents, 0)
        + COALESCE(o.generator_fee_cents, 0)
        + COALESCE(o.surface_fee_cents, 0)
        + COALESCE(o.same_day_pickup_fee_cents, 0)
      )
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ), 0),

    'revenue_this_month_cents', COALESCE((
      SELECT SUM(
        o.subtotal_cents
        + COALESCE(o.tax_cents, 0)
        + COALESCE(o.travel_fee_cents, 0)
        + COALESCE(o.generator_fee_cents, 0)
        + COALESCE(o.surface_fee_cents, 0)
        + COALESCE(o.same_day_pickup_fee_cents, 0)
      )
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= month_start
    ), 0),

    'revenue_last_month_cents', COALESCE((
      SELECT SUM(
        o.subtotal_cents
        + COALESCE(o.tax_cents, 0)
        + COALESCE(o.travel_fee_cents, 0)
        + COALESCE(o.generator_fee_cents, 0)
        + COALESCE(o.surface_fee_cents, 0)
        + COALESCE(o.same_day_pickup_fee_cents, 0)
      )
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
    ), 0),

    'avg_order_value_cents', COALESCE((
      SELECT AVG(
        o.subtotal_cents
        + COALESCE(o.tax_cents, 0)
        + COALESCE(o.travel_fee_cents, 0)
        + COALESCE(o.generator_fee_cents, 0)
        + COALESCE(o.surface_fee_cents, 0)
        + COALESCE(o.same_day_pickup_fee_cents, 0)
      )::bigint
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ), 0),

    'total_tips_cents', COALESCE((
      SELECT SUM(o.tip_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.tip_cents > 0
    ), 0),

    'orders_with_tips', COALESCE((
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.tip_cents > 0
    ), 0),

    'total_deposits_collected_cents', COALESCE((
      SELECT SUM(o.deposit_paid_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ), 0),

    'total_balance_owed_cents', COALESCE((
      SELECT SUM(GREATEST(0, o.balance_due_cents - o.balance_paid_cents))
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress')
    ), 0),

    'cash_payments_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      WHERE p.status = 'succeeded'
        AND p.payment_method = 'cash'
    ), 0),

    'card_payments_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      WHERE p.status = 'succeeded'
        AND p.payment_method != 'cash'
        AND p.payment_method IS NOT NULL
    ), 0),

    'total_refunds_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      WHERE p.status = 'refunded'
    ), 0),

    'total_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
    ),

    'qualifying_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ),

    'completed_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'completed'
    ),

    'cancelled_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'cancelled'
    ),

    'pending_review_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'pending_review'
    ),

    'orders_this_month', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= month_start
    ),

    'orders_last_month', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
    ),

    -- event_date is type DATE, created_at::date is type DATE; subtraction yields integer days
    'avg_lead_time_days', COALESCE((
      SELECT AVG(o.event_date - o.created_at::date)::numeric(10,1)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.event_date IS NOT NULL
    ), 0),

    'repeat_customers', COALESCE((
      SELECT COUNT(*)
      FROM (
        SELECT o.customer_id
        FROM orders o
        WHERE o.status IN ('confirmed', 'in_progress', 'completed')
          AND o.customer_id IS NOT NULL
        GROUP BY o.customer_id
        HAVING COUNT(*) > 1
      ) repeat_cust
    ), 0),

    'total_customers_with_orders', COALESCE((
      SELECT COUNT(DISTINCT o.customer_id)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.customer_id IS NOT NULL
    ), 0),

    'cancellation_reasons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', cnt) ORDER BY cnt DESC)
      FROM (
        SELECT
          COALESCE(NULLIF(TRIM(o.cancellation_reason), ''), 'No reason provided') AS reason,
          COUNT(*) AS cnt
        FROM orders o
        WHERE o.status = 'cancelled'
        GROUP BY reason
        ORDER BY cnt DESC
        LIMIT 10
      ) reasons
    ), '[]'::jsonb),

    'top_cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', city, 'count', cnt) ORDER BY cnt DESC)
      FROM (
        SELECT a.city, COUNT(*) AS cnt
        FROM orders o
        JOIN addresses a ON a.id = o.address_id
        WHERE o.status IN ('confirmed', 'in_progress', 'completed')
          AND a.city IS NOT NULL
        GROUP BY a.city
        ORDER BY cnt DESC
        LIMIT 10
      ) cities
    ), '[]'::jsonb),

    'top_units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', unit_name, 'revenue_cents', rev, 'bookings', bookings) ORDER BY rev DESC)
      FROM (
        SELECT
          u.name AS unit_name,
          SUM(oi.unit_price_cents * oi.qty) AS rev,
          COUNT(DISTINCT oi.order_id) AS bookings
        FROM order_items oi
        JOIN units u ON u.id = oi.unit_id
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        GROUP BY u.name
        ORDER BY rev DESC
        LIMIT 10
      ) top_u
    ), '[]'::jsonb)

  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_analytics() TO authenticated;
