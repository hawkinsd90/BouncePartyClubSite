/*
  # Protect customer-uploaded order photos

  ## Why
  Two Storage buckets hold pictures customers upload from the Customer Portal:

    lot-pictures    pictures of the event location, "<order id>/<file>", recorded in order_lot_pictures.file_path
    order-pictures  pictures of the order / items, "<order id>/<file>", recorded in order_pictures.file_path

  Both were PUBLIC buckets, so anyone who knew (or guessed) an object URL could view a customer's photos, and the earlier
  upload policies only checked that the object name began with a syntactically valid order id: that proves nothing about who
  the caller is. A path that merely looks like "<uuid>/<file>" is not authorization.

  ## What this migration does
  1. Makes both buckets PRIVATE. Objects stay exactly where they are (no copies, no moves, no deletions); existing database
     rows keep their stable bare object paths.
  2. Removes every browser upload / list / read policy on these two buckets, including the "<order id>/<file>" upload policies
     added earlier, and leaves only what the product needs from a signed-in staff session:

       lot-pictures    Admin / Master read (to show the photos, and so that delete can see the rows) and delete
       order-pictures  Admin / Master / Crew read, Admin / Master replace and delete

     Anonymous and ordinary signed-in customers have NO direct Storage access to either bucket: no read, no listing, no
     upload, no delete.

  ## How customers still upload and view their photos
  Through the existing Customer Portal Edge Functions, which use the service role and prove access to the exact order first
  (valid portal token, signed-in owner, or the backend):
    - customer-portal-action  "request_picture_upload": the server chooses the bucket (from a fixed kind) and a random object
                              path inside the order's folder and returns a signed upload authorization for that one object.
                              A signed upload is authorized by its token, not by a Storage policy, so no INSERT policy exists.
    - customer-portal-data    returns each picture with a short-lived signed read URL for that order's own pictures only.
  promote-media reads the private source objects with the service role, which bypasses Storage policies.

  ## What this migration does NOT do
  It does not touch the waiver buckets (signed-waivers, signatures, physical-waivers), public-assets (delivery and damage
  photos stay as they are for a later change), or the public marketing buckets (unit-images, carousel-media,
  event-essentials-media). It does not change any bucket size or file-type limit.
*/

-- 1. Both buckets are private from now on.
UPDATE storage.buckets SET public = false WHERE id IN ('lot-pictures', 'order-pictures');

-- 2. Remove every policy that mentions either bucket (whatever its name), then create exactly the staff policies listed above.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(lot-pictures|order-pictures)'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Admin and master read lot pictures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lot-pictures' AND (SELECT public.is_admin()));

CREATE POLICY "Admin and master delete lot pictures" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lot-pictures' AND (SELECT public.is_admin()));

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
