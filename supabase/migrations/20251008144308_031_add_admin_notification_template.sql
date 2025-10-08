/*
  # Add Admin Notification Template and Phone Setting

  1. New Template
    - Add `booking_received_admin` template for notifying admin of new bookings
  
  2. Admin Settings
    - Add `admin_phone` setting for receiving SMS notifications
  
  3. Notes
    - Admin will receive SMS when a customer completes payment
    - Template uses order details to inform admin
*/

-- Add admin notification template
INSERT INTO sms_message_templates (template_key, template_name, message_template, description)
VALUES (
  'booking_received_admin',
  'Admin - New Booking Notification',
  'New booking received! Order #{order_id} from {customer_name} for {event_date} at {event_address}. Check admin panel to review.',
  'Notifies admin when a new booking is received and paid'
)
ON CONFLICT (template_key) DO UPDATE 
SET message_template = EXCLUDED.message_template,
    template_name = EXCLUDED.template_name,
    description = EXCLUDED.description;

-- Add admin phone setting (you'll need to update this with actual phone number)
INSERT INTO admin_settings (key, value, description)
VALUES (
  'admin_phone',
  '+13138893860',
  'Phone number for admin SMS notifications'
)
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value,
    description = EXCLUDED.description;