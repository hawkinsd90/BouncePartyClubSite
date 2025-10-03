/*
  # Add SMS Message Templates

  1. New Tables
    - `sms_message_templates`
      - `id` (uuid, primary key)
      - `template_key` (text, unique) - Identifier for the template type
      - `template_name` (text) - Human-readable name
      - `message_template` (text) - The message template with variable placeholders
      - `description` (text) - Description of when this template is used
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on `sms_message_templates` table
    - Add policy for authenticated users to read templates
    - Add policy for authenticated users to update templates
  
  3. Default Templates
    - Order confirmation template
    - Order rejection template
    - Payment reminder template
    - Delivery notification template
  
  4. Available Variables
    - {customer_first_name} - Customer's first name
    - {customer_last_name} - Customer's last name
    - {customer_full_name} - Customer's full name
    - {order_id} - Order ID (short format)
    - {event_date} - Event date
    - {total_amount} - Total order amount
*/

-- Create sms_message_templates table
CREATE TABLE IF NOT EXISTS sms_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text UNIQUE NOT NULL,
  template_name text NOT NULL,
  message_template text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE sms_message_templates ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users (admins)
CREATE POLICY "Authenticated users can view all templates"
  ON sms_message_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update templates"
  ON sms_message_templates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert default templates
INSERT INTO sms_message_templates (template_key, template_name, message_template, description) VALUES
  (
    'order_confirmation',
    'Order Confirmation',
    'Hi {customer_first_name}, thank you for booking with Bounce Party Club! Your order #{order_id} for {event_date} has been received and is pending review. We''ll confirm shortly!',
    'Sent automatically when a customer places an order'
  ),
  (
    'order_approved',
    'Order Approved',
    'Great news {customer_first_name}! Your booking for {event_date} has been approved. Order #{order_id} is confirmed. Total: {total_amount}. See you soon!',
    'Sent when admin approves an order'
  ),
  (
    'order_rejected',
    'Order Rejected',
    'Hi {customer_first_name}, unfortunately we cannot accommodate your booking for {event_date}. Reason: {rejection_reason}. Please contact us if you have questions.',
    'Sent when admin rejects an order'
  ),
  (
    'payment_reminder',
    'Payment Reminder',
    'Hi {customer_first_name}, this is a friendly reminder that your balance of {balance_amount} for order #{order_id} is due before {event_date}. Thank you!',
    'Sent as a payment reminder for outstanding balance'
  ),
  (
    'delivery_notification',
    'Delivery Notification',
    'Hi {customer_first_name}, we''re on our way to deliver your order #{order_id}! We''ll arrive within your scheduled window. See you soon!',
    'Sent when crew is en route to delivery location'
  ),
  (
    'test_message',
    'Test Message',
    'Hi {customer_first_name}, this is a test message from Bounce Party Club. Your order #{order_id} is confirmed!',
    'Used for testing SMS functionality'
  )
ON CONFLICT (template_key) DO NOTHING;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_sms_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sms_template_updated_at_trigger
  BEFORE UPDATE ON sms_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_sms_template_updated_at();
