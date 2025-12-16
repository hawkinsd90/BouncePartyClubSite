/*
  # Add Order Cancellation Admin SMS Template

  1. New Templates
    - `order_cancelled_admin` template
      - Notifies admin when a customer cancels an order
      - Includes customer name, order ID, event date, and refund policy
      - Includes a direct link to view the order details

  2. Template Variables
    - {customer_name} - Customer's full name
    - {order_id} - Order ID (short format)
    - {event_date} - Event date
    - {refund_policy} - Refund policy applied (full refund, credit, or no refund)
    - {order_link} - Direct link to view order in admin panel
*/

-- Add order cancellation admin notification template
INSERT INTO sms_message_templates (template_key, template_name, message_template, description)
VALUES (
  'order_cancelled_admin',
  'Admin - Order Cancellation Notification',
  'Order Cancelled: #{order_id} by {customer_name} for {event_date}. Refund Policy: {refund_policy}. View details: {order_link}',
  'Notifies admin when a customer cancels their order'
)
ON CONFLICT (template_key) DO UPDATE
SET 
  template_name = EXCLUDED.template_name,
  message_template = EXCLUDED.message_template,
  description = EXCLUDED.description,
  updated_at = now();
