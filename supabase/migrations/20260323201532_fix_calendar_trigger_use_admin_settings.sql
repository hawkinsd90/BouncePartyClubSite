/*
  # Fix Calendar Sync Trigger — Use admin_settings for URL/Key

  ## Problem
  The previous trigger tried to read Supabase URL and service key via
  current_setting('app.supabase_url'), which requires ALTER DATABASE
  permission that Supabase doesn't grant.

  ## Solution
  Read the Supabase URL from the admin_settings table (key: supabase_url),
  and use the built-in SUPABASE_SERVICE_ROLE_KEY vault secret if available,
  or fall back to an admin_settings row.

  ## Alternative Approach
  Since pg_net requires the URL and key at trigger time, we store a minimal
  record in a lightweight queue table instead of calling HTTP directly.
  A separate scheduled reconciliation can process the queue.

  Actually, the cleanest production-safe approach for Supabase is:
  Use pg_net with the Supabase project URL (hardcoded once during setup)
  and the service_role_key from the vault secret SUPABASE_SERVICE_ROLE_KEY.

  Supabase provides vault access via: vault.decrypted_secrets
  But that also requires special setup.

  ## Final Approach: Store dates-to-sync in a queue table
  The trigger writes to google_calendar_sync_queue.
  The edge function (or a cron) drains the queue.
  This is 100% reliable and requires no special permissions.
*/

-- Create a lightweight sync queue table
CREATE TABLE IF NOT EXISTS google_calendar_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL,
  queued_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  attempts integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_gcal_queue_unprocessed
  ON google_calendar_sync_queue(event_date)
  WHERE processed_at IS NULL;

ALTER TABLE google_calendar_sync_queue ENABLE ROW LEVEL SECURITY;

-- Service role can manage the queue
CREATE POLICY "Service role manages gcal queue"
  ON google_calendar_sync_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Replace the trigger function to use the queue instead of direct HTTP
CREATE OR REPLACE FUNCTION auto_sync_google_calendar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dates_to_sync text[];
  d text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = ANY(ARRAY['confirmed', 'in_progress', 'pending_review', 'cancelled']) THEN
      dates_to_sync := ARRAY[NEW.event_date::text];
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status
       OR OLD.event_date IS DISTINCT FROM NEW.event_date
       OR OLD.cancellation_reason IS DISTINCT FROM NEW.cancellation_reason THEN

      dates_to_sync := ARRAY[NEW.event_date::text];

      IF OLD.event_date IS DISTINCT FROM NEW.event_date THEN
        dates_to_sync := array_append(dates_to_sync, OLD.event_date::text);
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    dates_to_sync := ARRAY[OLD.event_date::text];
  END IF;

  IF dates_to_sync IS NOT NULL AND array_length(dates_to_sync, 1) > 0 THEN
    FOREACH d IN ARRAY dates_to_sync LOOP
      INSERT INTO google_calendar_sync_queue (event_date)
      VALUES (d::date)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[GCAL] auto_sync_google_calendar trigger failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Add unique constraint so ON CONFLICT works
ALTER TABLE google_calendar_sync_queue
  DROP CONSTRAINT IF EXISTS google_calendar_sync_queue_event_date_unprocessed;

-- Use a partial unique index instead (only one pending entry per date)
CREATE UNIQUE INDEX IF NOT EXISTS idx_gcal_queue_unique_pending
  ON google_calendar_sync_queue(event_date)
  WHERE processed_at IS NULL;

-- Also drop the old trigger_calendar_sync_for_dates function since we no longer need it
DROP FUNCTION IF EXISTS trigger_calendar_sync_for_dates(text[]);
