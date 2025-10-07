/*
  # Fix Availability Check Function - Remove Nested Aggregate

  1. Changes
    - Fix "aggregate function calls cannot be nested" error
    - Use subquery to properly calculate max bookings per unit across date range
    - Correctly handle both event_date and start_date/end_date fields

  2. Purpose
    - Ensure function works without SQL errors
    - Properly check availability across date ranges
*/

DROP FUNCTION IF EXISTS check_unit_availability(uuid[], date, date);

CREATE OR REPLACE FUNCTION check_unit_availability(
  p_unit_ids uuid[],
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  unit_id uuid, 
  unit_name text,
  requested_qty integer, 
  available_qty integer, 
  available boolean
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH unit_requests AS (
    SELECT 
      unnest(p_unit_ids) AS uid,
      COUNT(*) AS requested
    FROM unnest(p_unit_ids) AS uid
    GROUP BY uid
  ),
  -- First aggregate per unit and date
  daily_bookings AS (
    SELECT 
      oi.unit_id,
      COALESCE(o.event_date, o.start_date) as booking_date,
      SUM(oi.qty) AS qty_booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status IN ('pending_review', 'confirmed', 'in_progress')
      AND oi.unit_id = ANY(p_unit_ids)
      AND (
        -- Check for any overlap with the requested date range
        (o.start_date IS NOT NULL AND o.end_date IS NOT NULL 
         AND o.start_date <= p_end_date AND o.end_date >= p_start_date)
        OR
        (o.event_date IS NOT NULL 
         AND o.event_date >= p_start_date AND o.event_date <= p_end_date)
      )
    GROUP BY oi.unit_id, booking_date
  ),
  -- Then find the maximum for each unit
  booked_units AS (
    SELECT 
      unit_id,
      MAX(qty_booked) AS max_booked
    FROM daily_bookings
    GROUP BY unit_id
  )
  SELECT 
    ur.uid AS unit_id,
    u.name AS unit_name,
    ur.requested::integer AS requested_qty,
    COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available)::integer AS available_qty,
    ur.requested <= COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available) AS available
  FROM unit_requests ur
  JOIN units u ON u.id = ur.uid
  LEFT JOIN booked_units bu ON bu.unit_id = ur.uid;
END;
$$;

COMMENT ON FUNCTION check_unit_availability IS 'Check if requested units are available across a date range';
