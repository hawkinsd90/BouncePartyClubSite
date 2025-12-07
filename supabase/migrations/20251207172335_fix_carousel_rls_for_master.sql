/*
  # Fix Carousel RLS Policies for MASTER Role

  Updates the hero_carousel_images RLS policies to recognize both MASTER and ADMIN roles.

  ## Changes
  - Updates SELECT policy to check for both MASTER and ADMIN roles
  - Updates INSERT policy to check for both MASTER and ADMIN roles
  - Updates UPDATE policy to check for both MASTER and ADMIN roles
  - Updates DELETE policy to check for both MASTER and ADMIN roles

  ## Security
  - Maintains existing security model
  - MASTER and ADMIN users have full access to carousel management
  - Public users can still view active carousel images
*/

-- Drop existing admin policies
DROP POLICY IF EXISTS "Admins can view all carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can insert carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can update carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can delete carousel images" ON hero_carousel_images;

-- Recreate policies with MASTER and ADMIN support
CREATE POLICY "Admins can view all carousel images"
  ON hero_carousel_images
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

CREATE POLICY "Admins can insert carousel images"
  ON hero_carousel_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

CREATE POLICY "Admins can update carousel images"
  ON hero_carousel_images
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

CREATE POLICY "Admins can delete carousel images"
  ON hero_carousel_images
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );
