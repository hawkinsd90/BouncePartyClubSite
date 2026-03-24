/*
  # Add notes column to order_changelog

  ## Summary
  Adds a nullable `notes` text column to the `order_changelog` table.

  ## Why
  The `charge-deposit` edge function writes a PARTIAL_CHARGE_FAILURE record to
  `order_changelog` with a `notes` field containing the Stripe PaymentIntent ID
  and DB error message. Without this column the insert throws a Postgres error,
  which is silently swallowed — leaving admins with no queryable record when a
  Stripe charge succeeds but the subsequent DB update fails.

  ## Changes
  - `order_changelog`: adds nullable `notes text` column

  ## Security
  No RLS changes required — existing policies are unchanged.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_changelog' AND column_name = 'notes'
  ) THEN
    ALTER TABLE order_changelog ADD COLUMN notes text;
  END IF;
END $$;
