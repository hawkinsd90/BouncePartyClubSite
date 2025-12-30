/*
  # Fix Hero Carousel RLS Policies

  1. Problem
    - Current RLS policies on hero_carousel_images are blocking inserts
    - Policies check user_roles table directly which can cause issues

  2. Solution
    - Use get_user_role() SECURITY DEFINER function instead
    - Use case-insensitive role comparison

  3. Changes
    - Drop existing carousel policies
    - Recreate using get_user_role() function
    - Maintains same security model
*/

-- Drop existing carousel policies
DROP POLICY IF EXISTS "Admins can view all carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can insert carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can update carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can delete carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Public can view active carousel images" ON hero_carousel_images;

-- Public can view active carousel images (no auth required)
CREATE POLICY "Public can view active carousel images"
  ON hero_carousel_images
  FOR SELECT
  USING (is_active = true);

-- Admins can view all carousel images (including inactive)
CREATE POLICY "Admins can view all carousel images"
  ON hero_carousel_images
  FOR SELECT
  TO authenticated
  USING (
    UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
  );

-- Admins can insert carousel images
CREATE POLICY "Admins can insert carousel images"
  ON hero_carousel_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
  );

-- Admins can update carousel images
CREATE POLICY "Admins can update carousel images"
  ON hero_carousel_images
  FOR UPDATE
  TO authenticated
  USING (
    UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
  )
  WITH CHECK (
    UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
  );

-- Admins can delete carousel images
CREATE POLICY "Admins can delete carousel images"
  ON hero_carousel_images
  FOR DELETE
  TO authenticated
  USING (
    UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
  );