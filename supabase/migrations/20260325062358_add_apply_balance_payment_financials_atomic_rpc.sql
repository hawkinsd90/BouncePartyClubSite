/*
  # Add apply_balance_payment_financials atomic RPC

  ## Summary
  Replaces the previous claim_balance_payment_financials CAS-only RPC with a
  fully transactional function that:
    1. Locks the payment row (SELECT ... FOR UPDATE)
    2. Checks if order_financials_applied is already TRUE
    3. If not: reads current order totals, applies balance/tip deltas, marks row applied
    4. Returns whether this call was the one that did the work

  ## Why this fixes the inserter-vs-repair race
  The previous approach used claim_balance_payment_financials which set
  order_financials_applied = TRUE atomically — but the original inserter could
  still be between its INSERT (which set the flag FALSE) and its own UPDATE orders
  call. A repair claimer could grab the flag in that window and race with the
  original inserter, causing two concurrent writes to orders.

  This function eliminates that window entirely. ALL financial application —
  whether by the original winner or by a repair caller — happens inside this
  function under a row lock. No application code reads orders, computes deltas,
  and writes orders independently.

  ## Flow for all three callers
  - checkout.session.completed: insert row → call this RPC (works every time)
  - reconcile-balance-payment:  insert row → call this RPC (works every time)
  - payment_intent.succeeded:   call this RPC directly (no insert needed)

  In all cases: the RPC is the sole writer of balance_paid_cents / tip_cents /
  balance_due_cents for a given PaymentIntent.

  ## Parameters
  - p_pi_id:          stripe_payment_intent_id to target
  - p_order_id:       order to update
  - p_balance_cents:  amount to credit (excluding tip)
  - p_tip_cents:      tip to add (0 if none)
  - p_pm_id:          stripe payment method id (non-financial, always written)
  - p_customer_id:    stripe customer id (non-financial, always written)

  ## Returns
  - applied (BOOLEAN): TRUE if this call applied financials, FALSE if already done
  - payment_row_found (BOOLEAN): FALSE if no payment row exists for this PI

  ## Security
  SECURITY DEFINER, fixed search_path, granted to service_role only.
*/

CREATE OR REPLACE FUNCTION public.apply_balance_payment_financials(
  p_pi_id        TEXT,
  p_order_id     UUID,
  p_balance_cents INTEGER,
  p_tip_cents     INTEGER,
  p_pm_id         TEXT DEFAULT NULL,
  p_customer_id   TEXT DEFAULT NULL
)
RETURNS TABLE(applied BOOLEAN, payment_row_found BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id             UUID;
  v_already_applied        BOOLEAN;
  v_balance_paid_cents     INTEGER;
  v_balance_due_cents      INTEGER;
  v_tip_cents              INTEGER;
BEGIN
  -- Step 1: Lock the payment row for the duration of this transaction.
  -- FOR UPDATE blocks any concurrent caller until we commit or rollback.
  -- If no row exists (PI not yet inserted) we return payment_row_found=FALSE.
  SELECT id, order_financials_applied
    INTO v_payment_id, v_already_applied
    FROM payments
    WHERE stripe_payment_intent_id = p_pi_id
    FOR UPDATE;

  IF v_payment_id IS NULL THEN
    -- No payment row yet — the owning inserter hasn't run yet.
    -- Caller must not apply financials; let the inserter do it via this same RPC.
    RETURN QUERY SELECT FALSE, FALSE;
    RETURN;
  END IF;

  IF v_already_applied THEN
    -- Financials already applied by a previous caller. Nothing to do.
    -- Still patch non-financial fields idempotently.
    UPDATE orders SET
      stripe_payment_method_id = COALESCE(p_pm_id,        stripe_payment_method_id),
      stripe_customer_id       = COALESCE(p_customer_id,  stripe_customer_id)
    WHERE id = p_order_id;
    RETURN QUERY SELECT FALSE, TRUE;
    RETURN;
  END IF;

  -- Step 2: Read current order totals while holding the payment row lock.
  -- We do NOT lock the order row; instead we rely on the payment row lock as
  -- the single serialisation point — all writers must pass through this function.
  SELECT balance_paid_cents, balance_due_cents, tip_cents
    INTO v_balance_paid_cents, v_balance_due_cents, v_tip_cents
    FROM orders
    WHERE id = p_order_id;

  -- Step 3: Apply the financial delta exactly once.
  UPDATE orders SET
    balance_paid_cents       = COALESCE(v_balance_paid_cents, 0) + p_balance_cents,
    balance_due_cents        = GREATEST(0, COALESCE(v_balance_due_cents, 0) - p_balance_cents),
    tip_cents                = CASE WHEN p_tip_cents > 0
                                    THEN COALESCE(v_tip_cents, 0) + p_tip_cents
                                    ELSE COALESCE(v_tip_cents, 0)
                               END,
    stripe_payment_method_id = COALESCE(p_pm_id,       stripe_payment_method_id),
    stripe_customer_id       = COALESCE(p_customer_id, stripe_customer_id)
  WHERE id = p_order_id;

  -- Step 4: Mark the payment row as applied — inside the same transaction.
  -- If the UPDATE orders above failed (exception), this line never runs and the
  -- row remains FALSE so the next caller retries.
  UPDATE payments
    SET order_financials_applied = TRUE
    WHERE id = v_payment_id;

  RETURN QUERY SELECT TRUE, TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_balance_payment_financials(TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT) TO service_role;

-- Keep the old CAS RPC in place temporarily so any in-flight deploys that still
-- reference it don't crash. It is now a no-op wrapper (always returns claimed=false)
-- and will be dropped once all callers are updated.
CREATE OR REPLACE FUNCTION public.claim_balance_payment_financials(p_pi_id TEXT)
RETURNS TABLE(claimed BOOLEAN, payment_id UUID, amount_cents INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Deprecated: all callers now use apply_balance_payment_financials instead.
  -- Returns claimed=false so legacy callers fall through to the non-financial patch path.
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::INTEGER;
END;
$$;
