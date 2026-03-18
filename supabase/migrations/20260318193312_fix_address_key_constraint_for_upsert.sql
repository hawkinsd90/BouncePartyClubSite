/*
  # Fix address_key unique constraint for upsert support

  The previous migration created a partial unique index (WHERE address_key IS NOT NULL)
  which PostgREST cannot use for ON CONFLICT upsert operations. PostgREST requires
  a full unique constraint (not a partial index) for onConflict to work.

  ## Changes
  - Drop the partial unique index
  - Create a full unique constraint on address_key (NULLs are excluded by SQL semantics anyway)
*/

DROP INDEX IF EXISTS addresses_address_key_unique;

ALTER TABLE addresses
  DROP CONSTRAINT IF EXISTS addresses_address_key_unique;

ALTER TABLE addresses
  ADD CONSTRAINT addresses_address_key_unique UNIQUE (address_key);
