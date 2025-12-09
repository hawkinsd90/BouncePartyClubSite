/*
  # Add Event Start Time and Pickup Time Fields

  1. New Columns
    - `event_start_time` (time) - What time the event starts
    - `pickup_time` (time) - What time pickup/drop-off should occur
  
  2. Purpose
    - Track specific times for event start and equipment pickup
    - Display on customer receipts and invoices
    - Help crew with scheduling

  3. Notes
    - Times are stored as TIME type (HH:MM:SS)
    - Both fields are optional (nullable)
    - Frontend should use time picker inputs
*/

-- Add event start time column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS event_start_time TIME;

-- Add pickup time column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS pickup_time TIME;

COMMENT ON COLUMN orders.event_start_time IS 'Time the customer event starts';
COMMENT ON COLUMN orders.pickup_time IS 'Preferred time for equipment pickup/drop-off';
