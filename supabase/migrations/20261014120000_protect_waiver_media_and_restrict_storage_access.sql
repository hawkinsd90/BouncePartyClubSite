/*
  # Protect waiver media and restrict Storage access

  Scope: signed waiver PDFs, signature images and paper-waiver scans become private (service role / signed URLs only), and the
  over-broad Storage write, delete and listing policies on the nine buckets listed below are replaced by a minimal set.
  This does NOT make customer lot / order photos or delivery / damage evidence private; see Not changed here.

  NOT APPLIED BY THIS CHANGE. Review, then apply manually (Dev first). Deploy the updated Edge Functions (get-waiver-status,
  generate-signed-waiver, save-signature, upload-physical-waiver) BEFORE applying this migration, and the new frontend right after it: those readers
  turn a stored waiver / signature reference into a short-lived signed URL, which is the only way to read the files once the
  buckets are private. Historical rows (full public URLs) keep working because the readers extract the object path.

  Why
    A live audit of the Dev Storage found that the legal documents were world-readable:
      - signed-waivers  (signed waiver PDFs: customer name, address, signature)       public bucket + public SELECT policy
      - signatures      (electronic signature images)                                  public bucket + public SELECT policy
    and that other policies on storage.objects were far broader than any caller needs, in the repository history and/or on Dev:
      - anonymous and signed-in INSERT into signed-waivers, signatures and public-assets;
      - signed-in SELECT of every signature and signed waiver ("Users can view own ..." only checked the bucket);
      - signed-in DELETE of every lot picture (any customer could delete anyone's photos);
      - SELECT on lot-pictures / public-assets for everybody, which lets anyone LIST every object name in those buckets
        (a public bucket serves objects by URL without any policy; a SELECT policy additionally enables listing);
      - signed-in read of order pictures through an email join on contacts.
    The Edge Functions write and read these objects with the service role, which bypasses Storage policies, so none of that
    access was needed.

  What this migration does
    1. signed-waivers and signatures (and physical-waivers, already private) are made private and get NO Storage policy at all:
       only the service role (Edge Functions) can write or read them. People reach them through get-waiver-status, which
       returns a 1-hour signed URL only to the order's token holder, the order's signed-in owner, or admin / master / crew.
    2. Every Storage policy that mentions one of the nine buckets below is dropped and replaced by an explicit minimal set:
         marketing buckets   unit-images, carousel-media, event-essentials-media
                             anonymous read (they are shown on the public website); Admin / Master write.
         public-assets       (logo and marketing files, and - historically - delivery / damage photos; see Not changed)
                             no listing for anonymous or signed-in customers; staff (admin / master / crew) upload;
                             Admin / Master list, replace and delete.
         lot-pictures        customers upload from the portal into "<order id>/<file>" only (image types and size are limited by
                             the bucket); no listing for anonymous or signed-in customers; only Admin / Master list and delete.
         order-pictures      customers upload from the portal into "<order id>/<file>" only; staff read; Admin / Master replace
                             and delete.
    3. Nothing is moved, deleted or rewritten: no objects, no bucket contents, no table rows.

  Not changed here (needs a separate, coordinated change; reported separately)
    - lot-pictures, order-pictures and public-assets stay PUBLIC buckets: the portal, the Admin screens and the delivery /
      damage proof photos still display them through permanent public URLs, and public-assets mixes marketing files with
      delivery / damage evidence, which cannot be separated without moving objects.
    - Customers still upload lot / order pictures straight from the browser (portal flow).
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Buckets that hold legal documents are private
-- ---------------------------------------------------------------------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id IN ('signed-waivers', 'signatures', 'physical-waivers');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Reset every Storage policy that mentions one of these buckets
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  buckets text[] := ARRAY[
    'signed-waivers', 'signatures', 'physical-waivers', 'lot-pictures', 'order-pictures', 'public-assets',
    'unit-images', 'carousel-media', 'event-essentials-media'
  ];
BEGIN
  FOR r IN
    SELECT p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
      AND EXISTS (
        SELECT 1 FROM unnest(buckets) b
        WHERE coalesce(p.qual, '') LIKE '%''' || b || '''%' OR coalesce(p.with_check, '') LIKE '%''' || b || '''%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The explicit policy set
-- ---------------------------------------------------------------------------------------------------------------------

-- Marketing buckets: shown to anonymous visitors, managed by Admin / Master.
CREATE POLICY "Public read marketing media" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media'));
CREATE POLICY "Admin and master manage marketing media" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media') AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id IN ('unit-images', 'carousel-media', 'event-essentials-media') AND (SELECT public.is_admin()));

-- public-assets: no listing policy (objects are served by URL because the bucket is public); staff upload, Admin / Master manage.
CREATE POLICY "Staff upload public assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'public-assets' AND (SELECT public.is_crew_or_admin()));
-- Postgres only lets a role UPDATE / DELETE rows it can also SELECT, so Admin / Master need a read policy for the buckets they manage.
CREATE POLICY "Admin and master read public assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master replace public assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id = 'public-assets' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete public assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'public-assets' AND (SELECT public.is_admin()));

-- lot-pictures: customers upload into "<order id>/<file>" from the portal; only Admin / Master delete; nobody lists.
CREATE POLICY "Upload lot pictures into an order folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'lot-pictures' AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$');
CREATE POLICY "Admin and master read lot pictures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lot-pictures' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete lot pictures" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lot-pictures' AND (SELECT public.is_admin()));

-- order-pictures: customers upload into "<order id>/<file>" from the portal; staff read; Admin / Master replace and delete.
CREATE POLICY "Upload order pictures into an order folder" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'order-pictures' AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$');
CREATE POLICY "Staff read order pictures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_crew_or_admin()));
CREATE POLICY "Admin and master replace order pictures" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id = 'order-pictures' AND (SELECT public.is_admin()));
CREATE POLICY "Admin and master delete order pictures" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'order-pictures' AND (SELECT public.is_admin()));

-- signed-waivers, signatures and physical-waivers intentionally have NO policy: service role only.
