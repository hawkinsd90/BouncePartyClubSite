/*
  # Add block_type to blackout_dates and create check_date_blackout RPC

  ## Summary
  This migration adds Phase 1 enforcement infrastructure for the blackout date system.

  ## Changes

  ### Modified Tables
  - `blackout_dates`
    - New column `block_type` (text, NOT NULL, DEFAULT 'full')
      - Allowed values: 'full', 'same_day_pickup'
      - 'full' means the date is completely blocked — no bookings at all
      - 'same_day_pickup' is reserved for Phase 2 (same-day pickup only restriction)
      - All existing rows automatically receive 'full' via the default

  ### New Functions
  - `check_date_blackout(p_start date, p_end date)`
    - Returns a single row with two boolean flags:
        - `is_full_blocked`: true if any blackout row with block_type='full' overlaps the given range
        - `is_same_day_pickup_blocked`: true if any blackout row with block_type='same_day_pickup' overlaps,
          OR if is_full_blocked is already true (full block implies same-day is also blocked)
    - SECURITY DEFINER — reads blackout_dates even when called by anon
    - Granted to anon and authenticated so client-side code and edge functions can call it
    - This function is the SINGLE SOURCE OF TRUTH for blackout logic.
      All callers (UX layer, client-side early rejection, stripe-checkout edge function) use this function.
      Annual recurrence logic will be added here in Phase 3 — no callers need to change.

  ## Security Notes
  - anon access to this RPC intentionally reveals only aggregate boolean results, not blackout reasons/notes
  - RLS on blackout_dates itself remains unchanged (admin-only read/write for raw rows)
  - The function runs SECURITY DEFINER so it can read the table regardless of caller role

  ## Migration Safety
  - `block_type` has DEFAULT 'full' so all existing rows remain valid immediately
  - No backfill required, no data loss risk
*/

-- Add block_type column to blackout_dates
-- All existing rows automatically get 'full' via the DEFAULT
ALTER TABLE blackout_dates
  ADD COLUMN IF NOT EXISTS block_type text NOT NULL DEFAULT 'full'
    CHECK (block_type IN ('full', 'same_day_pickup'));

-- Create the enforcement RPC
-- Returns structured flags, one row always returned (never NULL)
CREATE OR REPLACE FUNCTION check_date_blackout(p_start date, p_end date)
RETURNS TABLE (is_full_blocked boolean, is_same_day_pickup_blocked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_blocked          boolean := false;
  v_same_day_blocked      boolean := false;
BEGIN
  -- Check for full blocks overlapping the requested date range
  SELECT bool_or(block_type = 'full')
    INTO v_full_blocked
    FROM blackout_dates
   WHERE start_date <= p_end
     AND end_date   >= p_start;

  -- Check for same_day_pickup blocks overlapping the requested date range
  SELECT bool_or(block_type = 'same_day_pickup')
    INTO v_same_day_blocked
    FROM blackout_dates
   WHERE start_date <= p_end
     AND end_date   >= p_start;

  -- A full block implies same-day is also blocked
  RETURN QUERY SELECT
    COALESCE(v_full_blocked, false),
    COALESCE(v_full_blocked OR v_same_day_blocked, false);
END;
$$;

-- Grant execute to anon (UX layer + client-side) and authenticated (admin tooling)
GRANT EXECUTE ON FUNCTION check_date_blackout(date, date) TO anon, authenticated;
