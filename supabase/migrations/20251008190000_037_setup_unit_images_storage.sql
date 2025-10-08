/*
  # Setup Unit Images Storage

  1. Storage
    - Create 'unit-images' storage bucket for public unit photos
    - Set up RLS policies for public read access
    - Allow authenticated users to upload images

  2. Security
    - Public read access for browsing catalog
    - Authenticated write access for admin uploads
*/

-- Create storage bucket for unit images
INSERT INTO storage.buckets (id, name, public)
VALUES ('unit-images', 'unit-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public to view unit images
CREATE POLICY "Public can view unit images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'unit-images');

-- Allow authenticated users to upload unit images
CREATE POLICY "Authenticated users can upload unit images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'unit-images');

-- Allow authenticated users to update unit images
CREATE POLICY "Authenticated users can update unit images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'unit-images')
  WITH CHECK (bucket_id = 'unit-images');

-- Allow authenticated users to delete unit images
CREATE POLICY "Authenticated users can delete unit images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'unit-images');
