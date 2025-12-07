/*
  # Update Carousel for Media Uploads

  1. Changes
    - Add `media_type` column to distinguish between images and videos
    - Add `storage_path` column to track uploaded files
    - Keep `image_url` for backwards compatibility and external URLs

  2. Storage
    - Storage bucket `carousel-media` will be created for uploads
*/

-- Add media_type column (image or video)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hero_carousel_images' AND column_name = 'media_type'
  ) THEN
    ALTER TABLE hero_carousel_images ADD COLUMN media_type text NOT NULL DEFAULT 'image';
  END IF;
END $$;

-- Add storage_path column for uploaded files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hero_carousel_images' AND column_name = 'storage_path'
  ) THEN
    ALTER TABLE hero_carousel_images ADD COLUMN storage_path text;
  END IF;
END $$;

-- Add check constraint for media_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hero_carousel_images_media_type_check'
  ) THEN
    ALTER TABLE hero_carousel_images
    ADD CONSTRAINT hero_carousel_images_media_type_check
    CHECK (media_type IN ('image', 'video'));
  END IF;
END $$;