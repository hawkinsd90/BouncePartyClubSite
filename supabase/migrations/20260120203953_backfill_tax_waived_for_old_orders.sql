/*
  # Backfill tax_waived for Old Orders

  1. Purpose
    - Fix old orders that were created before the `apply_taxes_by_default` setting was added
    - These orders have tax applied (tax_cents > 0) but tax_waived = false
    - With the current setting of apply_taxes_by_default = false, these orders would incorrectly show no tax
    
  2. Changes
    - For orders where tax was charged (tax_cents > 0)
    - And tax_waived is false (no explicit override)
    - Set tax_waived = true to indicate tax should be applied (overriding the new default)
    - This preserves the existing tax amount for old orders
    
  3. Notes
    - This only affects orders created before the apply_taxes_by_default setting was implemented
    - New orders will use the setting correctly from creation
    - This ensures old orders display and calculate tax correctly
*/

-- Update old orders where tax was applied but tax_waived flag is false
-- This makes them compatible with apply_taxes_by_default = false
UPDATE orders
SET 
  tax_waived = true,
  tax_waive_reason = 'Auto-adjusted for compatibility with tax settings (order created before tax control feature)'
WHERE 
  tax_cents > 0 
  AND (tax_waived = false OR tax_waived IS NULL)
  AND created_at < '2026-01-19'::timestamptz;  -- Orders created before tax setting was added
