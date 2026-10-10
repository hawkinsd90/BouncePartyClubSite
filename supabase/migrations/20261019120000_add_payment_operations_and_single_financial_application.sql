/*
  # Payment operations and single financial application

  ## Problem
  A card charge used to be created first and recorded afterwards. A crash, a timeout or a repeated request in between could
  charge twice, or leave money received that no payment row describes. The code assumed a unique PaymentIntent id on
  `payments` that the database never had, and the amounts a customer's browser sent could decide what was charged.

  ## Model
  One `payments` row is one payment OPERATION. It is created BEFORE any provider call, so a provider charge always has a
  local record to be finalized against.

    pending, claim_id set   an Edge Function request owns the operation (a bounded lease)
    pending, claim_id NULL  nobody is working on it; any later request resumes THE SAME operation
    succeeded               the provider confirmed the money AND the order financials were applied (one transaction)
    failed / cancelled      the provider definitively did not take the money

  `operation_key` is the stable identity of the operation. It is generated here, persisted, and reused as the provider
  idempotency key on every retry, so a retry can never become a second charge.

  Principal and tip are stored separately on every NEW operation, and the principal records WHAT IT PAYS:
    deposit_principal_cents   money that satisfies the required deposit
    balance_principal_cents   money that pays down the balance
    principal_amount_cents    deposit + balance principal (the rental)
    tip_amount_cents          a gratuity; never counts toward a deposit or a balance
    amount_cents              the gross amount charged (principal + tip)
  A Full payment on an Admin Invoice therefore lands partly in deposit_paid_cents and partly in balance_paid_cents; it is never
  all "deposit". Historical rows keep NULL components; they are not guessed.

  ## Functions (service role only)
  - claim_payment_operation      derives the permitted principal, its deposit/balance split and the tip from the order row
                                 UNDER ITS ROW LOCK and creates or resumes the single open operation for the order. Callers
                                 supply a selection, never an authoritative amount. An operation that is already open is
                                 resumed only if the order STILL authorizes exactly that operation; otherwise the claim answers
                                 `stale_operation` and the caller must not start a new provider charge for it.
  - record_payment_operation_provider   remembers the provider ids on the operation (claim owner only).
  - finalize_payment_operation   the ONE place that applies a successful payment to the order, exactly once, whoever calls
                                 it (the request that charged, the webhook, or the checkout reconciler). It applies the
                                 persisted components. Clamping to what the order owes now exists only for money that ALREADY
                                 reached the provider; it is not how a stale operation is made safe.
  - release_payment_operation    gives the lease up, optionally closing the operation as failed or cancelled (claim owner
                                 only, never after the money was applied).

  - mark_payment_operation_provider_attempt   written BEFORE a money-moving provider request: from then on it is durably known
                                 whether a request ever began. A stale operation that never began one can be cancelled; one that
                                 did is ambiguous until the provider itself says otherwise (never on a timer, never on a lookup
                                 that found nothing or failed).

  ## State barrier
  While an operation holds a live lease (a request is between claiming it and finishing the provider call), the order fields that
  authorized it cannot change: status, deposit due/paid, balance due/paid, the order tip and the persisted payment selection. A BEFORE UPDATE
  trigger on orders rejects such a change. Only finalize_payment_operation, for that very operation, is exempt (it announces
  itself with a transaction-local setting). Notes, messages, crew/route fields and every other column are untouched.

  ## Uniqueness
  - operation_key is unique.
  - At most one OPEN operation per order.
  - One original positive payment per provider PaymentIntent. Refund rows (negative, linked through refunded_payment_id)
    legitimately reuse the original PaymentIntent id and are excluded from the rule.
  - One operation per Checkout Session.

  ## Not changed
  Existing rows, existing functions (cash, check, refund recording), the pricing columns and the old payment_lock column.
  This migration does not compute order totals.
*/

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS operation_key text,
  ADD COLUMN IF NOT EXISTS principal_amount_cents integer,
  ADD COLUMN IF NOT EXISTS tip_amount_cents integer,
  ADD COLUMN IF NOT EXISTS deposit_principal_cents integer,
  ADD COLUMN IF NOT EXISTS balance_principal_cents integer,
  ADD COLUMN IF NOT EXISTS claim_id uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_component_amounts_check' AND conrelid = 'public.payments'::regclass) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_component_amounts_check CHECK (
        (principal_amount_cents IS NULL AND tip_amount_cents IS NULL AND deposit_principal_cents IS NULL AND balance_principal_cents IS NULL)
        OR (
          principal_amount_cents IS NOT NULL AND tip_amount_cents IS NOT NULL
          AND deposit_principal_cents IS NOT NULL AND balance_principal_cents IS NOT NULL
          AND principal_amount_cents >= 0 AND tip_amount_cents >= 0
          AND deposit_principal_cents >= 0 AND balance_principal_cents >= 0
          AND deposit_principal_cents + balance_principal_cents = principal_amount_cents
          AND principal_amount_cents + tip_amount_cents = amount_cents
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_operation_requires_components_check' AND conrelid = 'public.payments'::regclass) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_operation_requires_components_check CHECK (
        operation_key IS NULL OR (
          principal_amount_cents IS NOT NULL AND tip_amount_cents IS NOT NULL
          AND deposit_principal_cents IS NOT NULL AND balance_principal_cents IS NOT NULL AND amount_cents > 0
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_operation_key_unique
  ON public.payments (operation_key)
  WHERE operation_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_operation_per_order
  ON public.payments (order_id)
  WHERE operation_key IS NOT NULL AND status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS payments_original_payment_intent_unique
  ON public.payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND refunded_payment_id IS NULL AND amount_cents > 0;

CREATE UNIQUE INDEX IF NOT EXISTS payments_checkout_session_unique
  ON public.payments (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- claim_payment_operation
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
        -- Part of the deposit is already paid and the rest is a catch-up. Collecting a catch-up is not implemented;
        -- charging the whole deposit again would double charge.
        v_err := jsonb_build_object('outcome', 'catch_up_required', 'deposit_due_cents', v_dd, 'deposit_paid_cents', v_dp);
        EXIT derive;
      END IF;

      IF EXISTS (SELECT 1 FROM public.payments pd WHERE pd.order_id = p_order_id AND pd.type = 'deposit' AND pd.status = 'succeeded' AND pd.amount_cents > 0) THEN
        -- A deposit payment exists in the ledger while the order says nothing was paid: the records disagree.
        v_err := jsonb_build_object('outcome', 'ledger_conflict');
        EXIT derive;
      END IF;

      -- Nothing of the deposit is paid yet (v_dp = 0), so the remaining deposit is the whole requirement.
      IF p_use_selection THEN
        v_sel_type := COALESCE(NULLIF(v_order.customer_selected_payment_type, ''), 'deposit');
        v_sel_cents := v_order.customer_selected_payment_cents;
        IF v_sel_type = 'deposit' THEN
          v_dep_comp := v_dd;
          v_bal_comp := 0;
        ELSIF v_sel_type = 'full' THEN
          v_dep_comp := v_dd;
          v_bal_comp := v_bd;
        ELSIF v_sel_type = 'custom' THEN
          IF v_sel_cents IS NULL OR v_sel_cents < v_dd OR v_sel_cents > v_dd + v_bd THEN
            v_err := jsonb_build_object('outcome', 'selection_invalid');
            EXIT derive;
          END IF;
          -- The deposit is satisfied first; only the rest is balance.
          v_dep_comp := LEAST(v_sel_cents, v_dd);
          v_bal_comp := v_sel_cents - v_dep_comp;
        ELSE
          v_err := jsonb_build_object('outcome', 'selection_invalid');
          EXIT derive;
        END IF;
      ELSE
        v_dep_comp := v_dd;
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
-- record_payment_operation_provider
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_operation_provider(
  p_payment_id uuid,
  p_claim_id uuid,
  p_payment_intent_id text DEFAULT NULL,
  p_checkout_session_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_payment_id IS NULL OR p_claim_id IS NULL OR (p_payment_intent_id IS NULL AND p_checkout_session_id IS NULL) THEN
    RETURN false;
  END IF;

  BEGIN
    UPDATE public.payments
    SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, p_payment_intent_id),
        stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, p_checkout_session_id)
    WHERE id = p_payment_id
      AND operation_key IS NOT NULL
      AND status = 'pending'
      AND claim_id = p_claim_id
      AND (p_payment_intent_id IS NULL OR stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = p_payment_intent_id)
      AND (p_checkout_session_id IS NULL OR stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = p_checkout_session_id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;

  RETURN v_rows = 1;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- mark_payment_operation_provider_attempt
-- ---------------------------------------------------------------------------------------------------------------------
-- Written BEFORE a money-moving provider request is made. From then on "did a request ever start?" is durably known:
--   provider_attempted_at IS NULL      no money-moving request was ever started; a stale operation can safely be cancelled
--   provider_attempted_at IS NOT NULL  the provider may or may not have taken the money; only the provider can say, so the
--                                      operation is never abandoned on a timer or on a lookup that found nothing or failed
-- If the process dies after this call and before the request, the operation is merely treated as ambiguous, which is safe.
CREATE OR REPLACE FUNCTION public.mark_payment_operation_provider_attempt(
  p_payment_id uuid,
  p_claim_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_payment_id IS NULL OR p_claim_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.payments
  SET provider_attempted_at = COALESCE(provider_attempted_at, now())
  WHERE id = p_payment_id
    AND operation_key IS NOT NULL
    AND status = 'pending'
    AND claim_id = p_claim_id
    AND COALESCE(order_financials_applied, false) = false;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- release_payment_operation
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_payment_operation(
  p_payment_id uuid,
  p_claim_id uuid,
  p_final_status text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_payment_id IS NULL OR p_claim_id IS NULL OR (p_final_status IS NOT NULL AND p_final_status NOT IN ('failed', 'cancelled')) THEN
    RETURN false;
  END IF;

  UPDATE public.payments
  SET claim_id = NULL,
      claimed_at = NULL,
      status = COALESCE(p_final_status, status),
      failed_at = CASE WHEN p_final_status = 'failed' THEN now() ELSE failed_at END
  WHERE id = p_payment_id
    AND operation_key IS NOT NULL
    AND status = 'pending'
    AND claim_id = p_claim_id
    AND COALESCE(order_financials_applied, false) = false;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- finalize_payment_operation
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_payment_operation(
  p_payment_id uuid,
  p_claim_id uuid,
  p_operation_key text,
  p_provider_payment_intent_id text,
  p_checkout_session_id text,
  p_amount_received integer,
  p_payment_method text DEFAULT NULL,
  p_payment_brand text DEFAULT NULL,
  p_payment_last4 text DEFAULT NULL,
  p_fee integer DEFAULT NULL,
  p_net integer DEFAULT NULL,
  p_pm_id text DEFAULT NULL,
  p_customer_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_order public.orders%ROWTYPE;
  v_op public.payments%ROWTYPE;
  v_tip integer;
  v_dd integer;
  v_dp integer;
  v_bd integer;
  v_dep_rem integer;
  v_dep_applied integer;
  v_bal_applied integer;
  v_excess integer;
  v_new_status text;
  v_charged_tip integer;
BEGIN
  IF p_payment_id IS NULL OR p_amount_received IS NULL OR p_amount_received < 0 OR (p_claim_id IS NULL AND p_operation_key IS NULL) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT order_id INTO v_order_id FROM public.payments WHERE id = p_payment_id AND operation_key IS NOT NULL;
  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Lock order first, then the payment: the same order every function here uses.
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO v_op FROM public.payments WHERE id = p_payment_id FOR UPDATE;

  -- Whoever finalized first applied the payment; a later caller (the request that charged, the webhook, a reconciler) is told so
  -- and changes nothing.
  IF COALESCE(v_op.order_financials_applied, false) THEN
    IF p_claim_id IS NULL AND v_op.operation_key IS DISTINCT FROM p_operation_key THEN
      RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    RETURN jsonb_build_object('outcome', 'already_applied', 'applied', false, 'order_status', v_order.status);
  END IF;

  IF p_claim_id IS NOT NULL THEN
    IF v_op.claim_id IS DISTINCT FROM p_claim_id THEN
      RETURN jsonb_build_object('outcome', 'not_owner', 'applied', false);
    END IF;
  ELSE
    IF v_op.operation_key IS DISTINCT FROM p_operation_key THEN
      RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
  END IF;

  IF p_amount_received <> v_op.amount_cents THEN
    RETURN jsonb_build_object('outcome', 'amount_mismatch', 'applied', false, 'expected_cents', v_op.amount_cents);
  END IF;

  IF p_provider_payment_intent_id IS NOT NULL AND v_op.stripe_payment_intent_id IS NOT NULL AND v_op.stripe_payment_intent_id <> p_provider_payment_intent_id THEN
    RETURN jsonb_build_object('outcome', 'provider_mismatch', 'applied', false);
  END IF;
  IF p_checkout_session_id IS NOT NULL AND v_op.stripe_checkout_session_id IS NOT NULL AND v_op.stripe_checkout_session_id <> p_checkout_session_id THEN
    RETURN jsonb_build_object('outcome', 'provider_mismatch', 'applied', false);
  END IF;

  BEGIN
    UPDATE public.payments
    SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, p_provider_payment_intent_id),
        stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, p_checkout_session_id)
    WHERE id = v_op.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'provider_conflict', 'applied', false);
  END;

  -- This transaction is the finalization of this very operation: the state barrier lets it change the order.
  PERFORM set_config('bpc.finalizing_payment_id', v_op.id::text, true);

  v_tip := v_op.tip_amount_cents;
  v_dd := COALESCE(v_order.deposit_due_cents, 0);
  v_dp := COALESCE(v_order.deposit_paid_cents, 0);
  v_bd := GREATEST(0, COALESCE(v_order.balance_due_cents, 0));
  v_new_status := v_order.status;

  -- Apply what the operation says it paid. The clamp to what the order owes NOW is the recovery path for money that ALREADY
  -- reached the provider; a stale operation is stopped at claim time and never charged.
  v_dep_rem := GREATEST(0, v_dd - v_dp);
  v_dep_applied := LEAST(v_op.deposit_principal_cents, v_dep_rem);
  v_bal_applied := LEAST(v_op.balance_principal_cents, v_bd);

  IF v_op.type = 'deposit' THEN
    SELECT COALESCE(SUM(pt.tip_amount_cents), 0) + v_tip INTO v_charged_tip
      FROM public.payments pt WHERE pt.order_id = v_order_id AND pt.status = 'succeeded' AND pt.tip_amount_cents IS NOT NULL AND pt.id <> v_op.id;
    IF v_order.status IN ('draft', 'quote', 'pending_review', 'awaiting_customer_approval') THEN
      v_new_status := 'confirmed';
    END IF;

    UPDATE public.orders
    SET deposit_paid_cents = v_dp + v_dep_applied,
        balance_paid_cents = COALESCE(balance_paid_cents, 0) + v_bal_applied,
        balance_due_cents = GREATEST(0, v_bd - v_bal_applied),
        stripe_payment_status = 'paid',
        tip_cents = GREATEST(COALESCE(tip_cents, 0), v_charged_tip),
        customer_selected_payment_cents = CASE WHEN v_dep_applied + v_bal_applied > 0 THEN v_dep_applied + v_bal_applied ELSE customer_selected_payment_cents END,
        status = v_new_status,
        stripe_payment_method_id = COALESCE(p_pm_id, stripe_payment_method_id),
        stripe_customer_id = COALESCE(p_customer_id, stripe_customer_id)
    WHERE id = v_order_id;
  ELSE
    UPDATE public.orders
    SET deposit_paid_cents = v_dp + v_dep_applied,
        balance_paid_cents = COALESCE(balance_paid_cents, 0) + v_bal_applied,
        balance_due_cents = GREATEST(0, v_bd - v_bal_applied),
        tip_cents = COALESCE(tip_cents, 0) + v_tip,
        stripe_payment_method_id = COALESCE(p_pm_id, stripe_payment_method_id),
        stripe_customer_id = COALESCE(p_customer_id, stripe_customer_id)
    WHERE id = v_order_id;
  END IF;

  v_excess := v_op.principal_amount_cents - (v_dep_applied + v_bal_applied);
  IF v_excess > 0 THEN
    INSERT INTO public.order_changelog (order_id, user_id, change_type, field_changed, old_value, new_value, notes)
    VALUES (v_order_id, NULL, 'payment_error', CASE WHEN v_op.type = 'deposit' THEN 'deposit_paid_cents' ELSE 'balance_paid_cents' END,
            v_op.principal_amount_cents::text, (v_dep_applied + v_bal_applied)::text,
            'PAYMENT_EXCEEDS_AMOUNT_DUE: operation ' || v_op.id::text || ' collected ' || v_op.principal_amount_cents::text || ' cents of principal but only ' || (v_dep_applied + v_bal_applied)::text || ' were owed; the difference of ' || v_excess::text || ' cents needs review');
  END IF;

  UPDATE public.payments
  SET status = 'succeeded',
      paid_at = COALESCE(paid_at, now()),
      failed_at = NULL,
      claim_id = NULL,
      claimed_at = NULL,
      order_financials_applied = true,
      payment_method = COALESCE(p_payment_method, payment_method),
      payment_brand = COALESCE(p_payment_brand, payment_brand),
      payment_last4 = COALESCE(p_payment_last4, payment_last4),
      stripe_fee_amount = COALESCE(p_fee, stripe_fee_amount),
      stripe_net_amount = COALESCE(p_net, stripe_net_amount)
  WHERE id = v_op.id;

  RETURN jsonb_build_object(
    'outcome', 'applied',
    'applied', true,
    'payment_type', v_op.type,
    'applied_principal_cents', v_dep_applied + v_bal_applied,
    'deposit_applied_cents', v_dep_applied,
    'balance_applied_cents', v_bal_applied,
    'excess_principal_cents', v_excess,
    'tip_cents', v_tip,
    'status_changed', v_new_status <> v_order.status,
    'order_status', v_new_status,
    'previous_status', v_order.status
  );
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- State barrier
-- ---------------------------------------------------------------------------------------------------------------------
-- While an operation holds a live lease, the order fields that authorized it cannot be changed underneath it. The trigger
-- function reads payments, which the updating role may not be allowed to read, so it is SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.guard_payment_authoritative_order_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.deposit_due_cents IS DISTINCT FROM OLD.deposit_due_cents
     OR NEW.deposit_paid_cents IS DISTINCT FROM OLD.deposit_paid_cents
     OR NEW.balance_due_cents IS DISTINCT FROM OLD.balance_due_cents
     OR NEW.balance_paid_cents IS DISTINCT FROM OLD.balance_paid_cents
     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents
     OR NEW.customer_selected_payment_type IS DISTINCT FROM OLD.customer_selected_payment_type
     OR NEW.customer_selected_payment_cents IS DISTINCT FROM OLD.customer_selected_payment_cents THEN
    IF EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.order_id = OLD.id
        AND p.operation_key IS NOT NULL
        AND p.status = 'pending'
        AND p.claim_id IS NOT NULL
        AND p.claimed_at > now() - interval '300 seconds'
        AND p.id::text IS DISTINCT FROM current_setting('bpc.finalizing_payment_id', true)
    ) THEN
      RAISE EXCEPTION 'A payment is in progress for this order; its payment fields cannot change until it finishes.'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payment_authoritative_order_changes ON public.orders;
CREATE TRIGGER trg_guard_payment_authoritative_order_changes
  BEFORE UPDATE OF status, deposit_due_cents, deposit_paid_cents, balance_due_cents, balance_paid_cents, tip_cents,
                   customer_selected_payment_type, customer_selected_payment_cents
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_authoritative_order_changes();

REVOKE ALL ON FUNCTION public.claim_payment_operation(uuid, text, text, uuid, boolean, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_payment_operation_provider(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_payment_operation_provider_attempt(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_payment_operation(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_payment_operation(uuid, uuid, text, text, text, integer, text, text, text, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_payment_authoritative_order_changes() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_payment_operation(uuid, text, text, uuid, boolean, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_operation_provider(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_operation_provider_attempt(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_payment_operation(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_payment_operation(uuid, uuid, text, text, text, integer, text, text, text, integer, integer, text, text) TO service_role;
