/*
  # Fix Contact Upsert and Add Admin Delete Policy

  ## Problem
  The contacts upsert during checkout uses `onConflict: 'email'` which requires
  both INSERT and UPDATE permissions. Anon/authenticated users only have INSERT,
  so repeat customer upserts silently fail on the UPDATE path.

  ## Solution
  1. Create a SECURITY DEFINER RPC `upsert_contact_from_checkout` that runs with
     elevated privileges so it can always insert OR update regardless of the caller's
     RLS permissions. This is safe because the function only touches one specific row
     matched by email and only updates safe, user-provided fields.

  2. Add an admin-only DELETE policy so contacts can be removed from the admin panel.

  ## Changes
  - New function: `upsert_contact_from_checkout(p_first_name, p_last_name, p_email, p_phone, p_business_name, p_opt_in_sms)`
  - New policy: "Admins can delete contacts" on contacts FOR DELETE
*/

CREATE OR REPLACE FUNCTION upsert_contact_from_checkout(
  p_first_name    text,
  p_last_name     text,
  p_email         text,
  p_phone         text,
  p_business_name text DEFAULT NULL,
  p_opt_in_sms    boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO contacts (
    first_name,
    last_name,
    email,
    phone,
    business_name,
    source,
    opt_in_email,
    opt_in_sms
  )
  VALUES (
    p_first_name,
    p_last_name,
    p_email,
    p_phone,
    p_business_name,
    'booking',
    true,
    p_opt_in_sms
  )
  ON CONFLICT (email) DO UPDATE SET
    first_name    = EXCLUDED.first_name,
    last_name     = EXCLUDED.last_name,
    phone         = EXCLUDED.phone,
    business_name = EXCLUDED.business_name,
    opt_in_sms    = EXCLUDED.opt_in_sms,
    updated_at    = now();
END;
$$;

CREATE POLICY "Admins can delete contacts"
  ON contacts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND lower(user_roles.role) = ANY (ARRAY['admin', 'master'])
    )
  );
