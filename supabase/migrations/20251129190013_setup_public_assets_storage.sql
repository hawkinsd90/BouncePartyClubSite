/*
  # Setup Public Assets Storage

  1. Storage Setup
    - Creates 'public-assets' storage bucket for logos and images
    - Allows public access for reading files
    - Restricts uploads to authenticated users only
  
  2. Security
    - Public read access for email display
    - Authenticated write access only
*/

-- Create public assets bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'public-assets',
  'public-assets',
  true,
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public assets are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload public assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update public assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete public assets" ON storage.objects;

-- Allow public read access
CREATE POLICY "Public assets are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'public-assets');

-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload public assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'public-assets');

-- Allow authenticated users to update
CREATE POLICY "Authenticated users can update public assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'public-assets');

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete public assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'public-assets');
