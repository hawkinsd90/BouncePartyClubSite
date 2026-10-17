/*
  # Add customer selected payment amount field

  1. Changes
    - Add `customer_selected_payment_cents` column to track what the customer chose to pay upfront
    - This helps maintain their payment preference even when order details change
    - Add `customer_selected_payment_type` to track if they chose deposit/full/custom
*/

-- Add customer selected payment amount
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS customer_selected_payment_cents INTEGER,
ADD COLUMN IF NOT EXISTS customer_selected_payment_type TEXT;

-- Update existing orders to set this based on deposit_due_cents
UPDATE orders 
SET customer_selected_payment_cents = deposit_due_cents,
    customer_selected_payment_type = 'deposit'
WHERE customer_selected_payment_cents IS NULL;
