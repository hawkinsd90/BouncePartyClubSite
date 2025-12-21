/*
  # Add Deposit Field to Pricing Rules

  1. Changes
    - Add `deposit_per_unit_cents` column to `pricing_rules` table
    - Set default value to 10000 (represents $100.00)
    
  2. Notes
    - This field represents the deposit amount charged per inflatable unit
    - Used throughout the system including in waivers and order calculations
    - Stored in cents to avoid floating point issues
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'deposit_per_unit_cents'
  ) THEN
    ALTER TABLE pricing_rules 
    ADD COLUMN deposit_per_unit_cents integer DEFAULT 10000;
  END IF;
END $$;