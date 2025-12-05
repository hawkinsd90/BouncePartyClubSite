/*
  # Add Crew Checkpoint SMS Templates

  ## Overview
  Creates SMS message templates for crew checkpoint notifications with real-time ETA calculations.

  ## New Templates Added
  
  1. **eta_sms** - Start Day ETA Notification
     - Sent when crew starts their day and heads to first delivery
     - Includes calculated ETA based on crew's current GPS location
     - Template variables: {name}, {eta}
  
  2. **arrived_sms** - Arrival Notification
     - Sent when crew arrives at delivery location
     - Includes waiver and payment portal links
     - Template variables: {name}, {order_id}
  
  3. **dropoff_done_sms** - Drop-Off Complete
     - Sent when crew leaves after successful delivery
     - Friendly message wishing customer a great event
     - Template variables: {name}
  
  4. **pickup_thanks_sms** - Pickup Complete Thank You
     - Sent when crew completes pickup
     - Thanks customer and requests review
     - Template variables: {name}

  ## Notes
  - ETA template uses dynamic {eta} variable populated by Google Maps Distance Matrix API
  - All templates support crew location tracking for logistics optimization
  - Templates are inserted with ON CONFLICT DO NOTHING to prevent duplicates
*/

-- Insert crew checkpoint SMS templates
INSERT INTO sms_message_templates (template_key, template_name, message_template, description) VALUES
  (
    'eta_sms',
    'Crew - ETA Notification',
    'Hi {name}! Our crew is on the way to your location. Estimated arrival: {eta}. We''ll see you soon! - Bounce Party Club',
    'Sent when crew starts their day - includes real-time ETA calculated from GPS location'
  ),
  (
    'arrived_sms',
    'Crew - Arrival Notification',
    'Hi {name}! We''ve arrived at your location for order #{order_id}. Our crew is setting up your inflatable now. If you haven''t completed your waiver and payment, please do so at your earliest convenience. - Bounce Party Club',
    'Sent when crew arrives at delivery location'
  ),
  (
    'dropoff_done_sms',
    'Crew - Drop-Off Complete',
    'Hi {name}! Your inflatable is all set up and ready for fun. Have an amazing event! We''ll be back at the scheduled pickup time. - Bounce Party Club',
    'Sent when crew finishes drop-off and leaves location'
  ),
  (
    'pickup_thanks_sms',
    'Crew - Pickup Complete',
    'Hi {name}! Thank you for choosing Bounce Party Club! We hope you had a blast. We''d love to hear about your experience - please leave us a review when you get a chance. See you next time!',
    'Sent when crew completes pickup and thanks customer'
  )
ON CONFLICT (template_key) DO NOTHING;
