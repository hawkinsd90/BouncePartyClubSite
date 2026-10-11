/*
  # Deposit catch-up, and one remaining-principal truth for cash and check

  ## Why
  1. A deposit that was RAISED after part of it was paid used to be refused outright (`catch_up_required`) because the whole
     deposit could not be charged again without double charging. The remaining deposit is now collected - and only the
     remaining deposit:

       remaining deposit = max(0, required deposit - deposit principal already paid)

     Never negative (a lowered deposit owes nothing; nothing is refunded here), never the original deposit again, never a tip,
     never balance principal counted as deposit.

  2. "Deposit principal already paid" is taken from the payment components of the ledger (deposit_principal_cents), not guessed.
     `payment_deposit_principal_state` answers it and FAILS CLOSED:
       - a payment whose components were never recorded (every payment before payment operations existed) cannot be classified
         as deposit or balance principal or tip: `unclassified_payment`;
       - a ledger that disagrees with orders.deposit_paid_cents: `ledger_conflict`;
       - a payment that succeeded but was never applied to the order: `unapplied_payment`;
       - any refund activity: `refund_reconciliation_required` (refund-aware reconciliation is a later batch).
     In each case the claim answers `catch_up_unavailable` and no charge is made; the order needs Admin review.

  3. Cash and check payments recorded money against a total they derived themselves (missing the Setup Fee and the weekday
     delivery fee, ignoring percentage discounts), subtracted the balance already paid twice, classified the whole payment as a
     deposit whenever nothing of the deposit was paid, and accepted ANY amount once the balance was zero. They now:
       - use the same stored financial state the card path uses (remaining deposit + balance due);
       - refuse an amount above the remaining principal, always (anything extra is a TIP, entered as a tip);
       - split the payment into deposit and balance principal and record those components, like an online payment;
       - refuse to run while an online payment operation is open for the order.

  ## Not changed
  The payment-operation tables, columns, indexes, claim/lease/finalize behavior, the state barrier, and every historical row.
  No order total is recomputed or rewritten; nothing is backfilled.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- payment_deposit_principal_state
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_deposit_principal_state(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_dp integer;
  v_refunded integer;
  v_sum bigint;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT COALESCE(deposit_paid_cents, 0), COALESCE(total_refunded_cents, 0)
    INTO v_order_dp, v_refunded
  FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_refunded > 0 OR EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.order_id = p_order_id AND (p.refunded_payment_id IS NOT NULL OR p.amount_cents < 0)
  ) THEN
    RETURN jsonb_build_object('status', 'refund_reconciliation_required', 'order_deposit_paid_cents', v_order_dp);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.deposit_principal_cents IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'unclassified_payment', 'order_deposit_paid_cents', v_order_dp);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0 AND COALESCE(p.order_financials_applied, false) = false
  ) THEN
    RETURN jsonb_build_object('status', 'unapplied_payment', 'order_deposit_paid_cents', v_order_dp);
  END IF;

  SELECT COALESCE(SUM(p.deposit_principal_cents), 0) INTO v_sum
  FROM public.payments p
  WHERE p.order_id = p_order_id AND p.status = 'succeeded' AND p.amount_cents > 0;

  IF v_sum <> v_order_dp THEN
    RETURN jsonb_build_object('status', 'ledger_conflict', 'ledger_deposit_principal_cents', v_sum, 'order_deposit_paid_cents', v_order_dp);
  END IF;

  RETURN jsonb_build_object('status', 'known', 'deposit_principal_paid_cents', v_sum);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- claim_payment_operation (the deposit branch now collects a catch-up; everything else is as before)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_payment_operation(
  p_order_id uuid,
  p_purpose text,
  p_actor text,
  p_claim_id uuid,
  p_use_selection boolean DEFAULT false,
  p_requested_principal_cents integer DEFAULT NULL,
  p_requested_tip_cents integer DEFAULT NULL,
  p_expected_deposit_due_cents integer DEFAULT NULL,
  p_stale_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_op public.payments%ROWTYPE;
  v_has_op boolean := false;
  v_op_json jsonb;
  v_err jsonb := NULL;
  v_dd integer;
  v_dp integer;
  v_bd integer;
  v_principal integer;
  v_dep_comp integer := 0;
  v_dep_rem integer := 0;
  v_paid integer := 0;
  v_state jsonb;
  v_bal_comp integer := 0;
  v_tip integer;
  v_gross integer;
  v_sel_type text;
  v_sel_cents integer;
  v_legacy boolean;
  v_charged_tip integer;
  v_id uuid;
  v_key text;
  v_max constant integer := 99999999;
BEGIN
  IF p_order_id IS NULL OR p_claim_id IS NULL OR p_stale_seconds IS NULL OR p_stale_seconds < 60
     OR COALESCE(p_purpose, '') NOT IN ('deposit', 'balance')
     OR COALESCE(p_actor, '') NOT IN ('staff', 'customer') THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  IF (p_requested_principal_cents IS NOT NULL AND (p_requested_principal_cents < 0 OR p_requested_principal_cents > v_max))
     OR (p_requested_tip_cents IS NOT NULL AND (p_requested_tip_cents < 0 OR p_requested_tip_cents > v_max)) THEN
    RETURN jsonb_build_object('outcome', 'invalid_amount');
  END IF;

  -- The order row lock is the serialization point: concurrent claims for one order take turns.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- An open operation always wins over starting a new one: a retry, a double click and a crashed request converge on it.
  -- But it is resumed only if the order still authorizes it (checked below).
  SELECT * INTO v_op
  FROM public.payments
  WHERE order_id = p_order_id AND operation_key IS NOT NULL AND status = 'pending'
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;
  v_has_op := FOUND;

  IF v_has_op THEN
    IF v_op.type <> p_purpose THEN
      RETURN jsonb_build_object('outcome', 'busy', 'reason', 'other_operation_pending', 'payment_id', v_op.id);
    END IF;
    IF v_op.claim_id IS NOT NULL
       AND v_op.claim_id <> p_claim_id
       AND v_op.claimed_at IS NOT NULL
       AND v_op.claimed_at > now() - make_interval(secs => p_stale_seconds) THEN
      RETURN jsonb_build_object('outcome', 'busy', 'reason', 'operation_in_progress', 'payment_id', v_op.id);
    END IF;

    UPDATE public.payments SET claim_id = p_claim_id, claimed_at = now() WHERE id = v_op.id;
    v_op_json := jsonb_build_object(
      'payment_id', v_op.id,
      'operation_key', v_op.operation_key,
      'claim_id', p_claim_id,
      'payment_type', v_op.type,
      'principal_cents', v_op.principal_amount_cents,
      'deposit_principal_cents', v_op.deposit_principal_cents,
      'balance_principal_cents', v_op.balance_principal_cents,
      'tip_cents', v_op.tip_amount_cents,
      'gross_cents', v_op.amount_cents,
      'provider_payment_intent_id', v_op.stripe_payment_intent_id,
      'checkout_session_id', v_op.stripe_checkout_session_id,
      'provider_attempted_at', v_op.provider_attempted_at,
      'order_status', v_order.status,
      'created_at', v_op.created_at
    );

    IF v_op.stripe_payment_intent_id IS NOT NULL THEN
      -- A provider charge already exists for this operation. No NEW charge can come from resuming it: the caller reads the
      -- existing PaymentIntent and reconciles whatever it actually did.
      RETURN v_op_json || jsonb_build_object('outcome', 'resumed', 'provider_known', true);
    END IF;
  END IF;

  v_dd := COALESCE(v_order.deposit_due_cents, 0);
  v_dp := COALESCE(v_order.deposit_paid_cents, 0);
  v_bd := GREATEST(0, COALESCE(v_order.balance_due_cents, 0));

  -- What the order authorizes right now. The same derivation serves a new operation and the check of an open one.
  <<derive>>
  LOOP
    IF p_purpose = 'deposit' THEN
      -- Which orders may start a deposit charge, and for whom.
      IF p_actor = 'staff' THEN
        IF v_order.status <> 'pending_review' THEN
          v_err := jsonb_build_object('outcome', 'invalid_status', 'order_status', v_order.status);
          EXIT derive;
        END IF;
      ELSE
        IF v_order.status = 'awaiting_customer_approval' THEN
          NULL;
        ELSIF v_order.status = 'draft' AND EXISTS (SELECT 1 FROM public.invoice_links il WHERE il.order_id = p_order_id AND il.link_type = 'invoice') THEN
          NULL;
        ELSE
          v_err := jsonb_build_object('outcome', 'invalid_status', 'order_status', v_order.status);
          EXIT derive;
        END IF;
      END IF;

      IF p_expected_deposit_due_cents IS NOT NULL AND p_expected_deposit_due_cents <> v_dd THEN
        v_err := jsonb_build_object('outcome', 'order_changed', 'deposit_due_cents', v_dd);
        EXIT derive;
      END IF;

      IF v_dd <= 0 THEN
        v_err := jsonb_build_object('outcome', 'no_deposit_due');
        EXIT derive;
      END IF;

      IF v_dp >= v_dd THEN
        v_err := jsonb_build_object('outcome', 'already_paid');
        EXIT derive;
      END IF;

      IF v_dp > 0 THEN
        -- Part of the deposit is already paid: this is a CATCH-UP, and only the REMAINING deposit may be collected. That is
        -- computable only when every payment is classified into deposit principal, balance principal and tip; if it is not,
        -- nothing is guessed and nothing is charged.
        v_state := public.payment_deposit_principal_state(p_order_id);
        IF COALESCE(v_state->>'status', '') <> 'known' THEN
          v_err := jsonb_build_object('outcome', 'catch_up_unavailable', 'reason', COALESCE(v_state->>'status', 'unknown'),
                                      'deposit_due_cents', v_dd, 'deposit_paid_cents', v_dp);
          EXIT derive;
        END IF;
        v_dp := (v_state->>'deposit_principal_paid_cents')::integer;
      ELSIF EXISTS (SELECT 1 FROM public.payments pd WHERE pd.order_id = p_order_id AND pd.type = 'deposit' AND pd.status = 'succeeded' AND pd.amount_cents > 0) THEN
        -- A deposit payment exists in the ledger while the order says nothing was paid: the records disagree.
        v_err := jsonb_build_object('outcome', 'ledger_conflict');
        EXIT derive;
      END IF;

      -- What is left of the required deposit (the whole requirement when nothing is paid). v_dp < v_dd here, so it is positive.
      v_dep_rem := GREATEST(0, v_dd - v_dp);
      IF v_dep_rem <= 0 THEN
        v_err := jsonb_build_object('outcome', 'already_paid');
        EXIT derive;
      END IF;

      IF p_use_selection THEN
        v_sel_type := COALESCE(NULLIF(v_order.customer_selected_payment_type, ''), 'deposit');
        v_sel_cents := v_order.customer_selected_payment_cents;
        IF v_sel_type = 'deposit' THEN
          v_dep_comp := v_dep_rem;
          v_bal_comp := 0;
        ELSIF v_sel_type = 'full' THEN
          v_dep_comp := v_dep_rem;
          v_bal_comp := v_bd;
        ELSIF v_sel_type = 'custom' THEN
          -- A Custom selection is the principal the order should have received IN TOTAL (what the screen offers: at least the
          -- deposit, at most the order total). What is charged now is that, less the principal already paid. It must cover the
          -- remaining deposit and cannot exceed the remaining principal.
          v_paid := v_dp + COALESCE(v_order.balance_paid_cents, 0);
          IF v_sel_cents IS NULL OR v_sel_cents - v_paid < v_dep_rem OR v_sel_cents - v_paid > v_dep_rem + v_bd THEN
            v_err := jsonb_build_object('outcome', 'selection_invalid');
            EXIT derive;
          END IF;
          -- The deposit is satisfied first; only the rest is balance.
          v_dep_comp := LEAST(v_sel_cents - v_paid, v_dep_rem);
          v_bal_comp := (v_sel_cents - v_paid) - v_dep_comp;
        ELSE
          v_err := jsonb_build_object('outcome', 'selection_invalid');
          EXIT derive;
        END IF;
      ELSE
        v_dep_comp := v_dep_rem;
        v_bal_comp := 0;
      END IF;
      v_principal := v_dep_comp + v_bal_comp;

      IF p_requested_tip_cents IS NOT NULL THEN
        v_tip := p_requested_tip_cents;
      ELSE
        -- The stored tip is a selection made earlier. It is charged now only if no earlier operation has charged it and the
        -- ledger holds nothing we cannot classify (old rows do not say how much of a payment was tip).
        SELECT EXISTS (SELECT 1 FROM public.payments pl WHERE pl.order_id = p_order_id AND pl.status = 'succeeded' AND pl.amount_cents > 0 AND pl.principal_amount_cents IS NULL)
          INTO v_legacy;
        SELECT COALESCE(SUM(pt.tip_amount_cents), 0) INTO v_charged_tip
          FROM public.payments pt WHERE pt.order_id = p_order_id AND pt.status = 'succeeded' AND pt.tip_amount_cents IS NOT NULL;
        IF v_legacy THEN
          v_tip := 0;
        ELSE
          v_tip := GREATEST(0, COALESCE(v_order.tip_cents, 0) - v_charged_tip);
        END IF;
      END IF;
    ELSE
      -- balance
      IF v_order.status NOT IN ('confirmed', 'in_progress', 'completed') THEN
        v_err := jsonb_build_object('outcome', 'invalid_status', 'order_status', v_order.status);
        EXIT derive;
      END IF;
      IF p_requested_principal_cents IS NULL THEN
        v_err := jsonb_build_object('outcome', 'invalid_amount');
        EXIT derive;
      END IF;
      IF p_requested_principal_cents > v_bd THEN
        v_err := jsonb_build_object('outcome', 'over_balance', 'balance_due_cents', v_bd);
        EXIT derive;
      END IF;
      v_dep_comp := 0;
      v_bal_comp := p_requested_principal_cents;
      v_principal := v_bal_comp;
      v_tip := COALESCE(p_requested_tip_cents, 0);
    END IF;

    v_gross := v_principal + v_tip;
    IF v_gross <= 0 OR v_gross > v_max THEN
      v_err := jsonb_build_object('outcome', 'invalid_amount');
    END IF;
    EXIT derive;
  END LOOP;

  IF v_has_op THEN
    -- The open operation has not reached the provider (no PaymentIntent is recorded). It may continue only if the order still
    -- authorizes exactly this operation. Anything else is a STALE operation: the caller must not charge it.
    IF v_err IS NOT NULL THEN
      RETURN v_op_json || jsonb_build_object('outcome', 'stale_operation', 'reason', v_err->>'outcome', 'detail', v_err);
    END IF;
    IF v_op.principal_amount_cents IS DISTINCT FROM v_principal
       OR v_op.deposit_principal_cents IS DISTINCT FROM v_dep_comp
       OR v_op.balance_principal_cents IS DISTINCT FROM v_bal_comp
       OR v_op.tip_amount_cents IS DISTINCT FROM v_tip THEN
      RETURN v_op_json || jsonb_build_object('outcome', 'stale_operation', 'reason', 'order_changed');
    END IF;
    RETURN v_op_json || jsonb_build_object('outcome', 'resumed');
  END IF;

  IF v_err IS NOT NULL THEN
    IF v_err->>'outcome' = 'already_paid' THEN
      -- Already collected: nothing to charge. The order is moved forward in the same transaction.
      IF v_order.status IN ('draft', 'quote', 'pending_review', 'awaiting_customer_approval') THEN
        UPDATE public.orders SET status = 'confirmed' WHERE id = p_order_id;
        RETURN jsonb_build_object('outcome', 'already_paid', 'status_changed', true, 'order_status', 'confirmed');
      END IF;
      RETURN jsonb_build_object('outcome', 'already_paid', 'status_changed', false, 'order_status', v_order.status);
    END IF;
    RETURN v_err;
  END IF;

  v_id := gen_random_uuid();
  v_key := 'bpc-pay-' || p_order_id::text || '-' || p_purpose || '-' || v_id::text;

  INSERT INTO public.payments (
    id, order_id, type, amount_cents, status, currency, operation_key,
    principal_amount_cents, deposit_principal_cents, balance_principal_cents, tip_amount_cents,
    claim_id, claimed_at, order_financials_applied
  ) VALUES (
    v_id, p_order_id, p_purpose, v_gross, 'pending', 'usd', v_key,
    v_principal, v_dep_comp, v_bal_comp, v_tip,
    p_claim_id, now(), false
  );

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'payment_id', v_id,
    'operation_key', v_key,
    'claim_id', p_claim_id,
    'payment_type', p_purpose,
    'principal_cents', v_principal,
    'deposit_principal_cents', v_dep_comp,
    'balance_principal_cents', v_bal_comp,
    'tip_cents', v_tip,
    'gross_cents', v_gross,
    'provider_payment_intent_id', NULL,
    'checkout_session_id', NULL,
    'provider_attempted_at', NULL,
    'order_status', v_order.status
  );
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Offline (cash / check) payments
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_offline_payment(
  p_order_id       uuid,
  p_amount_cents   integer,
  p_tip_cents      integer,
  p_acting_user_id uuid,
  p_method         text,
  p_check_number   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order           public.orders%ROWTYPE;
  v_dd              integer;
  v_dp              integer;
  v_bd              integer;
  v_dep_rem         integer;
  v_remaining       integer;
  v_dep_comp        integer;
  v_bal_comp        integer;
  v_tip             integer;
  v_payment_type    text;
  v_new_status      text;
  v_payment_id      uuid;
  v_new_balance_due integer;
  v_new_dp          integer;
  v_max constant integer := 99999999;
  v_change_type     text;
BEGIN
  IF p_method NOT IN ('cash', 'check') THEN
    RAISE EXCEPTION 'Unsupported offline payment method';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > v_max THEN
    RAISE EXCEPTION 'amount_cents must be greater than zero';
  END IF;
  -- A tip is zero or a whole positive amount. A negative one is a mistake and is refused, never quietly turned into zero.
  v_tip := COALESCE(p_tip_cents, 0);
  IF v_tip < 0 THEN
    RAISE EXCEPTION 'tip_cents must not be negative';
  END IF;
  IF v_tip > v_max THEN
    RAISE EXCEPTION 'tip_cents is out of range';
  END IF;
  v_change_type := p_method || '_payment';

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;
  IF v_order.status IN ('void', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot record payment on a % order', v_order.status;
  END IF;

  -- An online payment that is open could be collecting the same money.
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_order_id AND p.operation_key IS NOT NULL AND p.status = 'pending') THEN
    RAISE EXCEPTION 'Cannot record payment while an online payment is in progress for this order';
  END IF;

  v_dd := COALESCE(v_order.deposit_due_cents, 0);
  v_dp := COALESCE(v_order.deposit_paid_cents, 0);
  v_bd := GREATEST(0, COALESCE(v_order.balance_due_cents, 0));

  -- The same stored state the card path uses: what is left of the deposit, plus the balance due after it.
  v_dep_rem := GREATEST(0, v_dd - v_dp);
  v_remaining := v_dep_rem + v_bd;

  IF p_amount_cents > v_remaining THEN
    RAISE EXCEPTION 'Payment of % cents exceeds effective balance due of % cents. Record anything beyond the amount owed as a tip.',
      p_amount_cents, v_remaining;
  END IF;

  v_dep_comp := LEAST(p_amount_cents, v_dep_rem);
  v_bal_comp := p_amount_cents - v_dep_comp;
  v_payment_type := CASE WHEN v_dep_comp > 0 THEN 'deposit' ELSE 'balance' END;
  v_new_balance_due := v_bd - v_bal_comp;
  v_new_dp := v_dp + v_dep_comp;

  -- An order that is not confirmed yet becomes confirmed only once its required deposit is satisfied (or none is required). A
  -- partial deposit keeps the status it has. An order that is already confirmed / in progress / completed keeps its status.
  v_new_status := CASE
    WHEN v_order.status IN ('awaiting_customer_approval', 'pending_review') AND (v_dd <= 0 OR v_new_dp >= v_dd) THEN 'confirmed'
    ELSE v_order.status
  END;

  INSERT INTO public.payments (
    order_id, type, amount_cents, status, paid_at, payment_method,
    principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, order_financials_applied
  ) VALUES (
    p_order_id, v_payment_type, p_amount_cents + v_tip, 'succeeded', now(), p_method,
    p_amount_cents, v_tip, v_dep_comp, v_bal_comp, true
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.orders SET
    deposit_paid_cents = v_new_dp,
    balance_paid_cents = COALESCE(balance_paid_cents, 0) + v_bal_comp,
    balance_due_cents  = v_new_balance_due,
    tip_cents          = COALESCE(tip_cents, 0) + v_tip,
    status             = v_new_status
  WHERE id = p_order_id;

  INSERT INTO public.order_changelog (order_id, user_id, field_changed, old_value, new_value, change_type, notes)
  VALUES (
    p_order_id, p_acting_user_id, 'balance_due_cents',
    v_bd::text, v_new_balance_due::text, v_change_type,
    CASE WHEN p_method = 'check' AND p_check_number IS NOT NULL AND btrim(p_check_number) <> ''
         THEN 'Check number: ' || btrim(p_check_number) ELSE NULL END
  );

  IF v_new_status <> v_order.status THEN
    INSERT INTO public.order_changelog (order_id, user_id, field_changed, old_value, new_value, change_type)
    VALUES (p_order_id, p_acting_user_id, 'status', v_order.status, v_new_status, v_change_type);
  END IF;

  RETURN jsonb_build_object(
    'payment_id',      v_payment_id,
    'payment_type',    v_payment_type,
    'new_balance_due', v_new_balance_due,
    'status_changed',  CASE WHEN v_new_status <> v_order.status THEN v_new_status ELSE NULL END,
    'customer_id',     v_order.customer_id,
    'event_date',      v_order.event_date,
    'total_cents',     p_amount_cents + v_tip,
    'amount_cents',    p_amount_cents,
    'tip_cents',       v_tip,
    'deposit_applied_cents', v_dep_comp,
    'balance_applied_cents', v_bal_comp
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_cash_payment(
  p_order_id       uuid,
  p_amount_cents   integer,
  p_tip_cents      integer,
  p_acting_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.record_offline_payment(p_order_id, p_amount_cents, p_tip_cents, p_acting_user_id, 'cash', NULL);
$$;

CREATE OR REPLACE FUNCTION public.record_check_payment(
  p_order_id       uuid,
  p_amount_cents   integer,
  p_tip_cents      integer,
  p_acting_user_id uuid,
  p_check_number   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.record_offline_payment(p_order_id, p_amount_cents, p_tip_cents, p_acting_user_id, 'check', p_check_number);
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- A negative custom fee is a hidden discount, and a discount has to be a plain amount or a percentage of 0-100.
-- NOT VALID: enforced for every new or changed row; nothing historical is rewritten or re-checked.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_custom_fees_amount_non_negative' AND conrelid = 'public.order_custom_fees'::regclass) THEN
    ALTER TABLE public.order_custom_fees
      ADD CONSTRAINT order_custom_fees_amount_non_negative CHECK (amount_cents >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_discounts_amounts_valid' AND conrelid = 'public.order_discounts'::regclass) THEN
    ALTER TABLE public.order_discounts
      ADD CONSTRAINT order_discounts_amounts_valid CHECK (COALESCE(amount_cents, 0) >= 0 AND COALESCE(percentage, 0) >= 0 AND COALESCE(percentage, 0) <= 100) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Access: service role only, like every other payment function
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.payment_deposit_principal_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_payment_operation(uuid, text, text, uuid, boolean, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_offline_payment(uuid, integer, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_cash_payment(uuid, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_check_payment(uuid, integer, integer, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payment_deposit_principal_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_payment_operation(uuid, text, text, uuid, boolean, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_offline_payment(uuid, integer, integer, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_cash_payment(uuid, integer, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_check_payment(uuid, integer, integer, uuid, text) TO service_role;
