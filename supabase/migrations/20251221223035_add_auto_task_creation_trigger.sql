/*
  # Auto-create task_status records when order confirmed

  1. Changes
    - Creates function `auto_create_task_status()` that generates dropoff and pickup tasks
    - Adds trigger on orders table to call function when status changes to 'confirmed'
    - Tasks are created with status='pending' and task_date from order's event_date
    - Only creates tasks if they don't already exist for that order

  2. Security
    - Function runs with SECURITY DEFINER to ensure consistent behavior
    - Only creates tasks for valid confirmed orders
*/

-- Function to auto-create task_status records when order is confirmed
CREATE OR REPLACE FUNCTION auto_create_task_status()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only proceed if status changed to 'confirmed'
  IF NEW.status = 'confirmed' AND (OLD.status IS NULL OR OLD.status != 'confirmed') THEN
    
    -- Create drop-off task if it doesn't exist
    INSERT INTO task_status (
      order_id,
      task_type,
      task_date,
      status,
      sort_order
    )
    SELECT
      NEW.id,
      'drop-off',
      NEW.event_date,
      'pending',
      0
    WHERE NOT EXISTS (
      SELECT 1 FROM task_status
      WHERE order_id = NEW.id AND task_type = 'drop-off'
    );

    -- Create pick-up task if it doesn't exist
    INSERT INTO task_status (
      order_id,
      task_type,
      task_date,
      status,
      sort_order
    )
    SELECT
      NEW.id,
      'pick-up',
      NEW.event_end_date,
      'pending',
      1
    WHERE NOT EXISTS (
      SELECT 1 FROM task_status
      WHERE order_id = NEW.id AND task_type = 'pick-up'
    );

  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on orders table
DROP TRIGGER IF EXISTS trigger_auto_create_task_status ON orders;

CREATE TRIGGER trigger_auto_create_task_status
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_task_status();
