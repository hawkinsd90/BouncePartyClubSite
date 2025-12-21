/*
  # Add Email Templates System

  1. New Tables
    - `email_templates`
      - `id` (uuid, primary key)
      - `template_name` (text, unique) - Identifier for the template
      - `subject` (text) - Email subject line
      - `description` (text) - What this template is used for
      - `header_title` (text) - Main heading in email
      - `content_template` (text) - HTML content template with variables
      - `theme` (text) - Color theme (primary, success, warning, error)
      - `category` (text) - booking, order, notification, etc.
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Seed Data
    - Creates default email templates for all major email types
    - Supports variable substitution like {customer_name}, {order_id}, etc.

  3. Security
    - RLS enabled on email_templates
    - Admin and master can view and edit templates
    - Regular users cannot access

  4. Purpose
    - Allows editing email content without changing code
    - Centralizes all message templates in database
    - Provides audit trail for template changes
*/

-- Create email templates table
CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name text UNIQUE NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  header_title text NOT NULL,
  content_template text NOT NULL,
  theme text DEFAULT 'primary' CHECK (theme IN ('primary', 'success', 'warning', 'error')),
  category text NOT NULL CHECK (category IN ('booking', 'order', 'notification', 'admin', 'system')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

-- Admin and master can view and edit all templates
CREATE POLICY "Admins can view all email templates"
  ON email_templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can update email templates"
  ON email_templates FOR UPDATE
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
CREATE INDEX IF NOT EXISTS idx_email_templates_category 
  ON email_templates(category);

CREATE INDEX IF NOT EXISTS idx_email_templates_name 
  ON email_templates(template_name);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_email_template_timestamp()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Trigger to auto-update timestamp
DROP TRIGGER IF EXISTS trigger_update_email_template_timestamp ON email_templates;

CREATE TRIGGER trigger_update_email_template_timestamp
  BEFORE UPDATE ON email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_email_template_timestamp();

-- Seed default email templates
INSERT INTO email_templates (template_name, subject, description, header_title, content_template, theme, category) VALUES

('booking_confirmation_customer', 
 'Booking Confirmed - {order_id}',
 'Sent to customer when their booking is approved',
 'Booking Confirmed!',
 '<p>Hi {customer_first_name},</p>
<p>Great news! Your booking has been confirmed and we are getting everything ready for your event.</p>
<p><strong>Event Date:</strong> {event_date}<br>
<strong>Order ID:</strong> {order_id}</p>
<p>We will send you a text message the day before to confirm delivery details.</p>
<p>If you have any questions, please don''t hesitate to reach out!</p>',
 'success',
 'booking'),

('booking_confirmation_admin',
 'New Booking Confirmed - {order_id}',
 'Sent to admin when a booking is approved',
 'New Booking Confirmed',
 '<p>A new booking has been confirmed:</p>
<p><strong>Customer:</strong> {customer_full_name}<br>
<strong>Event Date:</strong> {event_date}<br>
<strong>Order ID:</strong> {order_id}<br>
<strong>Total:</strong> {total_amount}</p>
<p>Address: {event_address}</p>',
 'primary',
 'admin'),

('order_rejection',
 'Booking Update - {order_id}',
 'Sent to customer when their booking is rejected',
 'Booking Update',
 '<p>Hi {customer_first_name},</p>
<p>Thank you for your interest in Bounce Party Club. Unfortunately, we are unable to accept your booking at this time.</p>
<p><strong>Reason:</strong> {rejection_reason}</p>
<p>If you have any questions or would like to discuss alternative options, please contact us.</p>',
 'warning',
 'booking'),

('payment_receipt',
 'Payment Receipt - {order_id}',
 'Sent to customer after successful payment',
 'Payment Received',
 '<p>Hi {customer_first_name},</p>
<p>Thank you for your payment! We have successfully processed your {payment_type} payment.</p>
<p><strong>Amount Paid:</strong> {payment_amount}<br>
<strong>Order ID:</strong> {order_id}<br>
<strong>Remaining Balance:</strong> {balance_amount}</p>
<p>You can view your receipt and order details anytime in your customer portal.</p>',
 'success',
 'order'),

('error_notification',
 'System Error Notification',
 'Sent to admin when system errors occur',
 'System Error Alert',
 '<p>An error has occurred in the Bounce Party Club system:</p>
<p><strong>Error:</strong> {error_message}<br>
<strong>Context:</strong> {error_context}<br>
<strong>Time:</strong> {timestamp}</p>
<p>Please investigate this issue as soon as possible.</p>',
 'error',
 'system')

ON CONFLICT (template_name) DO NOTHING;
