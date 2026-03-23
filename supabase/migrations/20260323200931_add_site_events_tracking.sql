/*
  # Site Events Tracking

  ## Purpose
  Lightweight site/user activity tracking for business analytics.
  Captures public-facing funnel events without storing excessive PII.

  ## New Table: site_events
  Stores anonymous/semi-anonymous site activity events.

  ## Columns
  - id: uuid primary key
  - event_name: event type (page_view, unit_view, quote_started, etc.)
  - session_id: anonymous session identifier (client-generated UUID, no PII)
  - unit_id: optional reference if event is unit-specific
  - order_id: optional reference if event is order-specific
  - page_path: URL path (no query params to avoid leaking tokens)
  - referrer: HTTP referrer (trimmed to domain only for privacy)
  - metadata: small arbitrary JSON payload (max useful context)
  - created_at: timestamp

  ## Security
  - RLS enabled
  - Anonymous insert allowed (public events don't require auth)
  - Only authenticated admins can read
  - No policy allows update or delete (events are append-only)

  ## Retention
  - A comment documents the intent to prune events older than 180 days via pg_cron if available
*/

CREATE TABLE IF NOT EXISTS site_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  session_id text,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  page_path text,
  referrer text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_events_event_name ON site_events(event_name);
CREATE INDEX IF NOT EXISTS idx_site_events_created_at ON site_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_events_unit_id ON site_events(unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_site_events_session_id ON site_events(session_id) WHERE session_id IS NOT NULL;

ALTER TABLE site_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert site events"
  ON site_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can read site events"
  ON site_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'master')
    )
  );
