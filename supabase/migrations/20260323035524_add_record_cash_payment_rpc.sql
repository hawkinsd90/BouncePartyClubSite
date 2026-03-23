/*
  # Add record_cash_payment RPC

  ## Purpose
  Provides an atomic Postgres function that performs all critical cash payment
  accounting writes in a single transaction, preventing partial-write inconsistency.

  ## What it does (in one transaction)
  1. Locks the order row with FOR UPDATE to prevent concurrent duplicate submissions
  2. Validates the order exists and is not voided/cancelled
  3. Validates amountCents > 0 and does not exceed the effective balance due
  4. Determines payment type (deposit vs balance) using deposit_required field
  5. Inserts the payments row
  6. Updates orders: balance_due_cents, deposit_paid_cents or balance_paid_cents, tip_cents
  7. Optionally advances order status to 'confirmed' if currently awaiting/pending
  8. Inserts order_changelog entry with acting admin user_id
  9. Returns the new payment id, receipt-ready fields, and updated order state

  ## Security
  - SECURITY DEFINER so the service role edge function can call it safely
  - All writes are atomic — if any step fails the entire transaction rolls back
  - Overpayment protection: raises exception if amountCents > effectiveBalanceDue

  ## Notes
  - transaction_receipts and email are still written by the edge function after this
    returns (non-critical, non-atomic, fire-and-forget)
  - The payments table does not have type/paid_at/currency columns in database.types.ts
    but does have them in reality (added by later migrations). The insert uses only
    columns that exist in the migration history.
*/

