/*
  # Phase 3 — Blackout recurrence and expiration

  ## Summary
  Extends the blackout_dates table with two new fields so admins can mark
  a blackout as recurring annually and optionally set an expiration date.
  The check_date_blackout RPC is updated to honour both fields.

  ## New columns on blackout_dates
  - `recurrence` text NOT NULL DEFAULT 'one_time'
      CHECK (recurrence IN ('one_time', 'annual'))
      Controls whether the blackout repeats every year on the same month/day range.
  - `expires_at` date NULL
      When set, the blackout (including annual repetitions) is ignored after this date.
      Null means it never expires.

  ## Updated RPC: check_date_blackout(p_start date, p_end date)
  The function is recreated with the same signature and grants.
  Annual recurrence logic:
    - For annual rows, comparison is done on (month, day) only — i.e., the
      calendar dates are projected into the current year (or next year when
      the event straddles Dec→Jan) and then overlap-tested.
    - expires_at is checked against the real p_start date; expired rows are skipped.

  ## Security
  - RLS is unchanged.
  - EXECUTE grant to anon and authenticated is re-applied.
*/

-- 1. Add columns safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'blackout_dates' AND column_name = 'recurrence'
  ) THEN
    ALTER TABLE blackout_dates
      ADD COLUMN recurrence text NOT NULL DEFAULT 'one_time'
        CHECK (recurrence IN ('one_time', 'annual'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'blackout_dates' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE blackout_dates
      ADD COLUMN expires_at date NULL;
  END IF;
END $$;

-- 2. Recreate RPC with annual recurrence + expiration support
CREATE OR REPLACE FUNCTION check_date_blackout(p_start date, p_end date)
RETURNS TABLE (is_full_blocked boolean, is_same_day_pickup_blocked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start              date := LEAST(p_start, p_end);
  v_end                date := GREATEST(p_start, p_end);
  v_full_blocked       boolean := false;
  v_same_day_blocked   boolean := false;
  v_year               int    := EXTRACT(YEAR FROM v_start)::int;
BEGIN
  /*
    One-time rows: direct date-range overlap, skipping expired entries.
    Annual rows  : project the stored month/day into the event year (and also
                   year+1 to handle Dec→Jan wrap) then test overlap.
                   Expiration is checked against the real v_start date.
  */
  SELECT
    bool_or(block_type = 'full'),
    bool_or(block_type = 'same_day_pickup')
  INTO v_full_blocked, v_same_day_blocked
  FROM blackout_dates
  WHERE
    -- skip expired rows
    (expires_at IS NULL OR expires_at >= v_start)
    AND (
      -- one-time: simple date range overlap
      (recurrence = 'one_time'
        AND start_date <= v_end
        AND end_date   >= v_start)
      OR
      -- annual: project into current year
      (recurrence = 'annual'
        AND (make_date(v_year,     EXTRACT(MONTH FROM start_date)::int, EXTRACT(DAY FROM start_date)::int) <= v_end
          AND make_date(v_year,     EXTRACT(MONTH FROM end_date)::int,   EXTRACT(DAY FROM end_date)::int)   >= v_start))
      OR
      -- annual: project into next year (handles Dec start → Jan end wrap)
      (recurrence = 'annual'
        AND (make_date(v_year + 1, EXTRACT(MONTH FROM start_date)::int, EXTRACT(DAY FROM start_date)::int) <= v_end
          AND make_date(v_year + 1, EXTRACT(MONTH FROM end_date)::int,   EXTRACT(DAY FROM end_date)::int)   >= v_start))
    );

  RETURN QUERY SELECT
    COALESCE(v_full_blocked, false),
    COALESCE(v_full_blocked OR v_same_day_blocked, false);
END;
$$;

GRANT EXECUTE ON FUNCTION check_date_blackout(date, date) TO anon, authenticated;
