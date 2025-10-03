/*
  # Add Availability Check Function

  1. New Function
    - `check_unit_availability` - Checks if requested units are available on a date
    - Takes unit_ids array and event_date
    - Returns array of unavailable unit IDs
    
  2. Purpose
    - Prevent double-booking of units
    - Check against confirmed and pending_review orders
*/

CREATE OR REPLACE FUNCTION check_unit_availability(
  p_unit_ids uuid[],
  p_event_date date
)
RETURNS TABLE(unit_id uuid, requested_qty integer, available_qty integer, is_available boolean)
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
      SUM(oi.qty) AS booked
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.event_date = p_event_date
      AND o.status IN ('pending_review', 'confirmed', 'in_progress')
      AND oi.unit_id = ANY(p_unit_ids)
    GROUP BY oi.unit_id
  )
  SELECT 
    ur.uid AS unit_id,
    ur.requested::integer AS requested_qty,
    COALESCE(u.quantity_available - COALESCE(bu.booked, 0), u.quantity_available)::integer AS available_qty,
    ur.requested <= COALESCE(u.quantity_available - COALESCE(bu.booked, 0), u.quantity_available) AS is_available
  FROM unit_requests ur
  JOIN units u ON u.id = ur.uid
  LEFT JOIN booked_units bu ON bu.unit_id = ur.uid;
END;
$$;

COMMENT ON FUNCTION check_unit_availability IS 'Check if requested units are available on a specific date';
