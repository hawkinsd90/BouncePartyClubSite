/*
  # Add anon INSERT policy for order_changelog cancellation entries

  ## Summary
  Customer-initiated cancellations flow through an anonymous (unauthenticated) code path.
  The existing INSERT policy only allows authenticated users (auth.uid() = user_id),
  which silently drops the changelog row when an anon customer cancels.

  ## Change
  - Adds a narrow anon INSERT policy scoped to change_type = 'cancellation' only
  - Enforces user_id IS NULL so anon rows cannot impersonate any real user
  - Does not broaden access for any other change_type or user_id

  ## Security
  - Anon callers can only insert rows where change_type = 'cancellation' AND user_id IS NULL
  - All other change_type values remain blocked for anon
  - The existing authenticated policy is untouched
*/

CREATE POLICY "Anon customers can insert cancellation changelog entries"
  ON order_changelog
  FOR INSERT
  TO anon
  WITH CHECK (
    change_type = 'cancellation'
    AND user_id IS NULL
  );
