/*
  # Fix Tax Waived Backfill Logic
  
  1. Problem
    - Previous migration set tax_waived = true for orders with tax_cents > 0
    - This causes UI to show "WAIVED" badge even though tax is applied
    - The tax_waived flag should only be true when forcing recalculation
    
  2. Solution
    - Revert tax_waived = false for orders that already have tax applied
    - Remove the auto-generated tax_waive_reason
    - Orders with existing tax_cents don't need any override flag
    
  3. Impact
    - Fixes 211 orders showing incorrect "WAIVED" badge
    - Tax amounts remain unchanged (still calculated and charged correctly)
    - UI now correctly reflects that tax is applied, not waived
*/

-- Revert tax_waived for orders that already have tax charged
UPDATE orders
SET 
  tax_waived = false,
  tax_waive_reason = NULL
WHERE 
  tax_cents > 0 
  AND tax_waived = true
  AND tax_waive_reason = 'Auto-adjusted for compatibility with tax settings (order created before tax control feature)';
