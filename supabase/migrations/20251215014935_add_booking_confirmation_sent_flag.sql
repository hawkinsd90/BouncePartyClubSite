/*
  # Add Booking Confirmation Tracking

  ## Summary
  Adds a flag to the orders table to track whether booking confirmation
  notifications (email + SMS) have been sent. This prevents duplicate
  notifications when the payment complete page is reloaded.

  ## Changes Made

  1. **New Column**
     - `booking_confirmation_sent` (boolean, default false)
     - Tracks whether the initial booking confirmation has been sent
     - Set to true after first successful notification send

  2. **Use Case**
     - Prevents duplicate emails/SMS on page reload
     - Ensures customers only receive one confirmation
     - Simple, reliable tracking mechanism
*/

-- Add booking confirmation sent flag
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'booking_confirmation_sent'
  ) THEN
    ALTER TABLE orders ADD COLUMN booking_confirmation_sent boolean DEFAULT false;
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_booking_confirmation_sent 
  ON orders(booking_confirmation_sent) 
  WHERE booking_confirmation_sent = false;
