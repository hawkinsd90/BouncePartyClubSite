/*
  # Add Pictures Reminder SMS Template
  
  1. New Template
    - `pictures_reminder` - Template to remind customers to upload pictures of their setup area
  
  2. Purpose
    - Allow admins to send a reminder to customers to upload pictures of the lot/area
    - Helps gather important information for event preparation
    
  3. Available Variables
    - {customer_first_name} - Customer's first name
    - {portal_link} - Link to customer portal
*/

-- Add pictures reminder SMS template
INSERT INTO sms_message_templates (template_key, template_name, message_template, description)
VALUES (
  'pictures_reminder',
  'Pictures Reminder',
  'Hi {customer_first_name}! To help us prepare for your event, please upload pictures of your setup area through your customer portal: {portal_link}. This helps us ensure smooth setup on event day!',
  'Reminder for customer to upload setup area pictures'
)
ON CONFLICT (template_key) DO UPDATE
SET template_name = EXCLUDED.template_name,
    message_template = EXCLUDED.message_template,
    description = EXCLUDED.description;
