/*
  # Fix get_admin_analytics() — correct column references

  ## Problem
  The previous version of get_admin_analytics() referenced two columns that do
  not exist on the orders or payments tables:

  1. o.total_cents — does not exist. The correct order total is computed from
     subtotal_cents + tax_cents + travel_fee_cents + generator_fee_cents +
     surface_fee_cents + same_day_pickup_fee_cents. This equals
     deposit_due_cents + balance_due_cents (verified against live data).

  2. payments.tip_cents — does not exist on the payments table. Tips are stored
     on orders.tip_cents and also tracked in transaction_receipts WHERE
     transaction_type = 'tip'. This function uses orders.tip_cents.

  ## Changes
  - Replace all o.total_cents references with the correct computed expression
  - Replace payments.tip_cents references with orders.tip_cents
  - orders_with_tips now counts qualifying orders where tip_cents > 0
  - All other logic is unchanged

  ## Revenue definition
  Revenue = subtotal + tax + travel_fee + generator_fee + surface_fee + same_day_pickup_fee
  This intentionally excludes tips (tips are reported separately).
  Custom fees/discounts are stored in separate tables and are small-volume;
  they are excluded from this aggregate for simplicity and noted in sub-labels.
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

    -- Revenue: sum of order totals (excl. tip) for qualifying orders
    -- order total = subtotal + tax + travel + generator + surface + same_day fees
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

    -- Revenue this calendar month
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

    -- Revenue last calendar month
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

    -- Average order value (qualifying orders only, excl. tip)
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

    -- Total tips collected from qualifying orders (orders.tip_cents)
    'total_tips_cents', COALESCE((
      SELECT SUM(o.tip_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.tip_cents > 0
    ), 0),

    -- Number of qualifying orders with a tip
    'orders_with_tips', COALESCE((
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.tip_cents > 0
    ), 0),

    -- Total deposits collected
    'total_deposits_collected_cents', COALESCE((
      SELECT SUM(o.deposit_paid_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
    ), 0),

    -- Total balance still owed (active orders only)
    'total_balance_owed_cents', COALESCE((
      SELECT SUM(GREATEST(0, o.balance_due_cents - o.balance_paid_cents))
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress')
    ), 0),

    -- Cash payments total (from payments table)
    'cash_payments_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      WHERE p.status = 'succeeded'
        AND p.payment_method = 'cash'
    ), 0),

    -- Card payments total (from payments table)
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

    -- Total orders (all time, non-draft non-void)
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

    -- Average lead time: days between order creation and event date
    'avg_lead_time_days', COALESCE((
      SELECT AVG(EXTRACT(EPOCH FROM (o.event_date::date - o.created_at::date)) / 86400)::numeric(10,1)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.event_date IS NOT NULL
    ), 0),

    -- Repeat customers: those with more than 1 qualifying order
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

    -- Cancellation reason breakdown
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

    -- Top units by revenue (unit_price_cents * qty from order_items)
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
