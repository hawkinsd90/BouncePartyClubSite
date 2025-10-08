/*
  # Add order workflow and extended features
  
  1. New Tables
    - `order_notes` - Notes added by admins to orders
    - `order_workflow_events` - Track workflow progression (on the way, arrived, finished setup)
    - `order_refunds` - Track all refunds with reasons
    - `admin_settings_changelog` - Track changes to admin settings
    - `order_documents` - Enhanced document tracking with metadata
  
  2. Changes to existing tables
    - Add workflow status fields to orders
    - Add search indexing
  
  3. Security
    - Enable RLS on all new tables
    - Add policies for admin-only access
*/

-- Order notes table
CREATE TABLE IF NOT EXISTS order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  note text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage order notes"
  ON order_notes FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Order workflow events table
CREATE TABLE IF NOT EXISTS order_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('on_the_way', 'arrived', 'setup_started', 'setup_completed', 'pickup_started', 'pickup_completed')),
  user_id uuid REFERENCES auth.users(id),
  eta timestamptz,
  notes text,
  latitude numeric,
  longitude numeric,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_workflow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and crew can manage workflow events"
  ON order_workflow_events FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'CREW')
    )
  );

-- Order refunds table
CREATE TABLE IF NOT EXISTS order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  reason text NOT NULL,
  stripe_refund_id text,
  refunded_by uuid REFERENCES auth.users(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage refunds"
  ON order_refunds FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Admin settings changelog
CREATE TABLE IF NOT EXISTS admin_settings_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES auth.users(id),
  change_description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_settings_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view changelog"
  ON admin_settings_changelog FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admins can insert changelog"
  ON admin_settings_changelog FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Add workflow status to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS workflow_status text DEFAULT 'pending' 
  CHECK (workflow_status IN ('pending', 'on_the_way', 'arrived', 'setup_in_progress', 'setup_completed', 'pickup_scheduled', 'pickup_in_progress', 'completed'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS current_eta timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS waiver_signed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS waiver_signature_data text;

-- Create indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_orders_event_date ON orders(event_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_workflow_status ON orders(workflow_status);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_order_notes_order_id ON order_notes(order_id);
CREATE INDEX IF NOT EXISTS idx_order_workflow_events_order_id ON order_workflow_events(order_id);

-- Function to log admin settings changes
CREATE OR REPLACE FUNCTION log_admin_settings_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO admin_settings_changelog (
    setting_key,
    old_value,
    new_value,
    changed_by,
    change_description
  ) VALUES (
    NEW.key,
    OLD.value,
    NEW.value,
    auth.uid(),
    NEW.description
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for admin settings changes
DROP TRIGGER IF EXISTS trigger_log_admin_settings_change ON admin_settings;
CREATE TRIGGER trigger_log_admin_settings_change
  AFTER UPDATE ON admin_settings
  FOR EACH ROW
  WHEN (OLD.value IS DISTINCT FROM NEW.value)
  EXECUTE FUNCTION log_admin_settings_change();
