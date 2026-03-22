/*
  # Fix auto_update_order_status to use setup_in_progress

  ## Problem
  The trigger was setting orders.status = 'in_progress' when a task goes en_route,
  but validate_order_status_transition only allows confirmed → setup_in_progress.
  Also the workflow_status column uses a different set of values.

  ## Fix
  - confirmed → setup_in_progress when first task goes en_route
  - Only auto-complete when order is in on_the_way_back state (valid transition)
  - Remove workflow_status updates (handled separately by workflow system)
*/

CREATE OR REPLACE FUNCTION auto_update_order_status()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_order_status TEXT;
  v_all_completed BOOLEAN;
  v_task_count INT;
  v_completed_count INT;
BEGIN
  SELECT status INTO v_order_status
  FROM orders
  WHERE id = NEW.order_id;

  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'completed') as completed
  INTO v_task_count, v_completed_count
  FROM task_status
  WHERE order_id = NEW.order_id;

  v_all_completed := (v_task_count > 0 AND v_task_count = v_completed_count);

  IF NEW.status = 'en_route' AND v_order_status = 'confirmed' THEN
    UPDATE orders
    SET status = 'setup_in_progress'
    WHERE id = NEW.order_id;
  END IF;

  IF v_all_completed AND v_order_status = 'on_the_way_back' THEN
    UPDATE orders
    SET status = 'completed'
    WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;
