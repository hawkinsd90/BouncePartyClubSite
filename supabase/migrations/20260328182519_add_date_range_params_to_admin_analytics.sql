/*
  # Add Date Range Parameters to get_admin_analytics

  ## Purpose
  Updates the get_admin_analytics() function to accept optional start/end timestamp
  parameters so the Business Analytics tab can be filtered by time period — matching
  the same filter options available on the Site Analytics tab.

  ## Changes
  - Drops and recreates get_admin_analytics() with two new optional parameters:
    - p_start timestamptz (default: beginning of time / no lower bound)
    - p_end timestamptz (default: now)
  - All order-level queries are scoped to orders created within [p_start, p_end]
  - "All-time" metrics (total_revenue, top_units, etc.) also respect the window
  - Passing no arguments preserves existing all-time behavior

  ## Notes
  - SECURITY DEFINER preserved; grant re-issued to authenticated
*/

DROP FUNCTION IF EXISTS get_admin_analytics();

CREATE OR REPLACE FUNCTION get_admin_analytics(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_start timestamptz := COALESCE(p_start, '-infinity'::timestamptz);
  v_end   timestamptz := COALESCE(p_end,   now());
  month_start      timestamptz := date_trunc('month', now());
  last_month_start timestamptz := date_trunc('month', now() - interval '1 month');
  last_month_end   timestamptz := month_start;
BEGIN
  SELECT jsonb_build_object(

    'total_revenue_cents', COALESCE((
      SELECT SUM(o.total_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'revenue_this_month_cents', COALESCE((
      SELECT SUM(o.total_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= month_start
        AND o.created_at <= v_end
    ), 0),

    'revenue_last_month_cents', COALESCE((
      SELECT SUM(o.total_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
    ), 0),

    'avg_order_value_cents', COALESCE((
      SELECT AVG(o.total_cents)::bigint
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'total_tips_cents', COALESCE((
      SELECT SUM(p.tip_cents)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded'
        AND p.tip_cents > 0
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'orders_with_tips', COALESCE((
      SELECT COUNT(DISTINCT p.order_id)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded'
        AND p.tip_cents > 0
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'total_deposits_collected_cents', COALESCE((
      SELECT SUM(o.deposit_paid_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'total_balance_owed_cents', COALESCE((
      SELECT SUM(GREATEST(0, o.balance_due_cents - o.balance_paid_cents))
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'cash_payments_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded'
        AND p.payment_method = 'cash'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'card_payments_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded'
        AND p.payment_method != 'cash'
        AND p.payment_method IS NOT NULL
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'total_refunds_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'refunded'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'total_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ),

    'qualifying_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ),

    'completed_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'completed'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ),

    'cancelled_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'cancelled'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ),

    'pending_review_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'pending_review'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ),

    'orders_this_month', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= month_start
        AND o.created_at <= v_end
    ),

    'orders_last_month', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
    ),

    'avg_lead_time_days', COALESCE((
      SELECT AVG(EXTRACT(EPOCH FROM (o.event_date::date - o.created_at::date)) / 86400)::numeric(10,1)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.event_date IS NOT NULL
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'repeat_customers', COALESCE((
      SELECT COUNT(*)
      FROM (
        SELECT o.customer_id
        FROM orders o
        WHERE o.status IN ('confirmed', 'in_progress', 'completed')
          AND o.customer_id IS NOT NULL
          AND o.created_at >= v_start
          AND o.created_at <= v_end
        GROUP BY o.customer_id
        HAVING COUNT(*) > 1
      ) repeat_cust
    ), 0),

    'total_customers_with_orders', COALESCE((
      SELECT COUNT(DISTINCT o.customer_id)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.customer_id IS NOT NULL
        AND o.created_at >= v_start
        AND o.created_at <= v_end
    ), 0),

    'cancellation_reasons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', cnt) ORDER BY cnt DESC)
      FROM (
        SELECT
          COALESCE(NULLIF(TRIM(o.cancellation_reason), ''), 'No reason provided') AS reason,
          COUNT(*) AS cnt
        FROM orders o
        WHERE o.status = 'cancelled'
          AND o.created_at >= v_start
          AND o.created_at <= v_end
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
          AND o.created_at >= v_start
          AND o.created_at <= v_end
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
          AND o.created_at >= v_start
          AND o.created_at <= v_end
        GROUP BY u.name
        ORDER BY rev DESC
        LIMIT 10
      ) top_u
    ), '[]'::jsonb)

  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_analytics(timestamptz, timestamptz) TO authenticated;
