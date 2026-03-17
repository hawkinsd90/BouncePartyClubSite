/*
  # Fix user_consent_log RLS — Remove Unsafe Insert Policies

  ## Problem
  The original migration added two INSERT policies that allow the browser
  to write directly to the consent audit table:

  1. "Anon can insert consent during signup" — WITH CHECK (true)
     This lets any anonymous client fabricate consent rows for any user_id,
     making the audit log untrustworthy.

  2. "Users can insert their own consent" (authenticated)
     While scoped to auth.uid() = user_id, the browser is still the write
     authority. A compromised client can replay or selectively omit rows.

  ## Fix
  - Drop both client-side INSERT policies.
  - All consent writes now go through the `record-consent` Edge Function,
    which uses the service role key after validating the JWT server-side.
    The browser cannot forge user_id — it is taken from the verified token.

  ## What remains
  - SELECT policies for users (own rows) and admins (all rows) are untouched.
  - The table stays append-only: no UPDATE or DELETE policies exist.
  - The edge function resolves customer_id server-side and writes both FKs
    in the same insert, so linkage is as complete as possible at write time.

  ## Safety
  - Uses DROP POLICY IF EXISTS so the migration is safe to re-run.
  - No table schema changes; no data is modified or deleted.
*/

DROP POLICY IF EXISTS "Anon can insert consent during signup" ON user_consent_log;
DROP POLICY IF EXISTS "Users can insert their own consent" ON user_consent_log;
