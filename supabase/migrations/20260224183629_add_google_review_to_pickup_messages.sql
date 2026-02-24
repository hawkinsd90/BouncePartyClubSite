/*
  # Add Google Review Link to Pickup Complete Messages

  1. Changes
    - Add google_review_url to admin_settings
    - Update pickup_thanks_sms template to include Google review request
    - Add pickup_complete_email template with Google review link

  2. New Settings
    - google_review_url: Link for customers to leave Google reviews

  3. Template Updates
    - pickup_thanks_sms: Updated to include review request
    - New email template: pickup_complete_email with review link

  4. Purpose
    - Encourage customers to leave Google reviews after pickup
    - Provide easy access to review link via SMS and email
*/

-- Add Google review URL setting
INSERT INTO admin_settings (key, value, description)
VALUES
  ('google_review_url', 'https://g.page/r/YOUR_GOOGLE_PLACE_ID/review', 'Google review link for customers')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description,
      updated_at = now();

-- Update pickup thanks SMS template to include review encouragement
UPDATE sms_message_templates
SET
  message_template = 'Hi {name}! Thank you for choosing Bounce Party Club! We hope you had a blast. We''d love to hear about your experience - please leave us a Google review: {review_url}. See you next time!',
  description = 'Sent when crew completes pickup - thanks customer and includes Google review link'
WHERE template_key = 'pickup_thanks_sms';

-- Add pickup complete email template
INSERT INTO email_templates (template_name, subject, description, header_title, content_template, theme, category) VALUES
(
  'pickup_complete',
  'Thank You for Choosing Bounce Party Club!',
  'Sent to customer after pickup is complete - includes Google review request',
  'Thank You!',
  '<p>Hi {customer_first_name},</p>
<p>Thank you for choosing Bounce Party Club for your event! We hope everything went smoothly and that you had an amazing time.</p>
<p><strong>Order ID:</strong> {order_id}<br>
<strong>Event Date:</strong> {event_date}</p>
<p>We''d love to hear about your experience! Your feedback helps us improve and helps other families find great party rentals.</p>
<div style="text-align: center; margin: 30px 0;">
  <a href="{review_url}" style="display: inline-block; padding: 15px 30px; background-color: #4285F4; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Leave a Google Review</a>
</div>
<p>Thank you again for your business. We look forward to serving you at your next event!</p>
<p>Best regards,<br>
The Bounce Party Club Team</p>',
  'success',
  'order'
)
ON CONFLICT (template_name) DO UPDATE
  SET subject = EXCLUDED.subject,
      description = EXCLUDED.description,
      header_title = EXCLUDED.header_title,
      content_template = EXCLUDED.content_template,
      theme = EXCLUDED.theme,
      category = EXCLUDED.category,
      updated_at = now();
