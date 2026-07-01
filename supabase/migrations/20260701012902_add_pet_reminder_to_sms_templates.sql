-- Add {pet_reminder} placeholder to customer-facing SMS templates.
-- The edge function replaces {pet_reminder} with a pet waste reminder sentence
-- when the order has has_pets = true, otherwise it resolves to an empty string.

UPDATE sms_message_templates
SET message_template = 'Hi {customer_name}, thank you for booking with Bounce Party Club! Your order #{order_id} for {event_date} has been received and is pending review. We''ll confirm shortly!{pet_reminder}'
WHERE template_key = 'order_confirmation';

UPDATE sms_message_templates
SET message_template = 'Great news {name}! Your booking for {event_date} has been approved. Order #{order_id} is confirmed. Total: {total_amount}. See you soon!{pet_reminder}'
WHERE template_key = 'order_approved';

UPDATE sms_message_templates
SET message_template = 'Hi {customer_name}, we''re on our way to deliver your order #{order_id}! We''ll arrive within your scheduled window.{pet_reminder} See you soon!'
WHERE template_key = 'delivery_notification';
