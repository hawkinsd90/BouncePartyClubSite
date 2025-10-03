/*
  # Add Unit Inventory Tracking

  1. Changes
    - Add `quantity_available` column to units table (default 1)
    - This tracks how many of each unit we have in inventory
    
  2. Purpose
    - Enable availability checking to prevent double-booking
    - Each unit can have multiple copies (quantity > 1)
*/

-- Add quantity tracking to units
ALTER TABLE units 
ADD COLUMN IF NOT EXISTS quantity_available integer DEFAULT 1 NOT NULL;

COMMENT ON COLUMN units.quantity_available IS 'Total number of this unit available in inventory';
