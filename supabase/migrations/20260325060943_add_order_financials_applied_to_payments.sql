/*
  # Add order_financials_applied flag to payments table

  ## Purpose
  Tracks whether the order financial fields (balance_paid_cents, balance_due_cents, tip_cents)
  have been successfully updated for a given payment row.

  ## Problem solved
  Previously, both reconcile-balance-payment and stripe-webhook used the existence of a payment
  row as proof that order totals were already applied. This was incorrect: if the mutex winner
  inserted the payment row but then failed to update the order (network error, DB timeout),
  the payment row existed but order totals were stale. On retry, both callers would see the
  existing row, skip financial repair entirely, and leave the order broken permanently.

  ## Solution
  - order_financials_applied defaults to FALSE on insert
  - The mutex winner sets it TRUE only after the order UPDATE succeeds
  - On 23505 (duplicate insert), the caller reads order_financials_applied:
      - TRUE  → financial work was completed by the prior winner; skip safely
      - FALSE → prior winner partially failed; this caller repairs order totals,
                then sets the flag to TRUE atomically

  ## Security
  - No RLS change needed; payments table policies are unchanged
  - The flag is internal to the payment processing pipeline only

  ## Tables modified
  - payments: add column order_financials_applied (boolean, default false, not null)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'order_financials_applied'
  ) THEN
    ALTER TABLE payments ADD COLUMN order_financials_applied boolean NOT NULL DEFAULT false;
  END IF;
END $$;
