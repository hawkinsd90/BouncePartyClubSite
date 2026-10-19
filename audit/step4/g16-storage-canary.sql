-- G-16 CANARY for hosted Development (project srxunxiytojjsuhcmzjg). NOT RUN against any hosted system.
-- Purpose: prove, without any persistent change, that the hosted operator may do the only things that need ownership of storage.objects in
-- 20261014120000, 20261015120000 and 20261015123000: CREATE POLICY, DROP POLICY (of a policy created by someone else) on storage.objects.
-- (The same files' UPDATE/INSERT on storage.buckets are plain DML by grant and are not probed here.)
--
-- Safety design: the block ALWAYS ends in RAISE EXCEPTION. An error aborts the surrounding transaction, so every statement in the block
-- (the probe policy, the dropped existing policy, any lock) is rolled back by the database itself, whichever channel sends it. There is no COMMIT,
-- no ROLLBACK to forget, and no data access: only pg_policies is read.
-- Expected result when the capability exists:  ERROR: BPC-CANARY-OK: ...   (this error IS the success signal)
-- Any other error (for example "must be owner of relation objects") means the capability is NOT available: STOP, change nothing, report.
-- Run as ONE statement, exactly as written, after explicit owner approval, with the restore point recorded.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
DO $bpc_canary$
DECLARE
  n0 int;
  expected text[] := ARRAY[
    'Admins can delete event-essentials media', 'Admins can update event-essentials media', 'Admins can upload event-essentials media',
    'Anyone can upload lot pictures', 'Authenticated can delete lot pictures', 'Public can read event-essentials media'];
  found text[];
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-CANARY-STOP: unexpected database'; END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO found FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
  IF found IS DISTINCT FROM expected THEN RAISE EXCEPTION 'BPC-CANARY-STOP: storage.objects policies are not the six recorded on 2026-10-18: %', found; END IF;
  -- 1. create, then drop, a probe policy that matches no row and no role the application uses
  CREATE POLICY zz_bpc_canary ON storage.objects FOR SELECT TO service_role USING (false);
  DROP POLICY zz_bpc_canary ON storage.objects;
  -- 2. drop an existing policy created by an earlier migration (what the three files do with every existing policy)
  DROP POLICY "Public can read event-essentials media" ON storage.objects;
  SELECT count(*) INTO n0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
  IF n0 <> 5 THEN RAISE EXCEPTION 'BPC-CANARY-STOP: expected 5 policies after the probe drop, found %', n0; END IF;
  RAISE EXCEPTION 'BPC-CANARY-OK: CREATE POLICY and DROP POLICY on storage.objects are permitted for % ; this transaction is aborted on purpose and nothing persists', current_user;
END
$bpc_canary$;
