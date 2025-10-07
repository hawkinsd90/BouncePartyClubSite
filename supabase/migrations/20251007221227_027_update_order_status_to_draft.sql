/*
  # Update Order Status to Draft for Unpaid Invoices
  
  1. Changes
    - Rename 'payment_pending' status to 'draft' to better represent unpaid invoices
    - These are essentially drafted invoices that need payment
    - Units are NOT reserved for draft orders - they can be booked by others
    - Draft orders can be paid via shareable link
  
  2. Status Flow
    - draft: Invoice created, awaiting payment (units not reserved)
    - pending: Payment received, awaiting admin review/confirmation
    - confirmed: Admin confirmed the booking
    - cancelled: Booking cancelled
*/

-- Update comment to reflect new status flow
COMMENT ON COLUMN orders.status IS 'Order status: draft (unpaid invoice), pending (paid, awaiting review), confirmed, in_progress, completed, cancelled';

-- Update any existing payment_pending orders to draft
UPDATE orders 
SET status = 'draft' 
WHERE status = 'payment_pending';
