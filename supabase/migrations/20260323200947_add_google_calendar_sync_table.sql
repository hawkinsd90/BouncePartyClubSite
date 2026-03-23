/*
  # Google Calendar Sync State Table

  ## Purpose
  Stores the Google Calendar event IDs for each synced date so we can
  update existing events (instead of creating duplicates) and delete
  events when a date no longer has qualifying orders.

  ## New Table: google_calendar_sync
  One row per synced calendar date.

  ## Columns
  - id: uuid primary key
  - event_date: the order date (unique — one GCal event per date)
  - google_event_id: the ID returned by Google Calendar API on create
  - last_synced_at: timestamp of last successful sync
  - last_sync_status: 'ok' | 'error'
  - last_sync_error: error message if last sync failed
  - order_count: number of qualifying orders on this date at last sync
  - created_at: creation timestamp

  ## Security
  - RLS enabled
  - Only authenticated admins can read/write
  - No public access

  ## Notes
  - UNIQUE constraint on event_date prevents duplicate rows per date
  - ON CONFLICT DO UPDATE pattern used for upsert
*/

CREATE TABLE IF NOT EXISTS google_calendar_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL UNIQUE,
  google_event_id text,
  last_synced_at timestamptz,
  last_sync_status text DEFAULT 'pending',
  last_sync_error text,
  order_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_sync_event_date ON google_calendar_sync(event_date);
CREATE INDEX IF NOT EXISTS idx_google_calendar_sync_status ON google_calendar_sync(last_sync_status);

ALTER TABLE google_calendar_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read google calendar sync"
  ON google_calendar_sync
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can insert google calendar sync"
  ON google_calendar_sync
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can update google calendar sync"
  ON google_calendar_sync
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'master')
    )
  );

CREATE POLICY "Admins can delete google calendar sync"
  ON google_calendar_sync
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'master')
    )
  );

-- Service role (edge functions) needs full access for automated sync
CREATE POLICY "Service role can manage google calendar sync"
  ON google_calendar_sync
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
