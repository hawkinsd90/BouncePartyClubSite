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
WHERE name = 'public-assets';
