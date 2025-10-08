/*
  # Add Wet Mode Support for Units

  1. Changes to Tables
    - Add `mode` column to `unit_media` table to distinguish dry/wet images
    - Add `dimensions_water` column to `units` table for separate wet dimensions

  2. Notes
    - Mode can be 'dry' or 'water'
    - Water dimensions are optional (null means same as dry dimensions)
    - Existing images will default to 'dry' mode
*/

-- Add mode column to unit_media
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'unit_media' AND column_name = 'mode'
  ) THEN
    ALTER TABLE unit_media ADD COLUMN mode text DEFAULT 'dry' CHECK (mode IN ('dry', 'water'));
  END IF;
END $$;

-- Add dimensions_water column to units
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'units' AND column_name = 'dimensions_water'
  ) THEN
    ALTER TABLE units ADD COLUMN dimensions_water text;
  END IF;
END $$;
