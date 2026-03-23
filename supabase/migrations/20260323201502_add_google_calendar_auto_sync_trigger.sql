/*
  # Google Calendar Auto-Sync Trigger

  ## Purpose
  Automatically triggers a Google Calendar sync whenever an order is created,
  updated (status change, date change, cancellation), or deleted.

  ## How It Works
  - A PostgreSQL trigger fires AFTER INSERT, UPDATE, or DELETE on the orders table
  - The trigger calls a PL/pgSQL function that invokes the sync-google-calendar
    edge function via pg_net (HTTP from inside Postgres)
  - Only fires when the affected date(s) could change the calendar event content:
    - INSERT: sync the new order's event_date
    - UPDATE: sync old event_date (if changed) and new event_date
    - DELETE: sync the deleted order's event_date

  ## Dependencies
  - Requires pg_net extension (available on Supabase)
  - Requires the sync-google-calendar edge function to be deployed

  ## Security
  - Uses SUPABASE_SERVICE_ROLE_KEY via a stored secret in vault or env
  - The edge function itself validates Google credentials from admin_settings
*/

-- Enable pg_net if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Function that fires the edge function for a given set of dates
CREATE OR REPLACE FUNCTION trigger_calendar_sync_for_dates(dates text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_url text;
  service_key text;
  payload jsonb;
BEGIN
  -- Get Supabase URL and service role key from environment
  service_url := current_setting('app.supabase_url', true);
  service_key := current_setting('app.supabase_service_role_key', true);

  -- Fall back to well-known Supabase env pattern if custom settings not set
  IF service_url IS NULL OR service_url = '' THEN
    RETURN; -- Cannot proceed without URL
  END IF;

  IF service_key IS NULL OR service_key = '' THEN
    RETURN; -- Cannot proceed without key
  END IF;

  payload := jsonb_build_object('dates', to_jsonb(dates));

  PERFORM net.http_post(
    url := service_url || '/functions/v1/sync-google-calendar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := payload
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let calendar sync failures break order saves
  RAISE WARNING '[GCAL] trigger_calendar_sync_for_dates failed: %', SQLERRM;
END;
$$;

-- Trigger function that determines which dates to sync
CREATE OR REPLACE FUNCTION auto_sync_google_calendar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dates_to_sync text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Sync the new order's event date
    IF NEW.status = ANY(ARRAY['confirmed', 'in_progress', 'pending_review', 'cancelled']) THEN
      dates_to_sync := ARRAY[NEW.event_date::text];
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Sync if status changed, date changed, or cancellation_reason changed
    IF OLD.status IS DISTINCT FROM NEW.status
       OR OLD.event_date IS DISTINCT FROM NEW.event_date
       OR OLD.cancellation_reason IS DISTINCT FROM NEW.cancellation_reason THEN

      dates_to_sync := ARRAY[]::text[];

      -- Always include new date
      dates_to_sync := array_append(dates_to_sync, NEW.event_date::text);

      -- If date changed, also sync the old date (in case it now has zero orders)
      IF OLD.event_date IS DISTINCT FROM NEW.event_date THEN
        dates_to_sync := array_append(dates_to_sync, OLD.event_date::text);
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    dates_to_sync := ARRAY[OLD.event_date::text];
  END IF;

  -- Fire async HTTP call if we have dates to sync
  IF dates_to_sync IS NOT NULL AND array_length(dates_to_sync, 1) > 0 THEN
    PERFORM trigger_calendar_sync_for_dates(dates_to_sync);
  END IF;

  -- Always return the appropriate row
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let sync failure break the order save
  RAISE WARNING '[GCAL] auto_sync_google_calendar trigger failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop and recreate the trigger cleanly
DROP TRIGGER IF EXISTS trg_auto_sync_google_calendar ON orders;

CREATE TRIGGER trg_auto_sync_google_calendar
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_sync_google_calendar();
