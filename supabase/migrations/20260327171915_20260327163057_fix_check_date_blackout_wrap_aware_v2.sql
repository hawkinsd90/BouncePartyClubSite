/*
  # Fix check_date_blackout — annual wrap-aware v2 (operator precedence fix)

  ## Problem with previous fix
  The non-wrapping branch had an unparenthesized OR inside an AND chain,
  which Postgres would parse in the wrong order due to AND binding tighter
  than OR. This migration replaces the function with fully-parenthesized logic.

  ## Wrap detection
  A stored (month, day) range wraps across the year boundary when:
    end_month < start_month
    OR (end_month = start_month AND end_day < start_day)

  ## Projection strategy
  Non-wrapping  : start and end both projected into event year Y.
  Wrapping (cur): start → Y,   end → Y+1  (Dec-in-Y, Jan-in-Y+1)
  Wrapping (prev): start → Y-1, end → Y   (event in Jan covered by prior Dec)

  ## No schema changes — function body only.
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
    (expires_at IS NULL OR expires_at >= v_start)
    AND (

      -- one-time: plain date-range overlap
      (recurrence = 'one_time'
        AND start_date <= v_end
        AND end_date   >= v_start)

      OR

      -- annual, non-wrapping (e.g. Jun 1 – Jun 15, Dec 1 – Dec 25)
      -- Detected when end_month > start_month, or same month and end_day >= start_day
      (recurrence = 'annual'
        AND (
          EXTRACT(MONTH FROM end_date) > EXTRACT(MONTH FROM start_date)
          OR (
            EXTRACT(MONTH FROM end_date) = EXTRACT(MONTH FROM start_date)
            AND EXTRACT(DAY FROM end_date) >= EXTRACT(DAY FROM start_date)
          )
        )
        AND make_date(v_year, EXTRACT(MONTH FROM start_date)::int, EXTRACT(DAY FROM start_date)::int) <= v_end
        AND make_date(v_year, EXTRACT(MONTH FROM end_date)::int,   EXTRACT(DAY FROM end_date)::int)   >= v_start
      )

      OR

      -- annual, wrapping — current cycle (e.g. Dec 24 – Jan 2, event in Dec)
      -- start projects into Y, end into Y+1
      (recurrence = 'annual'
        AND (
          EXTRACT(MONTH FROM end_date) < EXTRACT(MONTH FROM start_date)
          OR (
            EXTRACT(MONTH FROM end_date) = EXTRACT(MONTH FROM start_date)
            AND EXTRACT(DAY FROM end_date) < EXTRACT(DAY FROM start_date)
          )
        )
        AND make_date(v_year,     EXTRACT(MONTH FROM start_date)::int, EXTRACT(DAY FROM start_date)::int) <= v_end
        AND make_date(v_year + 1, EXTRACT(MONTH FROM end_date)::int,   EXTRACT(DAY FROM end_date)::int)   >= v_start
      )

      OR

      -- annual, wrapping — prior cycle (e.g. Dec 24 – Jan 2, event in Jan)
      -- start projects into Y-1, end into Y
      (recurrence = 'annual'
        AND (
          EXTRACT(MONTH FROM end_date) < EXTRACT(MONTH FROM start_date)
          OR (
            EXTRACT(MONTH FROM end_date) = EXTRACT(MONTH FROM start_date)
            AND EXTRACT(DAY FROM end_date) < EXTRACT(DAY FROM start_date)
          )
        )
        AND make_date(v_year - 1, EXTRACT(MONTH FROM start_date)::int, EXTRACT(DAY FROM start_date)::int) <= v_end
        AND make_date(v_year,     EXTRACT(MONTH FROM end_date)::int,   EXTRACT(DAY FROM end_date)::int)   >= v_start
      )

    );

  RETURN QUERY SELECT
    COALESCE(v_full_blocked, false),
    COALESCE(v_full_blocked OR v_same_day_blocked, false);
END;
$$;

GRANT EXECUTE ON FUNCTION check_date_blackout(date, date) TO anon, authenticated;
