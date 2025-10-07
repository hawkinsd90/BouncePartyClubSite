/*
  # Add Deposit Required Flag to Orders
  
  1. New Column
    - `deposit_required` (boolean, default true)
      - For bookings through website: always true (deposit must be paid)
      - For manual invoices: can be set to false (no deposit needed)
  
  2. Logic
    - Unpaid invoices: orders where deposit_required = true AND deposit_paid_cents = 0
    - Pending review: orders where deposit has been paid (deposit_paid_cents > 0)
    - Draft status is ONLY for unpaid invoices, NOT for orders that paid deposit
  
  3. Status Flow
    - draft: Invoice created, no payment made (only if deposit_required = true)
    - pending: Deposit paid, awaiting admin review
    - confirmed: Admin approved the booking
    - in_progress: Booking is active
    - completed: Event finished
    - cancelled: Booking cancelled
*/

-- Add deposit_required column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS deposit_required boolean DEFAULT true;

-- Update comment to reflect status flow
COMMENT ON COLUMN orders.status IS 'Order status: draft (unpaid invoice - no payment yet), pending (deposit paid, awaiting admin review), confirmed (admin approved), in_progress, completed, cancelled';

-- Ensure all existing orders have deposit_required set
UPDATE orders 
SET deposit_required = true 
WHERE deposit_required IS NULL;
