/*
  # Fix auto_update_order_status trigger to use correct column names

  ## Problem
  The trigger was setting orders.status = 'setup_in_progress' but that value
  only exists in orders.workflow_status, not orders.status (which uses
  'in_progress'). This caused a CHECK constraint violation (400 Bad Request)
  every time a task was marked En Route.

  ## Fix
  Update both the correct columns:
  - orders.status → 'in_progress' (when first task goes en_route)
  - orders.workflow_status → 'on_the_way' (when first task goes en_route)
  - orders.status → 'completed' (when all tasks completed)
  - orders.workflow_status → 'completed' (when all tasks completed)
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
    SET status = 'in_progress',
        workflow_status = 'on_the_way'
    WHERE id = NEW.order_id;
  END IF;

  IF v_all_completed AND v_order_status IN ('confirmed', 'in_progress') THEN
    UPDATE orders
    SET status = 'completed',
        workflow_status = 'completed'
    WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;
