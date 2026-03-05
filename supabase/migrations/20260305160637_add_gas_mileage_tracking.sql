/*
  # Add Gas Mileage Tracking System

  1. New Tables
    - `daily_mileage_logs`
      - `id` (uuid, primary key)
      - `date` (date) - The work date
      - `user_id` (uuid) - Crew member
      - `start_mileage` (numeric) - Odometer reading at start
      - `end_mileage` (numeric) - Odometer reading at end
      - `start_time` (timestamptz) - When they started
      - `end_time` (timestamptz) - When they finished
      - `notes` (text, optional) - Any notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `daily_mileage_logs` table
    - Add policy for crew to manage their own logs
    - Add policy for admins to view all logs

  3. Indexes
    - Index on (date, user_id) for quick lookups
*/

-- Create table
CREATE TABLE IF NOT EXISTS daily_mileage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_mileage numeric(10, 1),
  end_mileage numeric(10, 1),
  start_time timestamptz,
  end_time timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(date, user_id)
);

-- Enable RLS
ALTER TABLE daily_mileage_logs ENABLE ROW LEVEL SECURITY;

-- Crew can manage their own logs
CREATE POLICY "Crew can insert own mileage logs"
  ON daily_mileage_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Crew can view own mileage logs"
  ON daily_mileage_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Crew can update own mileage logs"
  ON daily_mileage_logs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all logs
CREATE POLICY "Admins can view all mileage logs"
  ON daily_mileage_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Admins can update all logs
CREATE POLICY "Admins can update all mileage logs"
  ON daily_mileage_logs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_daily_mileage_logs_date_user
  ON daily_mileage_logs(date, user_id);

CREATE INDEX IF NOT EXISTS idx_daily_mileage_logs_user_date
  ON daily_mileage_logs(user_id, date DESC);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_daily_mileage_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_daily_mileage_logs_updated_at
  BEFORE UPDATE ON daily_mileage_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_mileage_logs_updated_at();
