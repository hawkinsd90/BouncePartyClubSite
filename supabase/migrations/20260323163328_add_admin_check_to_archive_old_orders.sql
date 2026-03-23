/*
  # Add Admin Authorization Check to archive_old_orders()

  ## Summary
  The archive_old_orders() function was SECURITY DEFINER with no caller
  authorization check, meaning any authenticated user could call it and
  archive all orders. This migration replaces the function with one that
  verifies the caller is an ADMIN or MASTER role before proceeding.

  ## Changes
  - Replaces archive_old_orders() with an identical version that adds an
    admin-only guard using the existing is_admin() helper function.
  - If a non-admin calls the function, it raises an exception with a clear
    permission denied message and returns 0.

  ## Security
  - SECURITY DEFINER is preserved (required to bypass RLS for the UPDATE)
  - Caller's auth.uid() is checked via is_admin() before any data is modified
*/

CREATE OR REPLACE FUNCTION archive_old_orders(threshold_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can archive orders';
  END IF;

  UPDATE orders
  SET archived_at = now()
  WHERE archived_at IS NULL
    AND status IN ('completed', 'cancelled')
    AND event_date < (CURRENT_DATE - threshold_days);

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;
