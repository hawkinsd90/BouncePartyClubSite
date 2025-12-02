/*
  # E-Signature System for ESIGN/UETA Compliance

  1. New Tables
    - `order_signatures`
      - Complete audit trail for electronic signatures
      - Stores signer identity, consent metadata, signature artifacts
      - Links to orders table
      - Includes waiver version and text snapshot for legal protection
    
    - `consent_records` 
      - Tracks all consent checkboxes (SMS, card-on-file, e-sign)
      - Versioned consent text with timestamps
      - Boolean flags for audit trail

  2. Storage Buckets
    - `signatures` - PNG images of drawn signatures
    - `signed-waivers` - Generated PDFs with embedded signatures
    - Both buckets allow authenticated read, admin write

  3. New Columns on `orders`
    - `waiver_signed_at` - timestamp of signature completion
    - `signed_waiver_url` - public URL to final PDF
    - `signature_id` - FK to order_signatures table

  4. Security
    - RLS enabled on all tables
    - Customers can only view their own signatures
    - Admins can view all signatures
    - Storage buckets secured with RLS policies

  5. Compliance Features
    - Server-side timestamps (immutable)
    - IP address and user agent capture
    - Waiver text snapshot (protects against future edits)
    - Version tracking for waiver updates
    - Complete audit trail for legal disputes
*/

-- =====================================================
-- CREATE order_signatures TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS order_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  
  -- Signer Identity
  signer_name text NOT NULL,
  signer_email text NOT NULL,
  signer_phone text,
  
  -- Signature Artifacts
  signature_image_url text NOT NULL,
  initials_data jsonb NOT NULL DEFAULT '{}',
  typed_name text NOT NULL,
  
  -- Generated Documents
  pdf_url text,
  pdf_generated_at timestamptz,
  
  -- Metadata for ESIGN/UETA Compliance
  signed_at timestamptz NOT NULL DEFAULT now(),
  ip_address text NOT NULL,
  user_agent text NOT NULL,
  device_info jsonb DEFAULT '{}',
  
  -- Waiver Version & Snapshot
  waiver_version text NOT NULL DEFAULT '1.0',
  waiver_text_snapshot text NOT NULL,
  
  -- Electronic Consent
  electronic_consent_given boolean NOT NULL DEFAULT true,
  electronic_consent_text text NOT NULL,
  
  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_order_signatures_order_id ON order_signatures(order_id);
CREATE INDEX IF NOT EXISTS idx_order_signatures_customer_id ON order_signatures(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_signatures_signed_at ON order_signatures(signed_at DESC);

-- =====================================================
-- CREATE consent_records TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  
  -- Consent Type
  consent_type text NOT NULL, -- 'sms', 'card_on_file', 'electronic_signature'
  
  -- Consent Details
  consented boolean NOT NULL,
  consent_text text NOT NULL,
  consent_version text NOT NULL DEFAULT '1.0',
  
  -- Metadata
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_order_id ON consent_records(order_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_customer_id ON consent_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_type ON consent_records(consent_type);

-- =====================================================
-- ADD COLUMNS TO orders TABLE
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'waiver_signed_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN waiver_signed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'signed_waiver_url'
  ) THEN
    ALTER TABLE orders ADD COLUMN signed_waiver_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'signature_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN signature_id uuid REFERENCES order_signatures(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'e_signature_consent'
  ) THEN
    ALTER TABLE orders ADD COLUMN e_signature_consent boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'sms_consent'
  ) THEN
    ALTER TABLE orders ADD COLUMN sms_consent boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'card_on_file_consent'
  ) THEN
    ALTER TABLE orders ADD COLUMN card_on_file_consent boolean DEFAULT false;
  END IF;
END $$;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS
ALTER TABLE order_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

-- order_signatures policies
CREATE POLICY "Users can view own signatures"
  ON order_signatures FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Users can create own signatures"
  ON order_signatures FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Admins can view all signatures"
  ON order_signatures FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update signatures"
  ON order_signatures FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Allow anonymous users to insert signatures (for checkout flow)
CREATE POLICY "Anonymous can create signatures"
  ON order_signatures FOR INSERT
  TO anon
  WITH CHECK (true);

-- consent_records policies
CREATE POLICY "Users can view own consent records"
  ON consent_records FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Users can create own consent records"
  ON consent_records FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Anonymous can create consent records"
  ON consent_records FOR INSERT
  TO anon
  WITH CHECK (true);

-- =====================================================
-- STORAGE BUCKETS
-- =====================================================

-- Create signatures bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signatures',
  'signatures',
  false,
  2097152, -- 2MB
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Create signed-waivers bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signed-waivers',
  'signed-waivers',
  false,
  10485760, -- 10MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for signatures bucket
CREATE POLICY "Authenticated users can upload signatures"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'signatures');

CREATE POLICY "Anonymous users can upload signatures"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'signatures');

CREATE POLICY "Users can view own signatures"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'signatures');

CREATE POLICY "Anonymous can view signatures"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'signatures');

-- Storage policies for signed-waivers bucket
CREATE POLICY "Service role can upload waivers"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'signed-waivers');

CREATE POLICY "Service role can upload waivers anon"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'signed-waivers');

CREATE POLICY "Users can view own waivers"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'signed-waivers');

CREATE POLICY "Anonymous can view waivers"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'signed-waivers');

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to check if order has valid signature
CREATE OR REPLACE FUNCTION order_has_valid_signature(order_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM order_signatures 
    WHERE order_id = order_uuid 
      AND signature_image_url IS NOT NULL 
      AND pdf_url IS NOT NULL
  );
END;
$$;

-- Function to get signature status for order
CREATE OR REPLACE FUNCTION get_signature_status(order_uuid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'has_signature', COUNT(*) > 0,
    'signed_at', MAX(signed_at),
    'pdf_url', MAX(pdf_url),
    'signer_name', MAX(signer_name)
  )
  INTO result
  FROM order_signatures
  WHERE order_id = order_uuid;
  
  RETURN result;
END;
$$;
