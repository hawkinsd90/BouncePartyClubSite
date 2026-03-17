/*
  # Create User Consent Log System

  ## Purpose
  Provides an auditable, versioned record of user consent at signup and other touchpoints.
  This table is the single source of truth for compliance/legal consent.

  ## New Tables

  ### user_consent_log
  Records each consent event with full context.

  Columns:
  - `id` (uuid, PK) — unique consent record
  - `user_id` (uuid, nullable) — auth.users FK; nullable for pre-auth consent capture if ever needed
  - `customer_id` (uuid, nullable) — customers FK; populated post-provisioning if available
  - `consent_type` (text) — one of:
      'terms_of_service'       — required legal acknowledgment
      'privacy_policy'         — required legal acknowledgment
      'marketing_email'        — optional marketing consent
      'marketing_sms'          — optional SMS marketing consent
  - `consented` (boolean) — true = accepted, false = explicitly declined
  - `policy_version` (text) — version string e.g. "1.0", "2025-03"
  - `source` (text) — where consent was captured, e.g. 'signup', 'profile', 'checkout'
  - `ip_hint` (text, nullable) — optional partial IP for audit purposes (not required)
  - `user_agent_hint` (text, nullable) — optional user-agent string for audit
  - `created_at` (timestamptz) — immutable capture timestamp

  ## Security
  - RLS enabled
  - Users can INSERT their own consent (auth.uid() = user_id)
  - Users can SELECT their own consent records
  - Admins (MASTER/ADMIN via user_roles) can SELECT all records
  - No UPDATE or DELETE allowed — consent log is append-only

  ## Notes
  - policy_version allows non-breaking policy updates to be tracked without losing history
  - marketing_sms and marketing_email are strictly separate from transactional/auth messaging
  - To update a policy version, simply insert a new row — old rows are preserved
*/

CREATE TABLE IF NOT EXISTS user_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  consent_type text NOT NULL CHECK (consent_type IN (
    'terms_of_service',
    'privacy_policy',
    'marketing_email',
    'marketing_sms'
  )),
  consented boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL DEFAULT '1.0',
  source text NOT NULL DEFAULT 'signup',
  ip_hint text,
  user_agent_hint text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_consent_log_user_id ON user_consent_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_consent_log_customer_id ON user_consent_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_user_consent_log_type_version ON user_consent_log(consent_type, policy_version);

ALTER TABLE user_consent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own consent"
  ON user_consent_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own consent records"
  ON user_consent_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all consent records"
  ON user_consent_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('MASTER', 'ADMIN')
    )
  );

CREATE POLICY "Anon can insert consent during signup"
  ON user_consent_log FOR INSERT
  TO anon
  WITH CHECK (true);
