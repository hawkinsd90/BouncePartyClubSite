/*
  # Add void status to orders
  
  1. Changes
    - Update order status check constraint to include 'void' status
    - Void status is for orders that are no longer valid (e.g., availability conflicts)
  
  2. Notes
    - Void orders won't count against inventory
    - Can be used when payment link expires or availability check fails
*/

-- Drop existing constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add new constraint with void status
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('draft', 'pending_review', 'confirmed', 'in_progress', 'completed', 'cancelled', 'void'));