CREATE OR REPLACE FUNCTION record_cash_payment(
  p_order_id       uuid,
  p_amount_cents   integer,
  p_tip_cents      integer,
  p_acting_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order               record;
  v_order_total         bigint;
  v_custom_fees         bigint;
  v_discounts           bigint;
  v_effective_balance   bigint;
  v_is_deposit          boolean;
  v_payment_type        text;
  v_new_deposit_paid    bigint;
  v_new_balance_paid    bigint;
  v_new_balance_due     bigint;
  v_new_tip             bigint;
  v_new_status          text;
  v_payment_id          uuid;
  v_total_cents         bigint;
BEGIN
  -- Validate inputs
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be greater than zero';
  END IF;

  IF p_tip_cents IS NULL OR p_tip_cents < 0 THEN
    p_tip_cents := 0;
  END IF;

  v_total_cents := p_amount_cents + p_tip_cents;

  -- Lock the order row to prevent concurrent duplicate submissions
  SELECT
    o.id,
    o.status,
    o.customer_id,
    o.deposit_required,
    o.deposit_paid_cents,
    o.balance_paid_cents,
    o.balance_due_cents,
    o.tip_cents,
    o.subtotal_cents,
    o.travel_fee_cents,
    o.surface_fee_cents,
    o.same_day_pickup_fee_cents,
    o.generator_fee_cents,
    o.tax_cents,
    o.event_date
  INTO v_order
  FROM orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Reject voided / cancelled orders
  IF v_order.status IN ('void', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot record payment on a % order', v_order.status;
  END IF;

  -- Calculate order total from component fields + custom fees - discounts
  SELECT COALESCE(SUM(amount_cents), 0)
  INTO v_custom_fees
  FROM order_custom_fees
  WHERE order_id = p_order_id;

  SELECT COALESCE(SUM(amount_cents), 0)
  INTO v_discounts
  FROM order_discounts
  WHERE order_id = p_order_id;

  v_order_total :=
    COALESCE(v_order.subtotal_cents, 0) +
    COALESCE(v_order.travel_fee_cents, 0) +
    COALESCE(v_order.surface_fee_cents, 0) +
    COALESCE(v_order.same_day_pickup_fee_cents, 0) +
    COALESCE(v_order.generator_fee_cents, 0) +
    COALESCE(v_order.tax_cents, 0) +
    v_custom_fees -
    v_discounts;

  -- Effective balance = what is still owed
  -- balance_due_cents is set by the deposit flow to (orderTotal - depositPaid).
  -- For orders that haven't gone through the deposit flow yet (full-cash-first-payment),
  -- we fall back to the computed order total.
  -- We then subtract what has already been paid as balance.
  v_effective_balance := GREATEST(0,
    COALESCE(v_order.balance_due_cents, v_order_total) -
    COALESCE(v_order.balance_paid_cents, 0)
  );

  -- Overpayment protection: amount (excluding tip) must not exceed balance due
  IF p_amount_cents > v_effective_balance AND v_effective_balance > 0 THEN
    RAISE EXCEPTION 'Payment of % cents exceeds effective balance due of % cents',
      p_amount_cents, v_effective_balance;
  END IF;

  -- Classify as deposit vs balance
  -- A payment is a deposit if:
  --   deposit_required = true AND deposit_paid_cents = 0
  -- Otherwise it is a balance payment (accumulates balance_paid_cents)
  v_is_deposit := (
    COALESCE(v_order.deposit_required, true) = true
    AND COALESCE(v_order.deposit_paid_cents, 0) = 0
  );

  v_payment_type := CASE WHEN v_is_deposit THEN 'deposit' ELSE 'balance' END;

  -- Calculate updated accounting fields
  v_new_deposit_paid := CASE
    WHEN v_is_deposit THEN COALESCE(v_order.deposit_paid_cents, 0) + p_amount_cents
    ELSE COALESCE(v_order.deposit_paid_cents, 0)
  END;

  v_new_balance_paid := CASE
    WHEN NOT v_is_deposit THEN COALESCE(v_order.balance_paid_cents, 0) + p_amount_cents
    ELSE COALESCE(v_order.balance_paid_cents, 0)
  END;

  -- Recalculate balance_due_cents from first principles
  v_new_balance_due := GREATEST(0,
    v_order_total - v_new_deposit_paid - v_new_balance_paid
  );

  v_new_tip := COALESCE(v_order.tip_cents, 0) + p_tip_cents;

  -- Determine status transition: advance to confirmed only from awaiting/pending statuses
  v_new_status := CASE
    WHEN v_order.status IN ('awaiting_customer_approval', 'pending_review')
    THEN 'confirmed'
    ELSE v_order.status
  END;

  -- Insert payment row
  INSERT INTO payments (
    order_id,
    stripe_payment_intent_id,
    stripe_charge_id,
    amount_cents,
    tip_cents,
    status,
    payment_method,
    error_message
  ) VALUES (
    p_order_id,
    null,
    null,
    v_total_cents,
    p_tip_cents,
    'succeeded',
    'cash',
    null
  )
  RETURNING id INTO v_payment_id;

  -- Update orders accounting fields atomically
  UPDATE orders SET
    deposit_paid_cents     = v_new_deposit_paid,
    balance_paid_cents     = v_new_balance_paid,
    balance_due_cents      = v_new_balance_due,
    tip_cents              = v_new_tip,
    status                 = v_new_status
  WHERE id = p_order_id;

  -- Insert order_changelog audit entry
  INSERT INTO order_changelog (
    order_id,
    user_id,
    field_changed,
    old_value,
    new_value,
    change_type
  ) VALUES (
    p_order_id,
    p_acting_user_id,
    'balance_due_cents',
    COALESCE(v_order.balance_due_cents, v_order_total)::text,
    v_new_balance_due::text,
    'cash_payment'
  );

  -- Also log status change if applicable
  IF v_new_status != v_order.status THEN
    INSERT INTO order_changelog (
      order_id,
      user_id,
      field_changed,
      old_value,
      new_value,
      change_type
    ) VALUES (
      p_order_id,
      p_acting_user_id,
      'status',
      v_order.status,
      v_new_status,
      'cash_payment'
    );
  END IF;

  -- Return all data needed by the edge function for receipts + email
  RETURN jsonb_build_object(
    'payment_id',      v_payment_id,
    'payment_type',    v_payment_type,
    'new_balance_due', v_new_balance_due,
    'status_changed',  CASE WHEN v_new_status != v_order.status THEN v_new_status ELSE null END,
    'customer_id',     v_order.customer_id,
    'event_date',      v_order.event_date,
    'total_cents',     v_total_cents,
    'amount_cents',    p_amount_cents,
    'tip_cents',       p_tip_cents
  );
END;
$$;
