-- ============================================================
-- Fix check_product_availability: resolve CTE column ambiguity
-- ============================================================

CREATE OR REPLACE FUNCTION check_product_availability(
  p_requested_items jsonb,
  p_start_date date,
  p_end_date date,
  p_exclude_order_id uuid DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  total_quantity integer,
  temp_unavailable_qty integer,
  already_reserved integer,
  quantity_requested integer,
  available_before_request integer,
  remaining_after_request integer,
  is_allowed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item_count integer;
  v_invalid_uuid_count integer;
  v_invalid_qty_count integer;
  v_missing_product_count integer;
BEGIN
  -- Validate p_requested_items is a JSON array
  IF p_requested_items IS NULL OR jsonb_typeof(p_requested_items) != 'array' THEN
    RAISE EXCEPTION 'p_requested_items must be a non-null JSON array';
  END IF;

  -- Validate date range
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'p_start_date (%) must not be greater than p_end_date (%)',
      p_start_date, p_end_date;
  END IF;

  -- Validate array is not empty
  v_item_count := jsonb_array_length(p_requested_items);
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'p_requested_items must contain at least one item';
  END IF;

  -- Validate every product_id is a valid UUID (case-insensitive)
  SELECT COUNT(*) INTO v_invalid_uuid_count
  FROM jsonb_array_elements(p_requested_items) AS item
  WHERE (item->>'product_id') IS NULL
     OR (item->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_invalid_uuid_count > 0 THEN
    RAISE EXCEPTION 'All product_id values must be valid UUIDs';
  END IF;

  -- Validate every quantity is a positive integer
  SELECT COUNT(*) INTO v_invalid_qty_count
  FROM jsonb_array_elements(p_requested_items) AS item
  WHERE (item->>'quantity') IS NULL
     OR (item->>'quantity') !~ '^[0-9]+$'
     OR (item->>'quantity')::integer <= 0;

  IF v_invalid_qty_count > 0 THEN
    RAISE EXCEPTION 'All quantity values must be positive integers';
  END IF;

  -- Validate all requested products exist
  WITH requested_ids AS (
    SELECT DISTINCT (item->>'product_id')::uuid AS pid
    FROM jsonb_array_elements(p_requested_items) AS item
  )
  SELECT COUNT(*) INTO v_missing_product_count
  FROM requested_ids r
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory_products ip WHERE ip.id = r.pid
  );

  IF v_missing_product_count > 0 THEN
    RAISE EXCEPTION '% requested product(s) not found in inventory_products', v_missing_product_count;
  END IF;

  RETURN QUERY
  WITH
  -- Aggregate requested items (sum duplicates); alias as req_pid to avoid ambiguity
  requested AS (
    SELECT
      (item->>'product_id')::uuid AS req_pid,
      SUM((item->>'quantity')::integer) AS req_qty
    FROM jsonb_array_elements(p_requested_items) AS item
    GROUP BY (item->>'product_id')::uuid
  ),
  -- Individual product order items
  direct_booked AS (
    SELECT
      oi.product_id AS booked_pid,
      SUM(oi.qty) AS qty_booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE oi.product_id IS NOT NULL
      AND o.status IN ('pending_review', 'awaiting_customer_approval', 'confirmed', 'in_progress')
      AND o.event_date <= p_end_date
      AND COALESCE(o.event_end_date, o.event_date) >= p_start_date
      AND (p_exclude_order_id IS NULL OR o.id != p_exclude_order_id)
    GROUP BY oi.product_id
  ),
  -- Bundle order items: expand component_snapshot
  bundle_booked AS (
    SELECT
      (comp->>'product_id')::uuid AS booked_pid,
      SUM(oi.qty * (comp->>'quantity_per_bundle')::integer) AS qty_booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    CROSS JOIN jsonb_array_elements(oi.component_snapshot->'components') AS comp
    WHERE oi.bundle_id IS NOT NULL
      AND oi.component_snapshot IS NOT NULL
      AND o.status IN ('pending_review', 'awaiting_customer_approval', 'confirmed', 'in_progress')
      AND o.event_date <= p_end_date
      AND COALESCE(o.event_end_date, o.event_date) >= p_start_date
      AND (p_exclude_order_id IS NULL OR o.id != p_exclude_order_id)
    GROUP BY (comp->>'product_id')::uuid
  ),
  -- Combine all reservations per product
  total_booked AS (
    SELECT booked_pid, SUM(qty_booked) AS total_reserved
    FROM (
      SELECT booked_pid, qty_booked FROM direct_booked
      UNION ALL
      SELECT booked_pid, qty_booked FROM bundle_booked
    ) combined
    GROUP BY booked_pid
  )
  SELECT
    ip.id,
    ip.name,
    ip.total_quantity,
    ip.temp_unavailable_qty,
    COALESCE(tb.total_reserved, 0)::integer,
    COALESCE(r.req_qty, 0)::integer,
    (ip.total_quantity - ip.temp_unavailable_qty - COALESCE(tb.total_reserved, 0))::integer,
    (ip.total_quantity - ip.temp_unavailable_qty - COALESCE(tb.total_reserved, 0) - COALESCE(r.req_qty, 0))::integer,
    (COALESCE(r.req_qty, 0) <= ip.total_quantity - ip.temp_unavailable_qty - COALESCE(tb.total_reserved, 0))
  FROM inventory_products ip
  LEFT JOIN total_booked tb ON tb.booked_pid = ip.id
  LEFT JOIN requested r ON r.req_pid = ip.id
  WHERE r.req_pid IS NOT NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION check_product_availability(jsonb, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_product_availability(jsonb, date, date, uuid) TO anon, authenticated, service_role;
