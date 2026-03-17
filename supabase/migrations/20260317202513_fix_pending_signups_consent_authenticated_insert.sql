/*
  # Fix pending_signups_consent authenticated insert policy

  ## Problem
  The original migration only had an anon INSERT policy. In the immediate-session signup
  path, signUp() returns a session and the Supabase client transitions to authenticated
  before the pending_signups_consent row is inserted. The anon policy does not apply to
  authenticated requests, so the insert fails silently — removing the recovery row that
  drainPendingConsent would use if the direct recordConsent call later fails.

  ## Change
  Add an authenticated INSERT policy restricted to auth.uid() = user_id. This allows
  the row owner to insert their own row and nothing else. Combined with the existing anon
  freshness-gated policy, both signup paths are covered:
    - No-session (email confirmation required): anon insert, recency-gated.
    - Immediate-session: authenticated insert, owner-restricted.

  ## Final RLS summary for pending_signups_consent
  - Anon INSERT: allowed only when auth.users.created_at >= now() - 60s for the target user_id.
  - Authenticated INSERT: allowed only when auth.uid() = user_id (owner inserts own row only).
  - Authenticated SELECT: allowed only when auth.uid() = user_id.
  - Authenticated DELETE: allowed only when auth.uid() = user_id.
  - No UPDATE policy on any role.
  - No broad admin read policy.
*/

CREATE POLICY "User can insert own pending consent"
  ON pending_signups_consent
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
