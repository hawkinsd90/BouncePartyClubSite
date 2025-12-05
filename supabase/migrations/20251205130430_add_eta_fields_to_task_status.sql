/*
  # Add ETA Calculation Fields to Task Status

  ## Overview
  Adds GPS location and ETA calculation metadata to the task_status table for real-time logistics tracking.

  ## New Columns Added
  
  1. **calculated_eta_minutes** (integer)
     - ETA in minutes calculated from Google Maps Distance Matrix API
     - Updated when task is marked as "en route"
  
  2. **gps_lat** (numeric)
     - GPS latitude of crew/admin when marking task as "en route"
     - Used for ETA calculation and location tracking
  
  3. **gps_lng** (numeric)
     - GPS longitude of crew/admin when marking task as "en route"
     - Used for ETA calculation and location tracking
  
  4. **eta_calculation_error** (text)
     - Stores any error messages from ETA calculation API
     - Used for troubleshooting and fallback handling

  ## Use Cases
  - Real-time ETA calculations using actual GPS coordinates
  - Location tracking for route optimization
  - Error logging for API troubleshooting
  - Historical analysis of delivery times vs estimates
*/

-- Add ETA calculation fields to task_status table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_status' AND column_name = 'calculated_eta_minutes'
  ) THEN
    ALTER TABLE task_status ADD COLUMN calculated_eta_minutes integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_status' AND column_name = 'gps_lat'
  ) THEN
    ALTER TABLE task_status ADD COLUMN gps_lat numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_status' AND column_name = 'gps_lng'
  ) THEN
    ALTER TABLE task_status ADD COLUMN gps_lng numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_status' AND column_name = 'eta_calculation_error'
  ) THEN
    ALTER TABLE task_status ADD COLUMN eta_calculation_error text;
  END IF;
END $$;
