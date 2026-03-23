/*
  # Disable Google Calendar Auto-Sync Trigger

  ## Reason
  Google OAuth credentials have not yet been configured.
  The trigger is scaffolded but must not fire until credentials are set up.

  ## What this does
  - Drops the active trigger on the orders table (trg_auto_sync_google_calendar)
  - The trigger function (auto_sync_google_calendar) is PRESERVED for re-enable later
  - The queue table (google_calendar_sync_queue) is PRESERVED
  - The sync state table (google_calendar_sync) is PRESERVED

  ## To re-enable later
  Run:
    CREATE TRIGGER trg_auto_sync_google_calendar
      AFTER INSERT OR UPDATE OR DELETE ON orders
      FOR EACH ROW
      EXECUTE FUNCTION auto_sync_google_calendar();

  Do this ONLY after Google credentials are stored in admin_settings.
*/

DROP TRIGGER IF EXISTS trg_auto_sync_google_calendar ON orders;
