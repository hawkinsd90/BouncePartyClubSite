-- WP-30 (M-4): server-owned, idempotent completion after a deposit payment, and a repair of the transaction receipt uniqueness.
--
-- Until now the steps that follow a successful deposit charge (transaction receipts, the invoice row, the customer text) were run by
-- the Admin's browser, so a closed tab left a confirmed order without them. They now run on the server, once per payment, guarded by a
-- lease on the payment row:
--   post_claim_until   the lease; another worker may not start while it is in the future (a crashed worker only delays a retry)
--   post_completed_at  set when the work is done; completed payments are never worked on again
-- Payments created before this migration ran are never picked up by the mechanism (their completion belongs to the old flow).
--
-- Also repaired here: the receipt uniqueness constraints were declared NULLS NOT DISTINCT, so every receipt without a Stripe charge or
-- PaymentIntent id (cash, check, a charge whose id is not known yet) collided with the first one of the same type for ANY order and was
-- silently dropped. They become partial unique indexes over the non-null values, and a (payment, type) index is added.
-- All statements are additive or idempotent.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS post_completed_at timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS post_claim_until timestamptz;

-- The invoice rows the server writes carry the Setup Fee (Event Essentials under the setup minimum) so their parts add up to the total.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS setup_fee_cents integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------------------------------------------------
-- Receipt uniqueness repair
-- ---------------------------------------------------------------------------------------------------------------------
DO $mig$
BEGIN
  -- Refuse (with a clear message) rather than fail halfway if existing data would violate the new (payment, type) rule.
  IF EXISTS (
    SELECT 1 FROM public.transaction_receipts
    WHERE payment_id IS NOT NULL
    GROUP BY payment_id, transaction_type
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'transaction_receipts has duplicate (payment_id, transaction_type) rows; resolve them before applying this migration';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.transaction_receipts'::regclass AND conname = 'unique_receipt_pi_type') THEN
    ALTER TABLE public.transaction_receipts DROP CONSTRAINT unique_receipt_pi_type;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.transaction_receipts'::regclass AND conname = 'unique_receipt_charge_type') THEN
    ALTER TABLE public.transaction_receipts DROP CONSTRAINT unique_receipt_charge_type;
  END IF;
END
$mig$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_receipts_pi_type
  ON public.transaction_receipts (stripe_payment_intent_id, transaction_type)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_receipts_charge_type
  ON public.transaction_receipts (stripe_charge_id, transaction_type)
  WHERE stripe_charge_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_receipts_payment_type
  ON public.transaction_receipts (payment_id, transaction_type)
  WHERE payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- The completion lease. The cutoff is the moment this migration runs, written into the function text.
-- ---------------------------------------------------------------------------------------------------------------------
DO $mig$
BEGIN
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.claim_post_payment_completion(p_payment_id uuid, p_lease_seconds integer DEFAULT 300)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $body$
    DECLARE
      v_row public.payments%%ROWTYPE;
      v_lease integer := GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 900));
    BEGIN
      SELECT * INTO v_row FROM public.payments WHERE id = p_payment_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
      END IF;
      IF v_row.post_completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_completed');
      END IF;
      -- Only applied deposit payments created after this mechanism existed.
      IF v_row.type IS DISTINCT FROM 'deposit' OR v_row.status IS DISTINCT FROM 'succeeded' OR v_row.created_at < %L::timestamptz THEN
        RETURN jsonb_build_object('outcome', 'not_applicable');
      END IF;
      IF v_row.post_claim_until IS NOT NULL AND v_row.post_claim_until > now() THEN
        RETURN jsonb_build_object('outcome', 'busy');
      END IF;
      UPDATE public.payments SET post_claim_until = now() + make_interval(secs => v_lease) WHERE id = p_payment_id;
      RETURN jsonb_build_object(
        'outcome', 'claimed',
        'payment_id', v_row.id,
        'order_id', v_row.order_id,
        'amount_cents', v_row.amount_cents,
        'principal_cents', v_row.principal_amount_cents,
        'tip_cents', COALESCE(v_row.tip_amount_cents, 0),
        'stripe_payment_intent_id', v_row.stripe_payment_intent_id,
        'payment_method', v_row.payment_method,
        'payment_brand', v_row.payment_brand,
        'payment_last4', v_row.payment_last4,
        'paid_at', v_row.paid_at
      );
    END
    $body$
  $fn$, now());
END
$mig$;

-- Done: the payment is never worked on again.
CREATE OR REPLACE FUNCTION public.finish_post_payment_completion(p_payment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.payments
  SET post_completed_at = now(), post_claim_until = NULL
  WHERE id = p_payment_id AND post_completed_at IS NULL;
  RETURN FOUND;
END
$$;

-- Not done: give the lease back so the next trigger (a webhook retry, a repeat request) can try again at once.
CREATE OR REPLACE FUNCTION public.release_post_payment_claim(p_payment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.payments
  SET post_claim_until = NULL
  WHERE id = p_payment_id AND post_completed_at IS NULL;
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION public.claim_post_payment_completion(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_post_payment_completion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_post_payment_claim(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_post_payment_completion(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_post_payment_completion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_post_payment_claim(uuid) TO service_role;
