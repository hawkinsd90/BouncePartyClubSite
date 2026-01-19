/*
  # Add Tax Application Control

  1. Changes to `pricing_rules` table
    - Add `apply_taxes_by_default` boolean column to control automatic tax application
    - Defaults to `true` (taxes applied by default)
    - When false, taxes will not be automatically applied to new orders

  2. Purpose
    - Provides site-wide control over tax application
    - Individual orders can still override this setting via the `tax_waived` field
    - Allows flexibility for tax-exempt jurisdictions or special business cases

  3. Notes
    - This setting affects NEW orders only
    - Existing orders retain their current tax status
    - Per-order tax waiver functionality remains available via `tax_waived` field
*/

-- Add apply_taxes_by_default column to pricing_rules table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'apply_taxes_by_default'
  ) THEN
    ALTER TABLE pricing_rules ADD COLUMN apply_taxes_by_default boolean DEFAULT true;
  END IF;
END $$;

-- Set default value for existing records
UPDATE pricing_rules
SET apply_taxes_by_default = true
WHERE apply_taxes_by_default IS NULL;
