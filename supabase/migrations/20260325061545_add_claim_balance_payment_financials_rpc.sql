/*
  # Add claim_balance_payment_financials RPC

  ## Purpose
  Provides an atomic, single-statement ownership claim over the financial repair
  of a balance payment row. Eliminates the TOCTOU (read-then-update) race where two
  concurrent callers could both read order_financials_applied=FALSE and both apply
  order financial mutations.

  ## How it works
  The function issues:
    UPDATE payments
      SET order_financials_applied = TRUE
      WHERE stripe_payment_intent_id = $1
        AND order_financials_applied = FALSE
      RETURNING id, amount_cents;

  Because the WHERE clause includes the flag condition and PostgreSQL applies
  row-level locking during the UPDATE, exactly one concurrent caller will get a
  non-empty result. All other callers receive an empty result set and must skip
  financial application. This is a compare-and-set (CAS) in a single statement.

  ## Returns
  - claimed: true   → this caller now owns financial application; proceed with order UPDATE
  - claimed: false  → another caller already owns it (or work was already done); skip
  - payment_id      → id of the payment row (only when claimed=true)
  - amount_cents    → stored amount on the row (only when claimed=true)

  ## Security
  - SECURITY DEFINER so it can be called from edge functions using the service role key
  - search_path is fixed to prevent injection via schema search
*/

CREATE OR REPLACE FUNCTION public.claim_balance_payment_financials(p_pi_id TEXT)
RETURNS TABLE(claimed BOOLEAN, payment_id UUID, amount_cents INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
  v_amount_cents INTEGER;
BEGIN
  UPDATE payments p
    SET order_financials_applied = TRUE
    WHERE p.stripe_payment_intent_id = p_pi_id
      AND p.order_financials_applied = FALSE
  RETURNING p.id, p.amount_cents
  INTO v_payment_id, v_amount_cents;

  IF v_payment_id IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_payment_id, v_amount_cents;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::INTEGER;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_balance_payment_financials(TEXT) TO service_role;
