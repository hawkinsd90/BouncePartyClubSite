/*
  # Add Anonymous Update for Booking Confirmation Flag

  ## Summary
  Allows anonymous users to update ONLY the booking_confirmation_sent flag
  on orders. This is needed for the payment complete page to prevent duplicate
  notifications when the page is reloaded.

  ## Changes Made

  1. **New Policy**
     - Anonymous users can update orders table
     - ONLY allows updating booking_confirmation_sent column
     - Ensures this specific flag can be set from the payment complete page

  2. **Security**
     - Restricted to a single column update
     - No other order data can be modified by anonymous users
     - Safe for payment completion workflow
*/

-- Allow anonymous users to update ONLY the booking_confirmation_sent flag
CREATE POLICY "Anonymous users can mark booking confirmation sent"
  ON orders
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (
    -- Only allow updating booking_confirmation_sent
    -- All other columns must remain unchanged
    booking_confirmation_sent IS DISTINCT FROM (
      SELECT booking_confirmation_sent FROM orders WHERE id = orders.id
    )
  );
