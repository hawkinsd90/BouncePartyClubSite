/*
  # Increase carousel-media storage bucket file size limit

  Changes:
  - Raises the file_size_limit on the carousel-media bucket from 50 MB to 500 MB
    so that larger video files can be uploaded to the hero carousel.
*/

UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE name = 'carousel-media';
