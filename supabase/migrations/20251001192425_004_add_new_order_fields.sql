/*
  # Add New Order and Pricing Fields

  1. Orders Table Updates
    - Add start_date and end_date for multi-day rentals
    - Add overnight_allowed flag
    - Add can_use_stakes flag for grass surface
    - Add generator_selected flag
    - Rename/clarify existing fee columns

  2. Pricing Rules Updates
    - Update surface_sandbag_fee_cents default to 3000 ($30)
    - Add extra_day_pct for multi-day pricing (default 50%)

  3. Notes
    - start_date defaults to event_date for single-day rentals
    - end_date defaults to event_date for single-day rentals
    - overnight_allowed defaults to true for residential, false for commercial
*/

-- Add new columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS overnight_allowed boolean DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS can_use_stakes boolean DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS generator_selected boolean DEFAULT false;

-- Update existing orders to have start_date and end_date from event_date
UPDATE orders 
SET start_date = event_date, end_date = event_date 
WHERE start_date IS NULL;

-- Make start_date and end_date non-nullable after backfilling
ALTER TABLE orders ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE orders ALTER COLUMN end_date SET NOT NULL;

-- Add extra_day_pct to pricing_rules
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS extra_day_pct decimal(5,2) DEFAULT 50.00;

-- Update sandbag fee to $30 (3000 cents)
UPDATE pricing_rules SET surface_sandbag_fee_cents = 3000;

-- Add index for date range queries
CREATE INDEX IF NOT EXISTS idx_orders_date_range ON orders(start_date, end_date);
