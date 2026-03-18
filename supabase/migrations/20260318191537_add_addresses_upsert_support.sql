/*
  # Add unique index on address_key for upsert support

  The addresses table has an address_key column used for deduplication,
  but the upsert/onConflict insert path needs to know the constraint name.
  
  This ensures the unique constraint exists for proper upsert operations.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'addresses' AND indexname = 'addresses_address_key_unique'
  ) THEN
    CREATE UNIQUE INDEX addresses_address_key_unique ON addresses(address_key);
  END IF;
END $$;
