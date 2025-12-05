/*
  # Task Management System for Deliveries and Pickups

  1. New Tables
    - `task_status`
      - Tracks the current status of each delivery/pickup task
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `task_type` (text: 'drop-off' or 'pick-up')
      - `task_date` (date)
      - `status` (text: 'pending', 'en_route', 'arrived', 'completed')
      - `en_route_time` (timestamptz)
      - `arrived_time` (timestamptz)
      - `completed_time` (timestamptz)
      - `eta_sent` (boolean)
      - `waiver_reminder_sent` (boolean)
      - `payment_reminder_sent` (boolean)
      - `sort_order` (integer) - for manual ordering
      - `delivery_images` (jsonb) - array of image URLs
      - `notes` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `task_status` table
    - Add policies for authenticated admin users
*/

CREATE TABLE IF NOT EXISTS task_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('drop-off', 'pick-up')),
  task_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'en_route', 'arrived', 'completed')),
  en_route_time timestamptz,
  arrived_time timestamptz,
  completed_time timestamptz,
  eta_sent boolean DEFAULT false,
  waiver_reminder_sent boolean DEFAULT false,
  payment_reminder_sent boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  delivery_images jsonb DEFAULT '[]'::jsonb,
  damage_images jsonb DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE task_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all task statuses"
  ON task_status
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert task statuses"
  ON task_status
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update task statuses"
  ON task_status
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete task statuses"
  ON task_status
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_task_status_order_id ON task_status(order_id);
CREATE INDEX IF NOT EXISTS idx_task_status_task_date ON task_status(task_date);
CREATE INDEX IF NOT EXISTS idx_task_status_sort_order ON task_status(task_date, sort_order);
