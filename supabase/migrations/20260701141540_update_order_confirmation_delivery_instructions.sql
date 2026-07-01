UPDATE sms_message_templates
SET message_template = 'Hi {customer_name}, thank you for booking with Bounce Party Club! Your order #{order_id} for {event_date} has been received and is pending review. We''ll confirm shortly!

Please note: You must be available for delivery between 6:00am and 12:00pm unless otherwise specified. Please ensure the setup area is maintained and free of debris.{pet_reminder}'
WHERE template_key = 'order_confirmation';
