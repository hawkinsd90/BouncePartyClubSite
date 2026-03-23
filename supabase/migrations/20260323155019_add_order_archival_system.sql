/*
  # Add Order Archival System

  ## Summary
  Implements soft-archival for completed/cancelled orders older than 90 days.
  Adds an `archived_at` column to the orders table plus a helper function.

  ## Changes
  ### New Column
  - `orders.archived_at` (timestamptz, nullable) — set when an order is soft-archived; NULL means active/visible by default

  ### New Function
  - `archive_old_orders()` — marks completed or cancelled orders older than 90 days as archived

  ## Notes
  - Soft-archive only: data is never deleted, orders remain accessible via direct link or by toggling the archive filter
  - RLS not changed: existing policies still apply
  - No orders are auto-archived on migration; archival only happens when the function is called
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'archived_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN archived_at timestamptz DEFAULT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_archived_at ON orders (archived_at) WHERE archived_at IS NOT NULL;

CREATE OR REPLACE FUNCTION archive_old_orders(threshold_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count integer;
BEGIN
  UPDATE orders
  SET archived_at = now()
  WHERE archived_at IS NULL
    AND status IN ('completed', 'cancelled')
    AND event_date < (CURRENT_DATE - threshold_days);

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;
