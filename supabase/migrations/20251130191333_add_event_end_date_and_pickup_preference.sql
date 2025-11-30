/*
  # Add Event End Date and Pickup Preference

  1. Changes
    - Add `event_end_date` column to track multi-day rentals
    - Add `pickup_preference` column to track same_day vs next_day pickup choice
    - Set defaults based on existing data (event_end_date = event_date, pickup_preference from overnight_allowed)
    - Keep `overnight_allowed` for backward compatibility

  2. Notes
    - event_end_date defaults to event_date (single day rental)
    - pickup_preference: 'same_day' or 'next_day'
    - Commercial orders always get 'same_day'
    - Residential with overnight_allowed = true gets 'next_day'
*/

-- Add event_end_date column (defaults to event_date for existing records)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS event_end_date DATE;

-- Set event_end_date to event_date for existing records
UPDATE orders 
SET event_end_date = event_date 
WHERE event_end_date IS NULL;

-- Make it NOT NULL after setting defaults
ALTER TABLE orders 
ALTER COLUMN event_end_date SET NOT NULL;

-- Add pickup_preference column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS pickup_preference TEXT;

-- Set pickup_preference based on existing data
UPDATE orders 
SET pickup_preference = CASE 
  WHEN location_type = 'commercial' THEN 'same_day'
  WHEN overnight_allowed = true THEN 'next_day'
  ELSE 'same_day'
END
WHERE pickup_preference IS NULL;

-- Make it NOT NULL and add constraint
ALTER TABLE orders 
ALTER COLUMN pickup_preference SET NOT NULL;

ALTER TABLE orders
ADD CONSTRAINT orders_pickup_preference_check 
CHECK (pickup_preference IN ('same_day', 'next_day'));
