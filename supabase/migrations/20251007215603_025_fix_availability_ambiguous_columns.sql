/*
  # Fix Availability Check Function - Resolve Ambiguous Column Names

  1. Changes
    - Fix "column reference 'unit_id' is ambiguous" error
    - Use proper table aliases to avoid conflicts with return column names
    - Fully qualify all column references

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
      oi.unit_id AS db_unit_id,
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
      db.db_unit_id AS bu_unit_id,
      MAX(db.qty_booked) AS max_booked
    FROM daily_bookings db
    GROUP BY db.db_unit_id
  )
  SELECT 
    ur.uid,
    u.name,
    ur.requested::integer,
    COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available)::integer,
    ur.requested <= COALESCE(u.quantity_available - COALESCE(bu.max_booked, 0), u.quantity_available)
  FROM unit_requests ur
  JOIN units u ON u.id = ur.uid
  LEFT JOIN booked_units bu ON bu.bu_unit_id = ur.uid;
END;
$$;

COMMENT ON FUNCTION check_unit_availability IS 'Check if requested units are available across a date range';
