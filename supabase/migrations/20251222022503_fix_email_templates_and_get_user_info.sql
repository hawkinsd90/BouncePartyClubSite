/*
  # Fix Email Templates RLS and Add Case-Insensitive Role Checks

  1. Changes
    - Update email_templates RLS policies to use case-insensitive role comparison
    - This fixes the issue where templates weren't loading due to uppercase roles in database

  2. Security
    - Maintains same security model, just makes role checks case-insensitive
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view all email templates" ON email_templates;
DROP POLICY IF EXISTS "Admins can update email templates" ON email_templates;

-- Recreate with case-insensitive role checks
CREATE POLICY "Admins can view all email templates"
  ON email_templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND LOWER(user_roles.role) IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can update email templates"
  ON email_templates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND LOWER(user_roles.role) IN ('admin', 'master')
    )
  );
