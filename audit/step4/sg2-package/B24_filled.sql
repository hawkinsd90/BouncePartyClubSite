-- BPC-DEV-RECONCILIATION script for batch B24: 1 operation(s); generated from development-execution-manifest.csv; approval 727d45fc152c2c75fcc3ad89629c4f206ef2f0dce26d917a4133983d568a1977
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 304 THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;
  -- op 1: 20260517221038 (history-only)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260517221038') THEN RAISE EXCEPTION 'version already recorded: 20260517221038'; END IF;
  IF NOT COALESCE(((EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'public-assets' AND file_size_limit IS NULL))), false) THEN RAISE EXCEPTION 'verification rule failed for 20260517221038'; END IF;
END $bpc$;
-- exact file 20260517221038_fix_public_assets_bucket_size_and_mime_types.sql (sha256_lf d992706cc92545e689796e6a148b2a92a027c3f02b54de50b6aee2088c06eabe) follows verbatim
/*
  # Fix public-assets bucket: increase file size limit and add HEIC/HEIF MIME types

  ## Problem
  Crew members uploading delivery proof photos during drop-off tasks receive:
  "Failed to upload images: The object exceeded the maximum allowed size"

  The public-assets bucket has a 5 MB limit, but modern smartphone photos
  (especially iPhone HEIC) regularly exceed this.

  ## Changes
  - public-assets bucket: increase file_size_limit from 5 MB (5242880) to 10 MB (10485760)
  - public-assets bucket: add image/heic and image/heif to allowed_mime_types
    (preserving all existing allowed types: image/png, image/jpeg, image/jpg, image/gif, image/webp)

  ## No data loss
  Existing uploaded files and bucket policies are unaffected.
*/

UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
WHERE name = 'public-assets';;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260517221038', 'fix_public_assets_bucket_size_and_mime_types', ARRAY['-- BPC-DEV-RECONCILIATION executed; batch=B24; version=20260517221038; rule_sha256=c1465fdb8c66913559633d35aab7f95f89480be651bcf11628d9243c1e704446; sha256_lf=d992706cc92545e689796e6a148b2a92a027c3f02b54de50b6aee2088c06eabe', $bpcsql$/*
  # Fix public-assets bucket: increase file size limit and add HEIC/HEIF MIME types

  ## Problem
  Crew members uploading delivery proof photos during drop-off tasks receive:
  "Failed to upload images: The object exceeded the maximum allowed size"

  The public-assets bucket has a 5 MB limit, but modern smartphone photos
  (especially iPhone HEIC) regularly exceed this.

  ## Changes
  - public-assets bucket: increase file_size_limit from 5 MB (5242880) to 10 MB (10485760)
  - public-assets bucket: add image/heic and image/heif to allowed_mime_types
    (preserving all existing allowed types: image/png, image/jpeg, image/jpg, image/gif, image/webp)

  ## No data loss
  Existing uploaded files and bucket policies are unaffected.
*/

UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
WHERE name = 'public-assets';
$bpcsql$]);
