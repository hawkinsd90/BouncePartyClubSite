/*
  # Private storage for delivery and damage evidence photos

  ## Why
  Crew and Admin take delivery, pickup and damage proof photos on a task. They were uploaded to the PUBLIC "public-assets"
  bucket (the same bucket that holds the site logo) and the permanent public URL was stored in
  task_status.delivery_images / damage_images. Anyone with such a URL could view a customer's property photos, and the
  upload policy for that bucket was only a staff check on the bucket name.

  ## What this migration does
  1. Creates the PRIVATE bucket "order-evidence" for operational evidence:
       - private, 10 MB per file, image types only (the types the proof-photo screens produce)
       - object paths: <order id>/<task status id>/<delivery|damage>/<random id>.<ext>
  2. Gives that bucket NO Storage policy at all. Nobody - anonymous visitor, customer, Crew, Admin - can read, list, upload,
     overwrite or delete in it through the Storage API with a user session:
       - uploads use a signed upload authorization issued by the task-evidence Edge Function for one exact object
         (a signed upload is authorized by its token, not by a Storage policy);
       - viewing uses short-lived signed URLs minted by the task-evidence function (staff), customer-portal-data
         (the customer's own delivery photos) and promote-media (marketing copies) with the service role.
  3. Removes the Storage policy that let staff upload straight into "public-assets". Its only use was the task-photo
     upload that no longer exists. The other public-assets policies (Admin / Master read, replace, delete) and the bucket
     itself stay: the site logo and other intentionally public brand assets remain publicly readable by URL.

  ## What this migration does NOT do
  It does not move, copy or delete any object, and it does not rewrite task_status. Historical evidence objects stay in
  public-assets (and their URLs keep working) until the controlled evidence migration (scripts/migrate-order-evidence.mjs)
  copies them into this bucket and rewrites the matching task_status entries. Every reader understands both forms, so the
  system works throughout. It does not touch lot-pictures / order-pictures (see the customer photo migration), the waiver
  buckets, or the public marketing buckets.
*/

-- 1. The private evidence bucket (idempotent: re-running keeps it private with the same limits).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-evidence',
  'order-evidence',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. No Storage policy may mention the evidence bucket (whatever its name).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%order-evidence%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- 3. Staff no longer upload evidence into public-assets.
DROP POLICY IF EXISTS "Staff upload public assets" ON storage.objects;
