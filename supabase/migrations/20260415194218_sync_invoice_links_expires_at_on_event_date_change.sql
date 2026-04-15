/*
  # Sync invoice_links.expires_at when order event_date changes

  ## Summary
  Adds a DB trigger on the orders table that automatically updates the expires_at
  column on all invoice_links rows for that order whenever event_date changes.

  ## Rule
  - expires_at = event_date + 3 days (end of that day in UTC)
  - Trigger fires on UPDATE of orders where event_date has changed
  - Only updates invoice_links rows that exist (no-op if none)

  ## Why a DB trigger (not frontend)
  - Self-healing: any future code path that changes event_date is automatically covered
  - Narrowly scoped: only touches invoice_links for the affected order
  - No frontend coupling required

  ## New Objects
  - Function: sync_invoice_links_expires_at()
  - Trigger: trg_sync_invoice_links_expires_at on orders (AFTER UPDATE)
*/

CREATE OR REPLACE FUNCTION sync_invoice_links_expires_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_date IS DISTINCT FROM OLD.event_date AND NEW.event_date IS NOT NULL THEN
    UPDATE invoice_links
    SET expires_at = (NEW.event_date::date + interval '3 days')
    WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_links_expires_at ON orders;

CREATE TRIGGER trg_sync_invoice_links_expires_at
  AFTER UPDATE OF event_date ON orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_invoice_links_expires_at();
