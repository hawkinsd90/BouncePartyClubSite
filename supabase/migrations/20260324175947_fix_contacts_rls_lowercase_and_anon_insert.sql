/*
  # Fix contacts RLS policies

  ## Problems
  1. The existing admin INSERT/UPDATE/SELECT policies check for uppercase role values
     ('ADMIN', 'MASTER') but roles are now stored as lowercase ('admin', 'master'),
     so admins can no longer read or write contacts.
  2. Anonymous/guest users (checkout without account) have no INSERT policy,
     causing "Error creating contact" during guest checkout.

  ## Fix
  - Drop old uppercase policies and recreate them with lowercase comparisons
  - Add an anon INSERT policy so guest checkouts can create/upsert contacts
*/

-- Drop old uppercase policies
DROP POLICY IF EXISTS "Admins can insert contacts" ON contacts;
DROP POLICY IF EXISTS "Admins can view all contacts" ON contacts;
DROP POLICY IF EXISTS "Admins can update contacts" ON contacts;

-- Recreate with lowercase role comparisons
CREATE POLICY "Admins can insert contacts"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND LOWER(user_roles.role) = ANY (ARRAY['admin', 'master'])
    )
  );

CREATE POLICY "Admins can view all contacts"
  ON contacts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND LOWER(user_roles.role) = ANY (ARRAY['admin', 'master'])
    )
  );

CREATE POLICY "Admins can update contacts"
  ON contacts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND LOWER(user_roles.role) = ANY (ARRAY['admin', 'master'])
    )
  );

-- Allow anon and authenticated users to upsert contacts during checkout
CREATE POLICY "Anyone can upsert contact during checkout"
  ON contacts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
