/*
  # Add Admin Read Policy for Google Calendar Sync Queue

  ## Problem
  google_calendar_sync_queue only had a service_role ALL policy.
  Authenticated admins had no SELECT access, so the queue count
  display in the admin UI would fail silently.

  ## Fix
  Add a SELECT policy for authenticated admins/masters.
*/

CREATE POLICY "Admins can read google calendar sync queue"
  ON google_calendar_sync_queue
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'master')
    )
  );
