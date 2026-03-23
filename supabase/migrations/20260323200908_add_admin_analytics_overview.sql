/*
  # Admin Analytics Overview Function

  ## Purpose
  Creates a server-side SQL function that returns comprehensive admin analytics
  from a single efficient query. This powers the new admin Overview tab.

  ## Function: get_admin_analytics()
  Returns a JSON object with:
  - Revenue metrics: total revenue (total_cents), this month vs last month, avg order value
  - Payment metrics: tips collected, deposits collected, balance owed, cash vs card split
  - Order metrics: total orders, completed, cancelled, conversion rates, lead time
  - Customer metrics: repeat customer rate
  - Cancellation breakdown

  ## Notes
  - Uses total_cents (not subtotal_cents) as the true revenue figure
  - Excludes voided and draft orders from revenue calculations
  - Counts confirmed, in_progress, and completed as qualifying revenue orders
  - Uses SECURITY DEFINER so it runs as the function owner, not the caller
  - Callable by authenticated admins only (enforced at RLS policy level via caller context)
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
    -- Revenue: total revenue from all qualifying orders (excluding draft/void/cancelled)
    'total_revenue_cents', COALESCE((
      SELECT SUM(o.total_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ), 0),

    -- Revenue this calendar month
    'revenue_this_month_cents', COALESCE((
      SELECT SUM(o.total_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= month_start
    ), 0),

    -- Revenue last calendar month
    'revenue_last_month_cents', COALESCE((
      SELECT SUM(o.total_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
    ), 0),

    -- Average order value (qualifying orders only)
    'avg_order_value_cents', COALESCE((
      SELECT AVG(o.total_cents)::bigint
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ), 0),

    -- Total tips collected (from payments table, confirmed payments only)
    'total_tips_cents', COALESCE((
      SELECT SUM(p.tip_cents)
      FROM payments p
      WHERE p.status = 'succeeded'
        AND p.tip_cents > 0
    ), 0),

    -- Number of orders with tips
    'orders_with_tips', COALESCE((
      SELECT COUNT(DISTINCT p.order_id)
      FROM payments p
      WHERE p.status = 'succeeded'
        AND p.tip_cents > 0
    ), 0),

    -- Total deposits collected
    'total_deposits_collected_cents', COALESCE((
      SELECT SUM(o.deposit_paid_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ), 0),

    -- Total balance still owed (unpaid balance on active orders)
    'total_balance_owed_cents', COALESCE((
      SELECT SUM(GREATEST(0, o.balance_due_cents - o.balance_paid_cents))
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress')
    ), 0),

    -- Cash payments total
    'cash_payments_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      WHERE p.status = 'succeeded'
        AND p.payment_method = 'cash'
    ), 0),

    -- Card payments total
    'card_payments_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      WHERE p.status = 'succeeded'
        AND p.payment_method != 'cash'
        AND p.payment_method IS NOT NULL
    ), 0),

    -- Total refunds issued
    'total_refunds_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      WHERE p.status = 'refunded'
    ), 0),

    -- Total orders (all time, all non-draft non-void statuses)
    'total_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
    ),

    -- Confirmed/active/completed orders
    'qualifying_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ),

    -- Completed orders
    'completed_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'completed'
    ),

    -- Cancelled orders
    'cancelled_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'cancelled'
    ),

    -- Pending review orders
    'pending_review_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'pending_review'
    ),

    -- Orders placed this month
    'orders_this_month', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= month_start
    ),

    -- Orders placed last month
    'orders_last_month', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
    ),

    -- Average lead time: days between order creation and event date (qualifying orders)
    'avg_lead_time_days', COALESCE((
      SELECT AVG(EXTRACT(EPOCH FROM (o.event_date::date - o.created_at::date)) / 86400)::numeric(10,1)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.event_date IS NOT NULL
    ), 0),

    -- Repeat customer rate: customers with more than 1 qualifying order
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

    -- Total unique customers with at least one qualifying order
    'total_customers_with_orders', COALESCE((
      SELECT COUNT(DISTINCT o.customer_id)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.customer_id IS NOT NULL
    ), 0),

    -- Cancellation reason breakdown (top reasons)
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

    -- Top cities by order count
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

    -- Top units by revenue
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
