/*
# Add Event Essentials-Only Deposit Settings to pricing_rules

1. Purpose
   Adds four configurable columns to the existing `pricing_rules` table
   that control the required deposit for orders containing zero inflatables
   and one or more Event Essential products or packages.

2. New Columns on `pricing_rules`
   - `ee_only_deposit_base_threshold_cents` (integer, default 20000 = $200.00)
     The EE subtotal at or below which the base deposit applies.
   - `ee_only_deposit_base_cents` (integer, default 5000 = $50.00)
     The required deposit when EE subtotal is at or below the base threshold.
   - `ee_only_deposit_subtotal_step_cents` (integer, default 10000 = $100.00)
     Each additional $100 of EE subtotal adds one more deposit tier.
   - `ee_only_deposit_step_cents` (integer, default 5000 = $50.00)
     The additional deposit amount per tier.

3. Backfill
   All existing `pricing_rules` rows are updated with the default values
   so the system works immediately without manual configuration.

4. Security
   No RLS changes — `pricing_rules` already has admin-only policies.

5. Important Notes
   - These settings do NOT apply to orders containing inflatables.
   - Changing settings does NOT retroactively change stored order deposits.
   - The authoritative calculation lives in `src/lib/depositCalculation.ts`.
*/

ALTER TABLE pricing_rules
  ADD COLUMN IF NOT EXISTS ee_only_deposit_base_threshold_cents integer DEFAULT 20000,
  ADD COLUMN IF NOT EXISTS ee_only_deposit_base_cents integer DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS ee_only_deposit_subtotal_step_cents integer DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS ee_only_deposit_step_cents integer DEFAULT 5000;

-- Backfill defaults for existing rows
UPDATE pricing_rules
  SET ee_only_deposit_base_threshold_cents = COALESCE(ee_only_deposit_base_threshold_cents, 20000),
      ee_only_deposit_base_cents = COALESCE(ee_only_deposit_base_cents, 5000),
      ee_only_deposit_subtotal_step_cents = COALESCE(ee_only_deposit_subtotal_step_cents, 10000),
      ee_only_deposit_step_cents = COALESCE(ee_only_deposit_step_cents, 5000);
