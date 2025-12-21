/*
  # Auto-update order status based on task progression

  1. Changes
    - Creates function `auto_update_order_status()` that:
      - Sets order to 'in_progress' when first task goes 'en_route'
      - Sets order to 'completed' when all tasks are 'completed'
    - Adds trigger on task_status table to call function on status updates
    - Checks all tasks for an order before making status changes

  2. Logic
    - When ANY task changes to 'en_route' and order is 'confirmed' → order becomes 'in_progress'
    - When ALL tasks are 'completed' and order is NOT 'completed' → order becomes 'completed'
    - Only updates order status if conditions are met

  3. Security
    - Function runs with SECURITY DEFINER to ensure consistent behavior
    - Only updates orders table, doesn't modify task_status
*/

-- Function to auto-update order status based on task progression
CREATE OR REPLACE FUNCTION auto_update_order_status()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_status TEXT;
  v_all_completed BOOLEAN;
  v_task_count INT;
  v_completed_count INT;
BEGIN
  -- Get current order status
  SELECT status INTO v_order_status
  FROM orders
  WHERE id = NEW.order_id;

  -- Check if all tasks for this order are completed
  SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'completed') as completed
  INTO v_task_count, v_completed_count
  FROM task_status
  WHERE order_id = NEW.order_id;

  v_all_completed := (v_task_count > 0 AND v_task_count = v_completed_count);

  -- RULE 1: Set order to 'in_progress' when first task goes 'en_route'
  IF NEW.status = 'en_route' AND v_order_status = 'confirmed' THEN
    UPDATE orders
    SET status = 'in_progress'
    WHERE id = NEW.order_id;
  END IF;

  -- RULE 2: Set order to 'completed' when all tasks are completed
  IF v_all_completed AND v_order_status IN ('confirmed', 'in_progress') THEN
    UPDATE orders
    SET status = 'completed'
    WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on task_status table
DROP TRIGGER IF EXISTS trigger_auto_update_order_status ON task_status;

CREATE TRIGGER trigger_auto_update_order_status
  AFTER INSERT OR UPDATE OF status ON task_status
  FOR EACH ROW
  EXECUTE FUNCTION auto_update_order_status();
