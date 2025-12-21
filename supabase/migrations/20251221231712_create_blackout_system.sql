/*
  # Create Blackout System

  1. New Tables
    - `blackout_dates`
      - Blocks specific dates or date ranges from being booked
      - Used for holidays, maintenance days, etc.
      
    - `blackout_contacts`
      - Blocks specific email addresses or phone numbers from booking
      - Used for problem customers, banned users, etc.
      
    - `blackout_addresses`
      - Blocks specific addresses from being booked
      - Used for problem locations, restricted areas, etc.

  2. Security
    - RLS enabled on all tables
    - Only admin and master roles can manage blackouts
    - Blackouts are enforced at the application level during booking

  3. Purpose
    - Prevent bookings on specific dates
    - Prevent bookings from specific customers
    - Prevent bookings at specific addresses
*/

-- Create blackout_dates table
CREATE TABLE IF NOT EXISTS blackout_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Create blackout_contacts table
CREATE TABLE IF NOT EXISTS blackout_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  phone text,
  customer_name text,
  reason text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT has_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Create blackout_addresses table
CREATE TABLE IF NOT EXISTS blackout_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  state text NOT NULL,
  zip_code text NOT NULL,
  reason text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE blackout_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE blackout_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE blackout_addresses ENABLE ROW LEVEL SECURITY;

-- RLS Policies for blackout_dates
CREATE POLICY "Admins can view all blackout dates"
  ON blackout_dates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can insert blackout dates"
  ON blackout_dates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can update blackout dates"
  ON blackout_dates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can delete blackout dates"
  ON blackout_dates FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- RLS Policies for blackout_contacts
CREATE POLICY "Admins can view all blackout contacts"
  ON blackout_contacts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can insert blackout contacts"
  ON blackout_contacts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can update blackout contacts"
  ON blackout_contacts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can delete blackout contacts"
  ON blackout_contacts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- RLS Policies for blackout_addresses
CREATE POLICY "Admins can view all blackout addresses"
  ON blackout_addresses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can insert blackout addresses"
  ON blackout_addresses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can update blackout addresses"
  ON blackout_addresses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can delete blackout addresses"
  ON blackout_addresses FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_blackout_dates_range 
  ON blackout_dates(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_blackout_contacts_email 
  ON blackout_contacts(email);

CREATE INDEX IF NOT EXISTS idx_blackout_contacts_phone 
  ON blackout_contacts(phone);

CREATE INDEX IF NOT EXISTS idx_blackout_addresses_city_state 
  ON blackout_addresses(city, state);

-- Functions to update timestamps
CREATE OR REPLACE FUNCTION update_blackout_dates_timestamp()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_blackout_contacts_timestamp()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_blackout_addresses_timestamp()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_update_blackout_dates_timestamp ON blackout_dates;
CREATE TRIGGER trigger_update_blackout_dates_timestamp
  BEFORE UPDATE ON blackout_dates
  FOR EACH ROW
  EXECUTE FUNCTION update_blackout_dates_timestamp();

DROP TRIGGER IF EXISTS trigger_update_blackout_contacts_timestamp ON blackout_contacts;
CREATE TRIGGER trigger_update_blackout_contacts_timestamp
  BEFORE UPDATE ON blackout_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_blackout_contacts_timestamp();

DROP TRIGGER IF EXISTS trigger_update_blackout_addresses_timestamp ON blackout_addresses;
CREATE TRIGGER trigger_update_blackout_addresses_timestamp
  BEFORE UPDATE ON blackout_addresses
  FOR EACH ROW
  EXECUTE FUNCTION update_blackout_addresses_timestamp();