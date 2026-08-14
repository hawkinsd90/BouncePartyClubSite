/*
  # Create contact_inquiries table

  Stores submissions from the public Contact page.
  All writes go through the submit-contact-inquiry Edge Function
  using the service-role client (bypasses RLS).
  No anonymous policies are created.
*/

CREATE TABLE IF NOT EXISTS contact_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  event_date date,
  guest_count text,
  message text NOT NULL,
  email_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_inquiries_created
  ON contact_inquiries (created_at DESC);

ALTER TABLE contact_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view contact inquiries" ON contact_inquiries;
CREATE POLICY "Admins can view contact inquiries"
  ON contact_inquiries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );
