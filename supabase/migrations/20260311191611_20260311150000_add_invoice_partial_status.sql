/*
  # Add Invoice Partial Payment Status

  1. Problem
    - Current invoice status only has: 'draft', 'sent', 'paid', 'cancelled'
    - When customer pays deposit (partial payment), invoice is incorrectly marked 'paid'
    - No way to distinguish fully-paid from partially-paid invoices
    - Financial reporting shows incorrect accounts receivable

  2. Solution
    - Add 'partial' status to invoices CHECK constraint
    - Allows proper tracking of invoices with partial payments
    - Enables accurate accounts receivable calculations

  3. Changes
    - Drop existing status CHECK constraint
    - Add new constraint with 'partial' status included
    - Update existing 'paid' invoices to 'partial' where paid_amount < total

  4. Safety
    - No breaking changes - all existing statuses remain valid
    - Backward compatible - 'paid' status still works
    - RLS policies unaffected
*/

-- Drop old constraint
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

-- Add new constraint with 'partial' status
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'cancelled'));

-- Update existing invoices that are marked 'paid' but only partially paid
-- This fixes historical data where deposit-only payments were marked as 'paid'
UPDATE invoices
SET status = 'partial'
WHERE status = 'paid'
  AND paid_amount_cents < total_cents;

-- Add helpful comment
COMMENT ON COLUMN invoices.status IS 
'Invoice payment status: draft (not sent), sent (awaiting payment), partial (deposit paid), paid (fully paid), cancelled (voided)';
