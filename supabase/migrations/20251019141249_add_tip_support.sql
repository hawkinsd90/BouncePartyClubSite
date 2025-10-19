/*
  # Add Tip Support to Orders

  1. Changes
    - Add `tip_cents` column to `orders` table to track tips
    - Tips are separate from the balance and don't reduce the remaining amount due
    
  2. Notes
    - Tips are additive to the payment amount
    - When paying deposit + tip, balance_due_cents remains unchanged
    - When paying full amount + tip, tip is tracked separately
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'tip_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN tip_cents integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN orders.tip_cents IS 'Total tips received for this order in cents. Tips do not reduce balance due.';
