/*
  # Add Twilio Credentials to Admin Settings

  1. Changes
    - Add Twilio Account SID setting
    - Add Twilio Auth Token setting
    - Add Twilio From Number setting

  2. Security
    - Uses existing RLS policies (admin-only access)
    - Credentials stored encrypted at rest by Supabase
*/

INSERT INTO admin_settings (key, value, description)
VALUES 
  ('twilio_account_sid', '', 'Twilio Account SID for SMS notifications'),
  ('twilio_auth_token', '', 'Twilio Auth Token for SMS notifications'),
  ('twilio_from_number', '', 'Twilio phone number to send SMS from (E.164 format)')
ON CONFLICT (key) DO NOTHING;
