-- BPC-DEV-RECONCILIATION script for batch B23: 1 operation(s); generated from development-execution-manifest.csv; approval 727d45fc152c2c75fcc3ad89629c4f206ef2f0dce26d917a4133983d568a1977
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 303 THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;
  -- op 1: 20260325231044 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260325231044') THEN RAISE EXCEPTION 'version already recorded: 20260325231044'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'carousel-media' AND file_size_limit IS NULL))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260325231044'; END IF;
END $bpc$;
-- exact file 20260325231044_increase_carousel_media_file_size_limit.sql (sha256_lf a9fb2a5bb99bc7c16447726ceb2c8da193f797e283862845fef0764e19ec5a3b) follows verbatim
/*
  # Increase carousel-media storage bucket file size limit

  Changes:
  - Raises the file_size_limit on the carousel-media bucket from 50 MB to 500 MB
    so that larger video files can be uploaded to the hero carousel.
*/

UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE name = 'carousel-media';;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260325231044', 'increase_carousel_media_file_size_limit', ARRAY['-- BPC-DEV-RECONCILIATION executed; batch=B23; version=20260325231044; rule_sha256=05dccc60cc5dde3fa24b9482122f8cbf74c1d7cbc957371ea218f4d45be22965; sha256_lf=a9fb2a5bb99bc7c16447726ceb2c8da193f797e283862845fef0764e19ec5a3b', $bpcsql$/*
  # Increase carousel-media storage bucket file size limit

  Changes:
  - Raises the file_size_limit on the carousel-media bucket from 50 MB to 500 MB
    so that larger video files can be uploaded to the hero carousel.
*/

UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE name = 'carousel-media';
$bpcsql$]);
