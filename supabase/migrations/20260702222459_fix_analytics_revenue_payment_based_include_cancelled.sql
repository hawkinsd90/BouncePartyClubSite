/*
  Redesign get_admin_analytics revenue metrics to be payment-based rather than invoice-based.

  Previous design: total_revenue_cents = SUM(subtotal_cents + tax_cents) for
  confirmed/in_progress/completed orders only. This excluded cancelled orders
  entirely, meaning retained deposits/fees from cancellations went untracked.

  New design:
  - total_revenue_cents = SUM(succeeded payments) - SUM(succeeded refunds)
    for all non-draft/void orders. Cancelled orders with retained deposits now
    contribute correctly. Fully-refunded orders contribute 0.
  - total_deposits_collected_cents = SUM(deposit_paid_cents) for all non-draft/void
    orders (including cancelled) - deposit-portion of succeeded refunds per order.
  - avg_order_value_cents stays invoice-based (confirmed/in_progress/completed)
    as a pricing/deal-size metric.
  - total_refunds_cents reads from order_refunds.status = 'succeeded'.
  - cash/card payment breakdowns stay from payments table (already correct).
*/

DROP FUNCTION IF EXISTS get_admin_analytics(timestamptz, timestamptz);

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

    -- Payment-based revenue: all money actually collected minus all refunds.
    -- Includes cancelled orders with retained deposits; fully-refunded = 0.
    'total_revenue_cents', GREATEST(0, COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded'
        AND o.status NOT IN ('draft', 'void')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0) - COALESCE((
      SELECT SUM(r.amount_cents)
      FROM order_refunds r
      JOIN orders o ON o.id = r.order_id
      WHERE r.status = 'succeeded'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0)),

    'revenue_this_month_cents', GREATEST(0, COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded'
        AND o.status NOT IN ('draft', 'void')
        AND o.created_at >= month_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0) - COALESCE((
      SELECT SUM(r.amount_cents)
      FROM order_refunds r
      JOIN orders o ON o.id = r.order_id
      WHERE r.status = 'succeeded'
        AND o.created_at >= month_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0)),

    'revenue_last_month_cents', GREATEST(0, COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded'
        AND o.status NOT IN ('draft', 'void')
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0) - COALESCE((
      SELECT SUM(r.amount_cents)
      FROM order_refunds r
      JOIN orders o ON o.id = r.order_id
      WHERE r.status = 'succeeded'
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0)),

    -- Invoice-based average: reflects typical deal size, not cash collected.
    'avg_order_value_cents', COALESCE((
      SELECT AVG(o.subtotal_cents + o.tax_cents)::bigint
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0),

    'total_tips_cents', COALESCE((
      SELECT SUM(o.tip_cents)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.tip_cents > 0
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0),

    'orders_with_tips', COALESCE((
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.tip_cents > 0
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0),

    -- Deposits collected: includes cancelled orders with retained deposits.
    -- Deposit-first allocation: refunds reduce deposits before reducing other revenue.
    'total_deposits_collected_cents', GREATEST(0, COALESCE((
      SELECT SUM(o.deposit_paid_cents)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.deposit_paid_cents > 0
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0) - COALESCE((
      SELECT SUM(LEAST(order_refund_total, order_deposit))
      FROM (
        SELECT
          COALESCE(o.deposit_paid_cents, 0) AS order_deposit,
          COALESCE((
            SELECT SUM(r.amount_cents)
            FROM order_refunds r
            WHERE r.order_id = o.id AND r.status = 'succeeded'
          ), 0) AS order_refund_total
        FROM orders o
        WHERE o.status NOT IN ('draft', 'void')
          AND o.deposit_paid_cents > 0
          AND o.created_at >= v_start
          AND o.created_at <= v_end
          AND NOT EXISTS (
            SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
            WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
          )
      ) refund_calc
      WHERE order_refund_total > 0
    ), 0)),

    'total_balance_owed_cents', COALESCE((
      SELECT SUM(GREATEST(0, o.balance_due_cents - o.balance_paid_cents))
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0),

    'cash_payments_cents', COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'succeeded'
        AND p.payment_method = 'cash'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
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
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0),

    'total_refunds_cents', COALESCE((
      SELECT SUM(r.amount_cents)
      FROM order_refunds r
      JOIN orders o ON o.id = r.order_id
      WHERE r.status = 'succeeded'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ), 0),

    'total_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ),

    'qualifying_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ),

    'completed_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'completed'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ),

    'cancelled_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'cancelled'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ),

    'pending_review_orders', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status = 'pending_review'
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ),

    'orders_this_month', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= month_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ),

    'orders_last_month', (
      SELECT COUNT(*)
      FROM orders o
      WHERE o.status NOT IN ('draft', 'void')
        AND o.created_at >= last_month_start
        AND o.created_at < last_month_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
    ),

    'avg_lead_time_days', COALESCE((
      SELECT AVG((o.event_date::date - o.created_at::date))::numeric(10,1)
      FROM orders o
      WHERE o.status IN ('confirmed', 'in_progress', 'completed')
        AND o.event_date IS NOT NULL
        AND o.created_at >= v_start
        AND o.created_at <= v_end
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
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
          AND NOT EXISTS (
            SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
            WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
          )
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
        AND NOT EXISTS (
          SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
          WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
        )
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
          AND NOT EXISTS (
            SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
            WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
          )
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
          AND NOT EXISTS (
            SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
            WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
          )
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
          AND NOT EXISTS (
            SELECT 1 FROM customers c JOIN user_roles ur ON ur.user_id = c.user_id
            WHERE c.id = o.customer_id AND ur.role IN ('admin','master')
          )
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
