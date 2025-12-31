/*
  # Create Notification Failure Tracking System

  1. New Tables
    - `notification_failures` - Tracks all failed notification attempts
      - `id` (uuid, primary key)
      - `notification_type` (text) - 'email' or 'sms'
      - `intended_recipient` (text) - email address or phone number
      - `subject` (text) - email subject or SMS preview
      - `error_message` (text) - failure reason
      - `context` (jsonb) - order_id, customer info, etc.
      - `fallback_sent` (boolean) - whether fallback notification was sent
      - `fallback_type` (text) - type of fallback used
      - `retry_count` (integer) - number of retry attempts
      - `resolved_at` (timestamptz) - when issue was resolved
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `notification_system_status` - Tracks overall system health
      - `id` (uuid, primary key)
      - `system_type` (text) - 'email' or 'sms'
      - `is_operational` (boolean)
      - `last_success_at` (timestamptz)
      - `last_failure_at` (timestamptz)
      - `failure_count` (integer)
      - `error_details` (jsonb)
      - `admin_notified_at` (timestamptz) - last time admin was alerted
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Only admins can view/manage notification failures
    - System can insert failures

  3. Functions
    - `record_notification_failure()` - Records a failed notification
    - `update_system_status()` - Updates system health status
    - `get_unresolved_failures()` - Gets active failures for admin dashboard
*/

-- Create notification_failures table
CREATE TABLE IF NOT EXISTS notification_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type text NOT NULL CHECK (notification_type IN ('email', 'sms')),
  intended_recipient text NOT NULL,
  subject text,
  message_preview text,
  error_message text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb,
  fallback_sent boolean DEFAULT false,
  fallback_type text,
  retry_count integer DEFAULT 0,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_failures_type ON notification_failures(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_failures_resolved ON notification_failures(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_failures_created ON notification_failures(created_at DESC);

-- Create notification_system_status table
CREATE TABLE IF NOT EXISTS notification_system_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_type text UNIQUE NOT NULL CHECK (system_type IN ('email', 'sms')),
  is_operational boolean DEFAULT true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer DEFAULT 0,
  total_failures_24h integer DEFAULT 0,
  error_details jsonb DEFAULT '{}'::jsonb,
  admin_notified_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_status_type ON notification_system_status(system_type);

-- Initialize system status records
INSERT INTO notification_system_status (system_type, is_operational)
VALUES ('email', true), ('sms', true)
ON CONFLICT (system_type) DO NOTHING;

-- Enable RLS
ALTER TABLE notification_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_system_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notification_failures
DROP POLICY IF EXISTS "Admins can view notification failures" ON notification_failures;
CREATE POLICY "Admins can view notification failures"
  ON notification_failures FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

DROP POLICY IF EXISTS "Admins can update notification failures" ON notification_failures;
CREATE POLICY "Admins can update notification failures"
  ON notification_failures FOR UPDATE
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

DROP POLICY IF EXISTS "Service role can insert failures" ON notification_failures;
CREATE POLICY "Service role can insert failures"
  ON notification_failures FOR INSERT
  WITH CHECK (true);

-- RLS Policies for notification_system_status
DROP POLICY IF EXISTS "Admins can view system status" ON notification_system_status;
CREATE POLICY "Admins can view system status"
  ON notification_system_status FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

DROP POLICY IF EXISTS "Service role can update system status" ON notification_system_status;
CREATE POLICY "Service role can update system status"
  ON notification_system_status FOR UPDATE
  WITH CHECK (true);

-- Function to record notification failure
CREATE OR REPLACE FUNCTION record_notification_failure(
  p_type text,
  p_recipient text,
  p_subject text,
  p_message_preview text,
  p_error text,
  p_context jsonb DEFAULT '{}'::jsonb
) RETURNS uuid AS $$
DECLARE
  v_failure_id uuid;
  v_status record;
BEGIN
  -- Insert failure record
  INSERT INTO notification_failures (
    notification_type,
    intended_recipient,
    subject,
    message_preview,
    error_message,
    context
  ) VALUES (
    p_type,
    p_recipient,
    p_subject,
    p_message_preview,
    p_error,
    p_context
  ) RETURNING id INTO v_failure_id;

  -- Update system status
  UPDATE notification_system_status
  SET
    last_failure_at = now(),
    consecutive_failures = consecutive_failures + 1,
    total_failures_24h = (
      SELECT COUNT(*)
      FROM notification_failures
      WHERE notification_type = p_type
      AND created_at > now() - interval '24 hours'
    ),
    is_operational = CASE
      WHEN consecutive_failures >= 3 THEN false
      ELSE is_operational
    END,
    error_details = jsonb_build_object(
      'last_error', p_error,
      'last_recipient', p_recipient,
      'timestamp', now()
    ),
    updated_at = now()
  WHERE system_type = p_type
  RETURNING * INTO v_status;

  RETURN v_failure_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to record notification success
CREATE OR REPLACE FUNCTION record_notification_success(p_type text) RETURNS void AS $$
BEGIN
  UPDATE notification_system_status
  SET
    last_success_at = now(),
    consecutive_failures = 0,
    is_operational = true,
    updated_at = now()
  WHERE system_type = p_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get unresolved failures count
CREATE OR REPLACE FUNCTION get_unresolved_failures_count() RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'email', (SELECT COUNT(*) FROM notification_failures WHERE notification_type = 'email' AND resolved_at IS NULL),
    'sms', (SELECT COUNT(*) FROM notification_failures WHERE notification_type = 'sms' AND resolved_at IS NULL),
    'total', (SELECT COUNT(*) FROM notification_failures WHERE resolved_at IS NULL)
  ) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
