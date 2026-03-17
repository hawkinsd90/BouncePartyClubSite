/*
  # Add pending_signups_consent table

  ## Purpose
  Provides a durable server-side store for consent captured during signup for accounts
  that require email confirmation. The row is written AFTER new-vs-existing user
  classification succeeds, so it is never written for duplicate signups against
  existing unconfirmed accounts. When the user confirms their email and SIGNED_IN fires,
  AuthContext reads this row, drains it into user_consent_log via record-consent, and
  deletes it.

  ## New Tables
  - `pending_signups_consent`
    - `user_id` (uuid, PK, FK → auth.users): the newly-created user
    - `batch_id` (uuid): idempotency key matching the consent batch
    - `consents` (jsonb): array of { type, version, consented }
    - `source` (text): origin label, e.g. 'signup'
    - `user_agent_hint` (text): first 200 chars of user agent at signup time
    - `created_at` (timestamptz): when the row was inserted

  ## Security
  - RLS enabled
  - Anon INSERT is allowed only when the target user_id was created within the last
    60 seconds (proven new account, safe post-classification write)
  - Authenticated SELECT/DELETE is restricted to the row owner (auth.uid() = user_id)
  - No UPDATE policy — rows are write-once, then deleted after drain
  - No admin read-all policy — consent pending rows are user-owned

  ## Notes
  - One row per user (PK on user_id). A second signup attempt for the same email
    produces a duplicate-signup response classified as isExistingUser and bails before
    this table is ever touched.
  - Rows that are never drained (user never confirms email) are orphaned but harmless.
    A periodic cleanup job can prune rows older than 30 days if desired.
*/

CREATE TABLE IF NOT EXISTS pending_signups_consent (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id        uuid NOT NULL,
  consents        jsonb NOT NULL,
  source          text NOT NULL DEFAULT 'signup',
  user_agent_hint text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pending_signups_consent ENABLE ROW LEVEL SECURITY;

-- Anon insert allowed only for users created within the last 60 seconds.
-- This allows the post-classification write from SignUp.tsx before a session exists,
-- while preventing writes for arbitrary user IDs or existing accounts.
CREATE POLICY "Anon can insert for freshly created user"
  ON pending_signups_consent
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = user_id
        AND created_at >= (now() - interval '60 seconds')
    )
  );

-- Authenticated users can read their own pending consent row.
CREATE POLICY "User can select own pending consent"
  ON pending_signups_consent
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Authenticated users can delete their own pending consent row after successful drain.
CREATE POLICY "User can delete own pending consent"
  ON pending_signups_consent
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
