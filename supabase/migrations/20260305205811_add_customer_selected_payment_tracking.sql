/*
  # Add customer selected payment amount tracking

  1. Changes
    - Add `customer_selected_payment_cents` column to track what the customer chose to pay upfront
    - Add `customer_selected_payment_type` to track if they chose deposit/full/custom
    - Backfill existing orders with their deposit_due_cents value

  2. Purpose
    - Maintains customer's original payment preference even when order details change
    - Enables proper payment handling when admin edits orders
    - Supports price change reconciliation in approval flow
*/

-- Add customer selected payment amount columns
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS customer_selected_payment_cents INTEGER,
ADD COLUMN IF NOT EXISTS customer_selected_payment_type TEXT;

-- Backfill existing orders: set customer_selected_payment_cents to deposit_due_cents
-- This preserves what was originally agreed upon
UPDATE orders 
SET customer_selected_payment_cents = deposit_due_cents,
    customer_selected_payment_type = CASE
      WHEN deposit_due_cents >= (subtotal_cents + travel_fee_cents + surface_fee_cents + COALESCE(same_day_pickup_fee_cents, 0) + tax_cents) THEN 'full'
      ELSE 'deposit'
    END
WHERE customer_selected_payment_cents IS NULL;