/*
  # Drop remaining open contacts UPDATE policy

  ## Problem
  A policy named "Anyone can update own-email contact during checkout upsert"
  still exists on the contacts table with USING (true) / WITH CHECK (true).
  This allows any anon or authenticated user to UPDATE any contact row.

  The previous migration dropped "Anyone can update contact during checkout upsert"
  but missed this identically-scoped policy added by an earlier migration
  (20260324190114_fix_contacts_anon_upsert_insert_and_update.sql).

  ## Fix
  Drop this policy. The contacts INSERT policy remains for new-contact creation.
  Existing contact row updates during anon checkout will be silently skipped
  (the upsert ON CONFLICT path will fail the UPDATE portion), which is acceptable —
  contact data staleness is a lower risk than arbitrary row mutation by anon users.
*/

DROP POLICY IF EXISTS "Anyone can update own-email contact during checkout upsert" ON contacts;
