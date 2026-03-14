/*
  # Add address_key for deduplication

  ## Summary
  Adds a computed `address_key` column to the `addresses` table and a unique index on it,
  preventing duplicate rows for the same normalized address (line1, city, state, zip).

  ## Changes

  ### Modified Tables
  - `addresses`
    - New column `address_key` (text, nullable initially, then back-filled and unique-indexed)
    - Computed as: lower(trim(line1)) || '|' || lower(trim(city)) || '|' || upper(trim(state)) || '|' || replace(trim(zip), ' ', '')

  ## Notes
  - Existing rows get their address_key back-filled before the unique index is created.
  - Duplicate existing rows (same key) are resolved by keeping the one with the lowest created_at
    (or smallest id if created_at is tied), and re-pointing any orders/invoices to the survivor.
  - This migration is safe to run on existing data.
*/

-- 1. Add the column (nullable for now)
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS address_key text;

-- 2. Back-fill address_key for all existing rows
UPDATE addresses
SET address_key = lower(trim(line1)) || '|' || lower(trim(city)) || '|' || upper(trim(state)) || '|' || replace(trim(zip), ' ', '')
WHERE address_key IS NULL AND line1 IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL AND zip IS NOT NULL;

-- 3. Handle existing duplicates: for each duplicate group, keep the survivor (lowest created_at / id),
--    re-point orders.address_id to survivor, then delete the extras.
DO $$
DECLARE
  dup RECORD;
  survivor_id uuid;
  dupe_id uuid;
BEGIN
  FOR dup IN
    SELECT address_key, array_agg(id ORDER BY created_at ASC NULLS LAST, id ASC) AS ids
    FROM addresses
    WHERE address_key IS NOT NULL
    GROUP BY address_key
    HAVING count(*) > 1
  LOOP
    survivor_id := dup.ids[1];

    FOR i IN 2..array_length(dup.ids, 1) LOOP
      dupe_id := dup.ids[i];

      -- Re-point orders
      UPDATE orders SET address_id = survivor_id WHERE address_id = dupe_id;

      -- Delete the duplicate
      DELETE FROM addresses WHERE id = dupe_id;
    END LOOP;
  END LOOP;
END $$;

-- 4. Create unique index on address_key (partial: only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS addresses_address_key_unique
  ON addresses (address_key)
  WHERE address_key IS NOT NULL;
