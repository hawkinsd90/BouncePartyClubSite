/*
  # Consent Drain Idempotency Hardening

  ## Purpose
  Prevents duplicate consent rows when the drain edge function is called more than once
  for the same signup event — e.g., two tabs signing in simultaneously, onAuthStateChange
  firing twice, or a network retry arriving while the first request is still processing.

  ## Changes

  ### Modified Table: user_consent_log

  1. New column: `consent_batch_id` (text, nullable)
     - A stable UUID-format string generated once at signup time and stored in
       `pending_consent.batch_id` inside `auth.users.raw_user_meta_data`.
     - The same value is written to every row produced by a single signup event.
     - Nullable so that existing rows and future non-signup consent events remain valid.

  2. New unique index: `uq_user_consent_log_batch_type`
     - UNIQUE (user_id, consent_batch_id, consent_type) WHERE consent_batch_id IS NOT NULL
     - This is a partial unique index so it only applies to rows that carry a batch_id.
     - Effect: if the drain function runs twice with the same batch_id, the second
       INSERT … ON CONFLICT DO NOTHING writes zero rows — no error, no duplicates.

  3. New index on consent_batch_id for fast lookups
     - Supports the idempotency check and future audit queries.

  ### Security — Removed dangerous open anon INSERT policy

  The original migration created:
    CREATE POLICY "Anon can insert consent during signup"
      ON user_consent_log FOR INSERT TO anon WITH CHECK (true);

  This policy allows any unauthenticated request to insert arbitrary consent rows
  for any user_id without restriction. It is removed here.
  The edge function (service role) is the only write path and does not need this policy.

  ## Notes
  - Existing rows with NULL consent_batch_id are unaffected by the unique constraint.
  - Backfilling old rows is not necessary; the constraint is forward-looking.
  - No data is deleted or modified by this migration.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_consent_log'
      AND column_name = 'consent_batch_id'
  ) THEN
    ALTER TABLE user_consent_log ADD COLUMN consent_batch_id text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_consent_log_batch_id
  ON user_consent_log(consent_batch_id)
  WHERE consent_batch_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'user_consent_log'
      AND indexname = 'uq_user_consent_log_batch_type'
  ) THEN
    CREATE UNIQUE INDEX uq_user_consent_log_batch_type
      ON user_consent_log(user_id, consent_batch_id, consent_type)
      WHERE consent_batch_id IS NOT NULL;
  END IF;
END $$;

DROP POLICY IF EXISTS "Anon can insert consent during signup" ON user_consent_log;
