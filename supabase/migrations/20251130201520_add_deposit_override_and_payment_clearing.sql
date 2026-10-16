/*
  # Add Deposit Override and Payment Clearing

  1. Changes to `orders` table
    - Add `custom_deposit_cents` (integer, nullable) - Admin can override the calculated deposit
    - Add `clear_payment_info` (boolean, default false) - Flag to clear payment when deposit increases
    
  2. Purpose
    - Allows admin to accept current deposit even when calculated deposit increases
    - Tracks when payment info should be cleared (deposit increased beyond original)
    - Provides flexibility for admin to manage deposit requirements

  3. Notes
    - `custom_deposit_cents` = NULL means use calculated deposit
    - `clear_payment_info` = true triggers payment info clearing on customer approval
    - When units added, system sets this flag automatically
*/

-- Add custom deposit override field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'custom_deposit_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN custom_deposit_cents integer;
  END IF;
END $$;

-- Add payment clearing flag
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'clear_payment_info'
  ) THEN
    ALTER TABLE orders ADD COLUMN clear_payment_info boolean DEFAULT false;
  END IF;
END $$;

COMMENT ON COLUMN orders.custom_deposit_cents IS 'Admin override for deposit amount. NULL = use calculated deposit';
COMMENT ON COLUMN orders.clear_payment_info IS 'Flag indicating payment info should be cleared on next customer interaction';