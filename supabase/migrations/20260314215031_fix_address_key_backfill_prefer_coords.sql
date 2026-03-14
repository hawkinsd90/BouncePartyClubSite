/*
  # Fix address_key backfill: prefer rows with coordinates as canonical

  ## Summary
  Re-runs address deduplication with the correct survivor-selection logic:
  prefer rows that already have lat/lng, then fall back to earliest created_at.
  Also re-backfills address_key using regexp_replace for whitespace normalization
  to match the TypeScript normalizeZip implementation exactly.

  ## Changes
  - address_key backfilled with regexp_replace(trim(zip), '\s+', '', 'g') formula
  - Duplicate resolution now prefers rows with lat IS NOT NULL AND lng IS NOT NULL first,
    then earliest created_at, then smallest id
  - Unique index ensured

  ## Notes
  - Safe to re-run; uses IF NOT EXISTS guards
  - No data is lost; orders are re-pointed to canonical before deletes
*/

-- 1. Re-backfill address_key using regexp_replace (handles internal spaces in zips)
UPDATE addresses
SET address_key = lower(trim(line1)) || '|' || lower(trim(city)) || '|' || upper(trim(state)) || '|' || regexp_replace(trim(zip), '\s+', '', 'g')
WHERE line1 IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL AND zip IS NOT NULL;

-- 2. Resolve duplicates preferring rows with coords, then earliest created_at
DO $$
DECLARE
  dup RECORD;
  survivor_id uuid;
  dupe_id uuid;
BEGIN
  FOR dup IN
    SELECT
      address_key,
      array_agg(
        id ORDER BY
          CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 0 ELSE 1 END ASC,
          created_at ASC NULLS LAST,
          id ASC
      ) AS ids
    FROM addresses
    WHERE address_key IS NOT NULL
    GROUP BY address_key
    HAVING count(*) > 1
  LOOP
    survivor_id := dup.ids[1];

    FOR i IN 2..array_length(dup.ids, 1) LOOP
      dupe_id := dup.ids[i];
      UPDATE orders SET address_id = survivor_id WHERE address_id = dupe_id;
      DELETE FROM addresses WHERE id = dupe_id;
    END LOOP;
  END LOOP;
END $$;

-- 3. Ensure unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS addresses_address_key_unique
  ON addresses (address_key)
  WHERE address_key IS NOT NULL;
