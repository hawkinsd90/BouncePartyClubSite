/*
  # Fix auto_update_order_status trigger to use valid order status transitions

  ## Problem
  The trigger was trying to set orders.status = 'in_progress' when a task goes
  en_route, but the validate_order_status_transition trigger only allows
  confirmed → setup_in_progress (not confirmed → in_progress).
  This caused a cascade failure that blocked the task_status PATCH entirely.

  ## Fix
  - When first task goes en_route from a confirmed order: transition to setup_in_progress
  - When all tasks complete: only auto-complete if order is in a near-terminal state
    (pickup_in_progress or on_the_way_back), since the full workflow has many steps.
    Otherwise leave the order status for manual/workflow management.
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

  IF v_all_completed AND v_order_status IN ('pickup_in_progress', 'on_the_way_back') THEN
    UPDATE orders
    SET status = 'completed'
    WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;
