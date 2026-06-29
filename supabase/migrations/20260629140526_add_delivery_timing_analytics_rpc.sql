-- Delivery timing analytics RPC
-- Computes per-task timing metrics from task_status records.
-- Only includes completed tasks where the relevant timestamps are non-null.
CREATE OR REPLACE FUNCTION get_delivery_timing_analytics(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  -- Only admins/master/crew may call this
  IF get_user_role(auth.uid()) NOT IN ('admin', 'master', 'crew') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  WITH filtered AS (
    SELECT
      ts.task_type,
      ts.en_route_time,
      ts.arrived_time,
      ts.completed_time,
      ts.calculated_eta_minutes,
      ts.task_date
    FROM task_status ts
    WHERE ts.status = 'completed'
      AND (p_start_date IS NULL OR ts.task_date >= p_start_date)
      AND (p_end_date IS NULL OR ts.task_date <= p_end_date)
  ),
  travel AS (
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (arrived_time - en_route_time)) / 60.0)::numeric, 1) AS avg_travel_minutes,
      COUNT(*) AS travel_sample
    FROM filtered
    WHERE en_route_time IS NOT NULL AND arrived_time IS NOT NULL
  ),
  dropoff_setup AS (
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_time - arrived_time)) / 60.0)::numeric, 1) AS avg_delivery_setup_minutes,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_time - en_route_time)) / 60.0)::numeric, 1) AS avg_total_dropoff_minutes,
      COUNT(*) AS dropoff_sample
    FROM filtered
    WHERE task_type = 'drop-off'
      AND arrived_time IS NOT NULL AND completed_time IS NOT NULL
  ),
  pickup_service AS (
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_time - arrived_time)) / 60.0)::numeric, 1) AS avg_pickup_service_minutes,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_time - en_route_time)) / 60.0)::numeric, 1) AS avg_total_pickup_minutes,
      COUNT(*) AS pickup_sample
    FROM filtered
    WHERE task_type = 'pick-up'
      AND arrived_time IS NOT NULL AND completed_time IS NOT NULL
  ),
  eta_acc AS (
    SELECT
      ROUND(AVG(
        EXTRACT(EPOCH FROM (arrived_time - en_route_time)) / 60.0
        - calculated_eta_minutes::numeric
      )::numeric, 1) AS avg_eta_accuracy_minutes,
      COUNT(*) AS eta_sample
    FROM filtered
    WHERE en_route_time IS NOT NULL
      AND arrived_time IS NOT NULL
      AND calculated_eta_minutes IS NOT NULL
  ),
  counts AS (
    SELECT
      COUNT(*) FILTER (WHERE task_type = 'drop-off') AS total_dropoff,
      COUNT(*) FILTER (WHERE task_type = 'pick-up') AS total_pickup,
      COUNT(*) FILTER (WHERE task_type = 'drop-off' AND arrived_time IS NOT NULL AND completed_time IS NOT NULL) AS dropoff_with_all_timestamps,
      COUNT(*) FILTER (WHERE task_type = 'pick-up' AND arrived_time IS NOT NULL AND completed_time IS NOT NULL) AS pickup_with_all_timestamps
    FROM filtered
  )
  SELECT json_build_object(
    'avg_travel_minutes', t.avg_travel_minutes,
    'avg_delivery_setup_minutes', ds.avg_delivery_setup_minutes,
    'avg_pickup_service_minutes', ps.avg_pickup_service_minutes,
    'avg_total_dropoff_minutes', ds.avg_total_dropoff_minutes,
    'avg_total_pickup_minutes', ps.avg_total_pickup_minutes,
    'avg_eta_accuracy_minutes', ea.avg_eta_accuracy_minutes,
    'task_counts', json_build_object(
      'travel_sample', t.travel_sample,
      'dropoff_with_all_timestamps', c.dropoff_with_all_timestamps,
      'pickup_with_all_timestamps', c.pickup_with_all_timestamps,
      'eta_sample', ea.eta_sample,
      'total_dropoff', c.total_dropoff,
      'total_pickup', c.total_pickup
    )
  ) INTO v_result
  FROM travel t, dropoff_setup ds, pickup_service ps, eta_acc ea, counts c;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_delivery_timing_analytics(date, date) TO authenticated;
