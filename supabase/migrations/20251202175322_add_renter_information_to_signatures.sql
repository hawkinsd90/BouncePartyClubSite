/*
  # Add Renter Information Snapshot to Signatures

  1. New Columns on order_signatures
    - Renter information captured at time of signing
    - Complete snapshot for legal record
    - Home address is optional

  2. Changes
    - Add renter_phone (already exists, ensure NOT NULL)
    - Add event_date
    - Add event_end_date
    - Add event_address fields (line1, line2, city, state, zip)
    - Add home_address fields (line1, line2, city, state, zip) as optional
*/

DO $$
BEGIN
  -- Make renter_phone required if it's not already
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures'
      AND column_name = 'signer_phone'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE order_signatures
    ALTER COLUMN signer_phone SET NOT NULL;
  END IF;

  -- Add event date fields
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'event_date'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN event_date date NOT NULL DEFAULT CURRENT_DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'event_end_date'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN event_end_date date;
  END IF;

  -- Add event address fields
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'event_address_line1'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN event_address_line1 text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'event_address_line2'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN event_address_line2 text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'event_city'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN event_city text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'event_state'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN event_state text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'event_zip'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN event_zip text NOT NULL DEFAULT '';
  END IF;

  -- Add home address fields (optional)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'home_address_line1'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN home_address_line1 text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'home_address_line2'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN home_address_line2 text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'home_city'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN home_city text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'home_state'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN home_state text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_signatures' AND column_name = 'home_zip'
  ) THEN
    ALTER TABLE order_signatures ADD COLUMN home_zip text DEFAULT '';
  END IF;
END $$;

-- Remove NOT NULL constraint from defaults after adding columns
ALTER TABLE order_signatures ALTER COLUMN event_date DROP DEFAULT;
ALTER TABLE order_signatures ALTER COLUMN event_address_line1 DROP DEFAULT;
ALTER TABLE order_signatures ALTER COLUMN event_city DROP DEFAULT;
ALTER TABLE order_signatures ALTER COLUMN event_state DROP DEFAULT;
ALTER TABLE order_signatures ALTER COLUMN event_zip DROP DEFAULT;