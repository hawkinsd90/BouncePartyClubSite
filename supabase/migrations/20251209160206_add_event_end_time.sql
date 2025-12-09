/*
  # Add Event End Time Field

  1. New Column
    - `event_end_time` (time) - What time the event ends
  
  2. Purpose
    - Track when the event is scheduled to end
    - Display complete event schedule on receipts and invoices
    - Help with pickup scheduling

  3. Notes
    - Time is stored as TIME type (HH:MM:SS)
    - Field is optional (nullable)
    - Complements existing event_start_time field
*/

-- Add event end time column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS event_end_time TIME;

COMMENT ON COLUMN orders.event_end_time IS 'Time the customer event ends';