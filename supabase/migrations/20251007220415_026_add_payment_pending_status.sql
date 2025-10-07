/*
  # Add Payment Pending Status
  
  1. Updates
    - Add 'payment_pending' as a valid order status
    - This status indicates an order was created but payment hasn't been completed
    - These orders should be filtered out from admin views until payment succeeds
  
  2. Notes
    - Orders with 'payment_pending' status will be updated to 'pending' once payment succeeds
    - Failed or abandoned payments will remain in 'payment_pending' status
    - Admin can filter these out or clean them up periodically
*/

-- Add comment to explain the status field values
COMMENT ON COLUMN orders.status IS 'Order status: payment_pending (awaiting payment), pending (paid, awaiting processing), confirmed, in_progress, completed, cancelled';

-- Update any existing orders to ensure they have a valid status
UPDATE orders 
SET status = 'pending' 
WHERE status IS NULL OR status = '';
