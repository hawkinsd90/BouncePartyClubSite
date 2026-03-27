/*
  # Fix check_date_blackout — annual wrap-across-year correctness

  ## Problem
  The previous implementation projected both start_date and end_date into the
  same calendar year (v_year or v_year+1). For ranges that wrap across the year
  boundary (e.g., Dec 31 → Jan 1) this produces an inverted range where
  projected_end < projected_start, so the overlap test always fails.

  ## Fix
  Detect whether the stored (month, day) range wraps across the year boundary.
  A range wraps when end_month < start_month, or end_month = start_month AND
  end_day < start_day.

  For non-wrapping ranges: both dates project into the same year.
  For wrapping ranges  : start projects into year Y, end into year Y+1.
                         We also test the prior cycle: start in Y-1, end in Y
                         (handles events in January that are covered by the
                         preceding Dec→Jan cycle).

  No schema changes — only the function body is replaced.
*/

CREATE OR REPLACE FUNCTION check_date_blackout(p_start date, p_end date)
RETURNS TABLE (is_full_blocked boolean, is_same_day_pickup_blocked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start            date    := LEAST(p_start, p_end);
  v_end              date    := GREATEST(p_start, p_end);
  v_full_blocked     boolean := false;
  v_same_day_blocked boolean := false;
  v_year             int     := EXTRACT(YEAR FROM v_start)::int;
BEGIN
  SELECT
    bool_or(block_type = 'full'),
    bool_or(block_type = 'same_day_pickup')
  INTO v_full_blocked, v_same_day_blocked
  FROM blackout_dates
  WHERE
    -- skip expired rows
    (expires_at IS NULL OR expires_at >= v_start)
    AND (
      -- ── one-time: plain date-range overlap ──────────────────────────────
      (recurrence = 'one_time'
        AND start_date <= v_end
        AND end_date   >= v_start)

      -- ── annual, non-wrapping range (e.g. Jun 1 – Jun 15) ────────────────
      -- Both month/day values project into the same calendar year.
      OR (recurrence = 'annual'
          AND EXTRACT(MONTH FROM end_date) > EXTRACT(MONTH FROM start_date)
              OR (EXTRACT(MONTH FROM end_date) = EXTRACT(MONTH FROM start_date)
                  AND EXTRACT(DAY FROM end_date) >= EXTRACT(DAY FROM start_date))
          -- project into event year
          AND make_date(v_year, EXTRACT(MONTH FROM start_date)::int, EXTRACT(DAY FROM start_date)::int) <= v_end
          AND make_date(v_year, EXTRACT(MONTH FROM end_date)::int,   EXTRACT(DAY FROM end_date)::int)   >= v_start)

      -- ── annual, wrapping range (e.g. Dec 24 – Jan 2) ────────────────────
      -- Start projects into year Y, end into year Y+1 (current cycle).
      OR (recurrence = 'annual'
          AND (EXTRACT(MONTH FROM end_date) < EXTRACT(MONTH FROM start_date)
               OR (EXTRACT(MONTH FROM end_date) = EXTRACT(MONTH FROM start_date)
                   AND EXTRACT(DAY FROM end_date) < EXTRACT(DAY FROM start_date)))
          AND make_date(v_year,     EXTRACT(MONTH FROM start_date)::int, EXTRACT(DAY FROM start_date)::int) <= v_end
          AND make_date(v_year + 1, EXTRACT(MONTH FROM end_date)::int,   EXTRACT(DAY FROM end_date)::int)   >= v_start)

      -- ── annual, wrapping range — prior cycle (covers events in Jan) ─────
      -- Start projects into year Y-1, end into year Y.
      OR (recurrence = 'annual'
          AND (EXTRACT(MONTH FROM end_date) < EXTRACT(MONTH FROM start_date)
               OR (EXTRACT(MONTH FROM end_date) = EXTRACT(MONTH FROM start_date)
                   AND EXTRACT(DAY FROM end_date) < EXTRACT(DAY FROM start_date)))
          AND make_date(v_year - 1, EXTRACT(MONTH FROM start_date)::int, EXTRACT(DAY FROM start_date)::int) <= v_end
          AND make_date(v_year,     EXTRACT(MONTH FROM end_date)::int,   EXTRACT(DAY FROM end_date)::int)   >= v_start)
    );

  RETURN QUERY SELECT
    COALESCE(v_full_blocked, false),
    COALESCE(v_full_blocked OR v_same_day_blocked, false);
END;
$$;

GRANT EXECUTE ON FUNCTION check_date_blackout(date, date) TO anon, authenticated;
