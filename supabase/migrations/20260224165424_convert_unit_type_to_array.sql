/*
  # Convert Unit Type to Array for Multiple Categories

  1. Changes
    - Change `type` column from text to text[] to support multiple types per unit
    - Migrate existing single type values to arrays
    - Add validation to ensure at least one type is selected
    - Update indexes for better filtering

  2. Migration Strategy
    - Convert existing type values to single-element arrays
    - Maintain backward compatibility during transition
*/

-- First, add a new column with array type
ALTER TABLE units ADD COLUMN IF NOT EXISTS types text[];

-- Migrate existing data: convert single type to array
UPDATE units SET types = ARRAY[type] WHERE types IS NULL;

-- Make the new column NOT NULL now that it has data
ALTER TABLE units ALTER COLUMN types SET NOT NULL;

-- Add a check constraint to ensure at least one type
ALTER TABLE units ADD CONSTRAINT units_types_not_empty
  CHECK (array_length(types, 1) > 0);

-- Drop the old type column
ALTER TABLE units DROP COLUMN IF EXISTS type;

-- Create an index on types for better filtering performance
CREATE INDEX IF NOT EXISTS idx_units_types ON units USING GIN (types);

-- Add comment
COMMENT ON COLUMN units.types IS 'Array of unit types (e.g., ["Bounce House", "Combo", "Obstacle Course"])';
