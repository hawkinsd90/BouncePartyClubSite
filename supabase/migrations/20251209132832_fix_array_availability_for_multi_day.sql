/*
  # Fix Array-Based Availability Check for Multi-Day Rentals

  1. Changes
    - Update the array-based check_unit_availability function
    - Use event_date and event_end_date for proper multi-day rental handling
    - Match the logic used in the single-unit version

  2. Purpose
    - Ensure multi-day rentals are properly checked for conflicts
    - Use event_end_date instead of legacy start_date/end_date fields
*/

-- Drop the array version specifically
DROP FUNCTION IF EXISTS check_unit_availability(uuid[], date, date) CASCADE;

-- Recreate with updated logic
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
SECURITY DEFINER
SET search_path = public
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
  -- Aggregate bookings per unit and date
  daily_bookings AS (
    SELECT 
      oi.unit_id AS db_unit_id,
      o.event_date as booking_date,
      SUM(oi.qty) AS qty_booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status IN ('pending_review', 'confirmed', 'in_progress')
      AND oi.unit_id = ANY(p_unit_ids)
      -- Check for date range overlap using event_date and event_end_date
      AND o.event_date <= p_end_date 
      AND COALESCE(o.event_end_date, o.event_date) >= p_start_date
    GROUP BY oi.unit_id, booking_date
  ),
  -- Find the maximum bookings for each unit
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

COMMENT ON FUNCTION check_unit_availability(uuid[], date, date) IS 'Check if requested units are available across a date range, properly handling multi-day rentals using event_date and event_end_date';
