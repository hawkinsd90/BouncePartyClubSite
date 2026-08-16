/*
# Add dedicated payment_lock column to orders

1. Purpose
- The charge-deposit edge function uses `deposit_paid_cents = -1` as a sentinel
  to prevent concurrent double-charges. However, this sentinel only works when
  `deposit_paid_cents` is 0 or NULL. Once a deposit has been paid (e.g. 5000 cents),
  the sentinel check `.lte("deposit_paid_cents", 0)` fails, blocking ALL subsequent
  charges — including legitimate balance charges from the admin calendar.
- This migration adds a dedicated `payment_lock` boolean column so the race guard
  is independent of the actual payment amount.

2. New Columns on `orders`
- `payment_lock` boolean NOT NULL DEFAULT false — when true, a charge is in progress.
  The charge-deposit function atomically sets this to true (only if currently false)
  before calling Stripe, and sets it back to false when done.

3. Data Safety
- No existing columns are changed or removed.
- `deposit_paid_cents` is left untouched.
- All existing rows default to `payment_lock = false`.
- The old sentinel logic in charge-deposit will be updated to use this column instead.
*/

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_lock boolean NOT NULL DEFAULT false;

-- Backfill: ensure all existing orders have payment_lock = false
UPDATE public.orders SET payment_lock = false WHERE payment_lock IS NULL;

-- Grant service_role (already has full access, but ensure idempotency)
GRANT UPDATE ON TABLE public.orders TO service_role;