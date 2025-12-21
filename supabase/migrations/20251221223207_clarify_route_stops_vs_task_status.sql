/*
  # Clarify route_stops vs task_status table separation

  1. Purpose Clarification
    - `task_status` = PRIMARY table for day-of task execution
      - Used by crew to track real-time task progress
      - Contains status, timestamps, SMS flags, images
      - Source of truth for task completion
    
    - `route_stops` = RESERVED for future route optimization features
      - Originally created but minimally used
      - Can be used for multi-stop route planning algorithms
      - Not required for basic task execution
      - crew_location_history.stop_id is nullable and optional

  2. Changes
    - Add comments to route_stops table documenting its purpose
    - Make stop_id in crew_location_history explicitly nullable
    - Add index on task_status for calendar queries

  3. Migration Strategy
    - Existing route_stops records remain (no data loss)
    - Frontend code will stop creating new route_stops
    - task_status is the active execution table
    - route_stops can be populated later if route optimization is implemented

  4. Notes
    - No breaking changes to existing data
    - crew_location_history works with or without stop_id
    - Future: route optimization algorithms can populate route_stops as needed
*/

-- Add documentation comment to route_stops
COMMENT ON TABLE route_stops IS 'Reserved for advanced route optimization features. For basic task execution, use task_status table instead. This table can be used for multi-stop routing algorithms, planned vs actual route analysis, and logistics optimization.';

-- Ensure stop_id is nullable in crew_location_history (should already be, but make explicit)
ALTER TABLE crew_location_history 
  ALTER COLUMN stop_id DROP NOT NULL;

-- Add helpful index for calendar queries on task_status
CREATE INDEX IF NOT EXISTS idx_task_status_date_type 
  ON task_status(task_date, task_type, status);

-- Add index for order lookup
CREATE INDEX IF NOT EXISTS idx_task_status_order_id 
  ON task_status(order_id);

-- Add comment to task_status clarifying it's the primary execution table
COMMENT ON TABLE task_status IS 'Primary table for day-of task execution. Tracks real-time progress of delivery and pickup tasks. Used by crew interface and admin calendar. Auto-created when order status changes to confirmed.';
