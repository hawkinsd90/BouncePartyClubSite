/*
  # Remove Redundant Date Columns

  1. Purpose
    - Remove duplicate `start_date` and `end_date` columns from orders table
    - These columns were redundant with `event_date` and `event_end_date`
    - Clean up the schema to avoid confusion and maintenance issues

  2. Changes
    - Drop index `idx_orders_date_range` on (start_date, end_date)
    - Drop column `start_date` from orders table
    - Drop column `end_date` from orders table

  3. Notes
    - All references in codebase have been updated to use event_date/event_end_date
    - This migration is safe as the columns were just duplicates of event_date/event_end_date
    - No data loss as event_date and event_end_date contain the same information
*/

-- Drop the index on the redundant date columns
DROP INDEX IF EXISTS idx_orders_date_range;

-- Drop the redundant date columns
ALTER TABLE orders DROP COLUMN IF EXISTS start_date;
ALTER TABLE orders DROP COLUMN IF EXISTS end_date;
