/*
  # Add Stripe Publishable Key Setting

  1. Changes
    - Adds `stripe_publishable_key` to admin_settings table
    - This key is needed on the frontend to initialize Stripe Elements
  
  2. Security
    - Publishable keys are safe to expose on the frontend
    - They can only create payment intents, not charge cards directly
*/

INSERT INTO admin_settings (key, value, description)
VALUES ('stripe_publishable_key', '', 'Stripe publishable key for frontend (pk_test_... or pk_live_...)')
ON CONFLICT (key) DO NOTHING;
