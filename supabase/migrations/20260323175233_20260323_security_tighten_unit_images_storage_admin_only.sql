/*
  # Tighten unit-images storage to admin-only writes

  ## Summary
  The `unit-images` storage bucket currently allows any authenticated user to
  INSERT, UPDATE, and DELETE objects. This migration replaces those open policies
  with admin-only (ADMIN or MASTER role) write policies using the existing
  `get_user_role()` helper function.

  ## Changes
  - Drops existing permissive authenticated INSERT/UPDATE/DELETE policies on
    `storage.objects` for the `unit-images` bucket
  - Re-creates INSERT, UPDATE, DELETE policies restricted to users whose role is
    ADMIN or MASTER
  - SELECT (public read) policy is left unchanged — unit images are publicly viewable

  ## Security
  - Only admins and master users can upload, replace, or delete unit images
  - Prevents any logged-in customer account from modifying the unit image library
*/

DROP POLICY IF EXISTS "Authenticated users can upload unit images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update unit images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete unit images" ON storage.objects;
DROP POLICY IF EXISTS "Admin can upload unit images" ON storage.objects;
DROP POLICY IF EXISTS "Admin can update unit images" ON storage.objects;
DROP POLICY IF EXISTS "Admin can delete unit images" ON storage.objects;

CREATE POLICY "Admin can upload unit images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'unit-images'
    AND (
      SELECT role FROM user_roles WHERE user_id = auth.uid()
    ) IN ('ADMIN', 'MASTER')
  );

CREATE POLICY "Admin can update unit images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'unit-images'
    AND (
      SELECT role FROM user_roles WHERE user_id = auth.uid()
    ) IN ('ADMIN', 'MASTER')
  )
  WITH CHECK (
    bucket_id = 'unit-images'
    AND (
      SELECT role FROM user_roles WHERE user_id = auth.uid()
    ) IN ('ADMIN', 'MASTER')
  );

CREATE POLICY "Admin can delete unit images"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'unit-images'
    AND (
      SELECT role FROM user_roles WHERE user_id = auth.uid()
    ) IN ('ADMIN', 'MASTER')
  );
