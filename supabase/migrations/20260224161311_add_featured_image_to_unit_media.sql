/*
  # Add Featured Image Support to Unit Media

  1. Changes
    - Add `is_featured` boolean column to `unit_media` table
    - This allows admins to select which image displays in catalog and PDF exports
    - Only one image per unit should be featured at a time (enforced in application logic)
    - Images without a featured flag will use sort order as fallback

  2. Notes
    - Existing first images (sort=0) will be marked as featured for backward compatibility
    - The application will ensure only one image per unit+mode can be featured
*/

-- Add is_featured column to unit_media
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'unit_media' AND column_name = 'is_featured'
  ) THEN
    ALTER TABLE unit_media ADD COLUMN is_featured boolean DEFAULT false;
  END IF;
END $$;

-- Mark existing first images (sort=0) as featured for backward compatibility
-- This is done per unit and mode to preserve existing behavior
DO $$
BEGIN
  UPDATE unit_media
  SET is_featured = true
  WHERE (unit_id, mode, sort) IN (
    SELECT unit_id, mode, MIN(sort)
    FROM unit_media
    GROUP BY unit_id, mode
  );
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_unit_media_featured ON unit_media(unit_id, mode, is_featured) WHERE is_featured = true;
