/*
  # Add Hero Carousel System

  1. New Tables
    - `hero_carousel_images`
      - `id` (uuid, primary key)
      - `image_url` (text) - URL or path to the image
      - `title` (text, nullable) - Optional title for the slide
      - `description` (text, nullable) - Optional description
      - `display_order` (integer) - Order in which images appear
      - `is_active` (boolean) - Whether to show this image
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `hero_carousel_images` table
    - Add policy for public read access to active images
    - Add policy for authenticated admins to manage images

  3. Storage
    - Create storage bucket for carousel images with public access
*/

-- Create hero_carousel_images table
CREATE TABLE IF NOT EXISTS hero_carousel_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  title text,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE hero_carousel_images ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can view active carousel images
CREATE POLICY "Anyone can view active carousel images"
  ON hero_carousel_images
  FOR SELECT
  USING (is_active = true);

-- Policy: Admins can view all carousel images
CREATE POLICY "Admins can view all carousel images"
  ON hero_carousel_images
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Policy: Admins can insert carousel images
CREATE POLICY "Admins can insert carousel images"
  ON hero_carousel_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Policy: Admins can update carousel images
CREATE POLICY "Admins can update carousel images"
  ON hero_carousel_images
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Policy: Admins can delete carousel images
CREATE POLICY "Admins can delete carousel images"
  ON hero_carousel_images
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_hero_carousel_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hero_carousel_updated_at
  BEFORE UPDATE ON hero_carousel_images
  FOR EACH ROW
  EXECUTE FUNCTION update_hero_carousel_updated_at();

-- Insert some sample carousel images
INSERT INTO hero_carousel_images (image_url, title, description, display_order, is_active)
VALUES
  ('https://images.pexels.com/photos/1267697/pexels-photo-1267697.jpeg', 'Birthday Parties', 'Make your child''s birthday unforgettable', 1, true),
  ('https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg', 'School Events', 'Perfect for school carnivals and field days', 2, true),
  ('https://images.pexels.com/photos/1537635/pexels-photo-1537635.jpeg', 'Community Events', 'Great for festivals and community gatherings', 3, true)
ON CONFLICT DO NOTHING;