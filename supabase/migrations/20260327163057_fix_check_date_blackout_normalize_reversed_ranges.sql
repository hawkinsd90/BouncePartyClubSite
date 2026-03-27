/*
  # Fix check_date_blackout — normalize reversed date ranges

  ## Summary
  Defensive fix: if a caller accidentally passes p_start > p_end (reversed range),
  the original WHERE clause (start_date <= p_end AND end_date >= p_start) becomes
  logically unsatisfiable and returns no rows — silently reporting no blackout.

  This migration recreates the function with LEAST/GREATEST normalization so that
  reversed inputs are silently corrected rather than silently ignored.

  ## Changes
  - `check_date_blackout(p_start date, p_end date)` — same signature, same grants.
    Internal date range is now normalized via LEAST/GREATEST before the WHERE clause.

  ## Safety
  - No schema changes, no data changes.
  - All callers (anon, authenticated) retain their existing grants automatically
    because the function signature is unchanged.
*/

CREATE OR REPLACE FUNCTION check_date_blackout(p_start date, p_end date)
RETURNS TABLE (is_full_blocked boolean, is_same_day_pickup_blocked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start                 date := LEAST(p_start, p_end);
  v_end                   date := GREATEST(p_start, p_end);
  v_full_blocked          boolean := false;
  v_same_day_blocked      boolean := false;
BEGIN
  SELECT bool_or(block_type = 'full')
    INTO v_full_blocked
    FROM blackout_dates
   WHERE start_date <= v_end
     AND end_date   >= v_start;

  SELECT bool_or(block_type = 'same_day_pickup')
    INTO v_same_day_blocked
    FROM blackout_dates
   WHERE start_date <= v_end
     AND end_date   >= v_start;

  RETURN QUERY SELECT
    COALESCE(v_full_blocked, false),
    COALESCE(v_full_blocked OR v_same_day_blocked, false);
END;
$$;

GRANT EXECUTE ON FUNCTION check_date_blackout(date, date) TO anon, authenticated;
