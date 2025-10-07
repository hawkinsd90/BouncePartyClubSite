/*
  # Update Availability Check Function for Date Ranges

  1. Changes
    - Drop old `check_unit_availability` function
    - Create new version that accepts start and end dates
    - Check availability across entire date range
    - Return format that includes unit name for better error messages

  2. Purpose
    - Support multi-day rentals
    - Prevent conflicts across date ranges
    - Better error messages with unit names
*/

DROP FUNCTION IF EXISTS check_unit_availability(uuid[], date);

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
  booked_units AS (
    SELECT 
      oi.unit_id,
      MAX(SUM(oi.qty)) AS max_booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status IN ('pending_review', 'confirmed', 'in_progress')
      AND oi.unit_id = ANY(p_unit_ids)
      AND (
        -- Check for any overlap with the requested date range
        (o.start_date <= p_end_date AND o.end_date >= p_start_date)
        OR
        (o.event_date >= p_start_date AND o.event_date <= p_end_date)
      )
    GROUP BY oi.unit_id, o.event_date
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
