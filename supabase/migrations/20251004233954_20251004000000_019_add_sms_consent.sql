/*
  # Add SMS Consent Fields to Orders Table

  1. Changes
    - Add `sms_consent_text` column to store the exact consent language
    - Add `sms_consented_at` column to store timestamp of consent
  
  2. Notes
    - Required for Twilio toll-free messaging compliance
    - Stores explicit customer consent to receive SMS notifications
    - Consent text includes opt-out instructions (STOP to unsubscribe)
*/

DO $$
BEGIN
  -- Add SMS consent text field
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'sms_consent_text'
  ) THEN
    ALTER TABLE orders ADD COLUMN sms_consent_text text;
  END IF;

  -- Add SMS consent timestamp field
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'sms_consented_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN sms_consented_at timestamptz;
  END IF;
END $$;