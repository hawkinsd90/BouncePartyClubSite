/*
  # Fix All Admin Policies to Support MASTER Role

  ## Overview
  Updates all RLS policies and storage policies throughout the database that currently
  only check for 'ADMIN' role to also check for 'MASTER' role.

  ## Changes
  Updates policies for:
  - admin_settings table
  - sms_conversations table
  - contacts table
  - invoices table  
  - carousel-media storage bucket
  - order_discounts table
  - saved_discount_templates table
  - saved_fee_templates table

  ## Security
  - Maintains existing security model
  - Both MASTER and ADMIN roles have admin-level access
  - MASTER has additional permissions for user role management
*/

-- ==========================================
-- admin_settings policies
-- ==========================================
DROP POLICY IF EXISTS "Admins can view all settings" ON admin_settings;
CREATE POLICY "Admins can view all settings"
  ON admin_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can insert settings" ON admin_settings;
CREATE POLICY "Admins can insert settings"
  ON admin_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can update settings" ON admin_settings;
CREATE POLICY "Admins can update settings"
  ON admin_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can delete settings" ON admin_settings;
CREATE POLICY "Admins can delete settings"
  ON admin_settings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- ==========================================
-- sms_conversations policies
-- ==========================================
DROP POLICY IF EXISTS "Admins can view conversations" ON sms_conversations;
CREATE POLICY "Admins can view conversations"
  ON sms_conversations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can insert conversations" ON sms_conversations;
CREATE POLICY "Admins can insert conversations"
  ON sms_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- ==========================================
-- contacts policies
-- ==========================================
DROP POLICY IF EXISTS "Admins can view all contacts" ON contacts;
CREATE POLICY "Admins can view all contacts"
  ON contacts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can insert contacts" ON contacts;
CREATE POLICY "Admins can insert contacts"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can update contacts" ON contacts;
CREATE POLICY "Admins can update contacts"
  ON contacts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- ==========================================
-- invoices policies
-- ==========================================
DROP POLICY IF EXISTS "Admins can view all invoices" ON invoices;
CREATE POLICY "Admins can view all invoices"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can insert invoices" ON invoices;
CREATE POLICY "Admins can insert invoices"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can update invoices" ON invoices;
CREATE POLICY "Admins can update invoices"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- ==========================================
-- carousel-media storage policies
-- ==========================================
DROP POLICY IF EXISTS "Admins can upload carousel media" ON storage.objects;
CREATE POLICY "Admins can upload carousel media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'carousel-media'
    AND (storage.foldername(name))[1] = ''
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can update carousel media" ON storage.objects;
CREATE POLICY "Admins can update carousel media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'carousel-media'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

DROP POLICY IF EXISTS "Admins can delete carousel media" ON storage.objects;
CREATE POLICY "Admins can delete carousel media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'carousel-media'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- ==========================================
-- order_discounts policies
-- ==========================================
DROP POLICY IF EXISTS "Admins can manage discounts" ON order_discounts;
CREATE POLICY "Admins can manage discounts"
  ON order_discounts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- ==========================================
-- saved_discount_templates policies
-- ==========================================
DROP POLICY IF EXISTS "Admins can manage discount templates" ON saved_discount_templates;
CREATE POLICY "Admins can manage discount templates"
  ON saved_discount_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- ==========================================
-- saved_fee_templates policies
-- ==========================================
DROP POLICY IF EXISTS "Admins can manage fee templates" ON saved_fee_templates;
CREATE POLICY "Admins can manage fee templates"
  ON saved_fee_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- ==========================================
-- Update is_admin function
-- ==========================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role IN ('ADMIN', 'MASTER')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
