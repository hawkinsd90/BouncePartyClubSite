/*
  # Add generator_fee_cents to invoices table

  ## Problem
  The invoices table tracks individual fee breakdown columns (travel_fee_cents, surface_fee_cents,
  same_day_pickup_fee_cents) but was missing generator_fee_cents. This caused the stored invoice
  breakdown to be incomplete for orders that include a generator rental, even though total_cents
  correctly includes the generator fee.

  ## Changes

  ### Modified tables
  - `invoices`
    - Add `generator_fee_cents` (integer, DEFAULT 0): stores the generator rental fee component
      so the persisted invoice breakdown fully reconciles with total_cents.

  ## Notes
  - Additive column with DEFAULT 0 — no existing rows are affected
  - Existing invoices will show generator_fee_cents = 0 (historically these orders either had
    no generator, or the fee was silently absorbed into total_cents without a breakdown column)
  - No RLS changes needed — existing invoice policies cover all columns on the table
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'generator_fee_cents'
  ) THEN
    ALTER TABLE invoices ADD COLUMN generator_fee_cents integer DEFAULT 0;
  END IF;
END $$;
