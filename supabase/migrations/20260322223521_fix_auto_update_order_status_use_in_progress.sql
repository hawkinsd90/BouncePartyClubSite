/*
  # Fix auto_update_order_status: write in_progress instead of setup_in_progress

  ## Problem
  The live orders_status_check constraint allows:
    draft, pending_review, awaiting_customer_approval, confirmed,
    in_progress, completed, cancelled, void

  setup_in_progress is NOT in orders_status_check. It lives only in
  orders_workflow_status_check (a separate column).

  The trigger was writing orders.status = 'setup_in_progress' on En Route,
  which violates the check constraint (code 23514) and rolls back the
  entire task_status update.

  ## Fix
  Change the En Route branch to write orders.status = 'in_progress', which:
  - IS in the orders_status_check constraint
  - IS in the confirmed → in_progress allowed transition in validate_order_status_transition
  - Keeps setup_in_progress exclusively in workflow_status where it belongs

  ## No other changes
  - orders_status_check is not modified (in_progress is already there)
  - validate_order_status_transition is not modified (confirmed → in_progress already allowed)
  - workflow_status column and its constraint are not touched
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
    SET status = 'in_progress'
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
