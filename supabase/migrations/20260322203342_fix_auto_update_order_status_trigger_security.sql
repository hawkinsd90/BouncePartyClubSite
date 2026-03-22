/*
  # Fix auto_update_order_status trigger security context

  ## Problem
  The trigger fires when task_status is updated by an authenticated MASTER/ADMIN user,
  but the trigger runs in the caller's security context. The orders table has no UPDATE
  policy for authenticated users, so the trigger's attempt to update orders.status fails
  with a 400, which rolls back the entire task_status update.

  ## Fix
  Recreate the trigger function as SECURITY DEFINER so it runs as the function owner
  (postgres/service role) and bypasses RLS when auto-progressing order status.
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

  IF v_all_completed AND v_order_status IN ('confirmed', 'in_progress') THEN
    UPDATE orders
    SET status = 'completed'
    WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;
