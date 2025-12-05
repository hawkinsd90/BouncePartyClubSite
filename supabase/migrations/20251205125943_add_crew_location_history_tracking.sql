/*
  # Add Crew Location History Tracking

  ## Overview
  Creates a comprehensive location tracking system for crew movements and ETA calculations.
  This enables logistics optimization, route analysis, and performance metrics.

  ## New Tables
  
  1. **crew_location_history**
     - `id` (uuid, primary key)
     - `order_id` (uuid, foreign key to orders)
     - `stop_id` (uuid, foreign key to route_stops)
     - `latitude` (numeric) - Crew GPS latitude
     - `longitude` (numeric) - Crew GPS longitude
     - `accuracy` (numeric) - GPS accuracy in meters
     - `speed` (numeric) - Speed in meters per second (optional)
     - `heading` (numeric) - Direction of travel in degrees (optional)
     - `checkpoint` (text) - Current checkpoint status
     - `created_at` (timestamptz) - Timestamp of location capture
  
  ## Table Modifications
  
  1. **route_stops**
     - Add `calculated_eta_minutes` (integer) - Calculated ETA in minutes from Distance Matrix API
     - Add `calculated_eta_distance_miles` (numeric) - Distance to destination in miles
     - Add `eta_calculated_at` (timestamptz) - When ETA was last calculated
     - Add `eta_calculation_error` (text) - Any error messages from ETA calculation

  ## Security
  - RLS enabled on crew_location_history
  - Admin-only access for reading location history
  - Anon users can insert location data (for crew app)

  ## Use Cases
  - Real-time ETA calculations using Google Maps Distance Matrix API
  - Route optimization and performance analysis
  - Driver behavior analytics (speed, route efficiency)
  - Historical tracking for dispute resolution
  - Automatic ETA updates as crew moves closer to destination
*/

-- Create crew location history table
CREATE TABLE IF NOT EXISTS crew_location_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  stop_id uuid REFERENCES route_stops(id) ON DELETE CASCADE,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  accuracy numeric,
  speed numeric,
  heading numeric,
  checkpoint text,
  created_at timestamptz DEFAULT now()
);

-- Add ETA calculation metadata to route_stops
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_stops' AND column_name = 'calculated_eta_minutes'
  ) THEN
    ALTER TABLE route_stops ADD COLUMN calculated_eta_minutes integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_stops' AND column_name = 'calculated_eta_distance_miles'
  ) THEN
    ALTER TABLE route_stops ADD COLUMN calculated_eta_distance_miles numeric(10,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_stops' AND column_name = 'eta_calculated_at'
  ) THEN
    ALTER TABLE route_stops ADD COLUMN eta_calculated_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'route_stops' AND column_name = 'eta_calculation_error'
  ) THEN
    ALTER TABLE route_stops ADD COLUMN eta_calculation_error text;
  END IF;
END $$;

-- Enable RLS on crew_location_history
ALTER TABLE crew_location_history ENABLE ROW LEVEL SECURITY;

-- Allow authenticated admins to view all location history
CREATE POLICY "Admins can view all location history"
  ON crew_location_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Allow anon users to insert location data (for crew app/devices)
CREATE POLICY "Crew can log location"
  ON crew_location_history FOR INSERT
  TO anon
  WITH CHECK (true);

-- Create index for efficient location history queries
CREATE INDEX IF NOT EXISTS idx_crew_location_order_id 
  ON crew_location_history(order_id);

CREATE INDEX IF NOT EXISTS idx_crew_location_stop_id 
  ON crew_location_history(stop_id);

CREATE INDEX IF NOT EXISTS idx_crew_location_created_at 
  ON crew_location_history(created_at DESC);

-- Create index for ETA queries on route_stops
CREATE INDEX IF NOT EXISTS idx_route_stops_eta_calculated_at 
  ON route_stops(eta_calculated_at DESC);
