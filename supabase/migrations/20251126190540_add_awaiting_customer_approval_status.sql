/*
  # Add Awaiting Customer Approval Status

  1. Changes
    - Add 'awaiting_customer_approval' to the order status enum
    - This status is used when admin edits an order and customer needs to review changes
  
  2. Security
    - No RLS changes needed
*/

-- Add the new status to the order status check constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status = ANY (ARRAY[
    'draft'::text, 
    'pending_review'::text, 
    'awaiting_customer_approval'::text,
    'confirmed'::text, 
    'in_progress'::text, 
    'completed'::text, 
    'cancelled'::text, 
    'void'::text
  ]));