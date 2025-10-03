/*
  # Add Pets Field to Orders

  1. Orders Table Updates
    - Add has_pets boolean field
    - Defaults to false
    - Helps crew prepare for arrival at residential locations

  2. Notes
    - Only relevant for residential locations
    - Used to alert crew about potential pet waste or loose pets on property
*/

-- Add has_pets column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_pets boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN orders.has_pets IS 'Whether customer has pets at residential location (for crew safety and preparation)';
