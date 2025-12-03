/*
  # Add Event Details Fields
  
  1. New Columns
    - `until_end_of_day` (boolean) - Indicates if event runs until end of day
    - `same_day_responsibility_accepted` (boolean) - Customer accepted same-day pickup responsibility
    - `overnight_responsibility_accepted` (boolean) - Customer accepted overnight responsibility
  
  2. Notes
    - These fields track additional event details and customer acknowledgments
    - Default to false for all new and existing orders
    - Required for proper event time management and customer acknowledgment tracking
*/

-- Add until_end_of_day column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS until_end_of_day BOOLEAN DEFAULT false;

-- Add same_day_responsibility_accepted column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS same_day_responsibility_accepted BOOLEAN DEFAULT false;

-- Add overnight_responsibility_accepted column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS overnight_responsibility_accepted BOOLEAN DEFAULT false;
