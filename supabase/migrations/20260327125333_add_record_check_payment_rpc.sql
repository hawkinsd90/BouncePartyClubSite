/*
  # Add record_check_payment RPC

  ## Summary
  Adds a new atomic database function `record_check_payment` that mirrors
  `record_cash_payment` exactly, with the following differences:
  - Uses payment_method = 'check'
  - Uses change_type = 'check_payment' in the changelog
  - Accepts an additional p_check_number parameter stored in notes

  ## New Functions
  - `record_check_payment(p_order_id, p_amount_cents, p_tip_cents, p_acting_user_id, p_check_number)`

  ## Atomic Guarantees (same as cash)
  1. Row-level lock on the order to prevent concurrent duplicate submissions
  2. Overpayment protection — raises exception if amount exceeds effective balance due
  3. Payment insert with payment_method = 'check'
  4. Order accounting update (deposit_paid_cents / balance_paid_cents / balance_due_cents / tip_cents)
  5. Order status advancement (awaiting_customer_approval / pending_review → confirmed)
  6. Changelog insert with change_type = 'check_payment'

  ## Notes
  - This is a separate function — the existing record_cash_payment function is unchanged.
  - The check number is passed as p_check_number and stored in order changelog notes.
*/

CREATE OR REPLACE FUNCTION record_check_payment(
  p_order_id       uuid,
  p_amount_cents   integer,
  p_tip_cents      integer DEFAULT 0,
  p_acting_user_id uuid    DEFAULT NULL,
  p_check_number   text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order              orders%ROWTYPE;
  v_payment_type       text;
  v_payment_id         uuid;
  v_new_deposit_paid   integer;
  v_new_balance_paid   integer;
  v_new_balance_due    integer;
  v_new_tip_cents      integer;
  v_new_status         text;
  v_status_changed     text;
  v_effective_balance  integer;
  v_notes_text         text;
BEGIN
  -- 1. Lock the order row to prevent concurrent duplicate submissions
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- 2. Guard against voided / cancelled orders
  IF v_order.status IN ('voided', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot record payment for a % order.', v_order.status;
  END IF;

  -- 3. Validate amount
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  -- 4. Overpayment protection
  v_effective_balance := COALESCE(v_order.balance_due_cents, 0);
  IF p_amount_cents > v_effective_balance THEN
    RAISE EXCEPTION 'Payment amount ($%) exceeds effective balance due ($%).',
      (p_amount_cents::numeric / 100)::text,
      (v_effective_balance::numeric / 100)::text;
  END IF;

  -- 5. Classify as deposit vs balance payment
  IF NOT COALESCE(v_order.deposit_paid, false) AND COALESCE(v_order.deposit_required, false) THEN
    v_payment_type := 'deposit';
  ELSE
    v_payment_type := 'balance';
  END IF;

  -- 6. Insert payment record
  INSERT INTO payments (
    order_id,
    type,
    amount_cents,
    status,
    paid_at,
    payment_method
  ) VALUES (
    p_order_id,
    v_payment_type,
    p_amount_cents,
    'paid',
    now(),
    'check'
  )
  RETURNING id INTO v_payment_id;

  -- 7. Compute new accounting totals
  IF v_payment_type = 'deposit' THEN
    v_new_deposit_paid := COALESCE(v_order.deposit_paid_cents, 0) + p_amount_cents;
    v_new_balance_paid := COALESCE(v_order.balance_paid_cents, 0);
  ELSE
    v_new_deposit_paid := COALESCE(v_order.deposit_paid_cents, 0);
    v_new_balance_paid := COALESCE(v_order.balance_paid_cents, 0) + p_amount_cents;
  END IF;

  v_new_tip_cents  := COALESCE(v_order.tip_cents, 0) + COALESCE(p_tip_cents, 0);
  v_new_balance_due := GREATEST(0, COALESCE(v_order.balance_due_cents, 0) - p_amount_cents);

  -- 8. Determine status advancement
  v_new_status := v_order.status;
  v_status_changed := NULL;
  IF v_order.status IN ('awaiting_customer_approval', 'pending_review') THEN
    v_new_status := 'confirmed';
    v_status_changed := 'confirmed';
  END IF;

  -- 9. Update the order
  UPDATE orders SET
    deposit_paid_cents  = v_new_deposit_paid,
    balance_paid_cents  = v_new_balance_paid,
    balance_due_cents   = v_new_balance_due,
    tip_cents           = v_new_tip_cents,
    deposit_paid        = (v_payment_type = 'deposit' OR COALESCE(deposit_paid, false)),
    status              = v_new_status,
    updated_at          = now()
  WHERE id = p_order_id;

  -- 10. Changelog — balance change
  v_notes_text := 'Check payment recorded by admin';
  IF p_check_number IS NOT NULL AND p_check_number <> '' THEN
    v_notes_text := v_notes_text || ' | Check #' || p_check_number;
  END IF;
  IF COALESCE(p_tip_cents, 0) > 0 THEN
    v_notes_text := v_notes_text || ' | includes tip $' || (p_tip_cents::numeric / 100)::text;
  END IF;

  INSERT INTO order_changelog (order_id, change_type, old_value, new_value, changed_by, notes)
  VALUES (
    p_order_id,
    'check_payment',
    jsonb_build_object('balance_due_cents', v_order.balance_due_cents),
    jsonb_build_object(
      'payment_id',        v_payment_id,
      'payment_type',      v_payment_type,
      'amount_cents',      p_amount_cents,
      'check_number',      p_check_number,
      'new_balance_due',   v_new_balance_due
    ),
    p_acting_user_id,
    v_notes_text
  );

  -- 11. Changelog — status change (if applicable)
  IF v_status_changed IS NOT NULL THEN
    INSERT INTO order_changelog (order_id, change_type, old_value, new_value, changed_by, notes)
    VALUES (
      p_order_id,
      'status_change',
      jsonb_build_object('status', v_order.status),
      jsonb_build_object('status', v_new_status),
      p_acting_user_id,
      'Auto-confirmed after check payment'
    );
  END IF;

  -- 12. Return result
  RETURN jsonb_build_object(
    'payment_id',      v_payment_id,
    'payment_type',    v_payment_type,
    'new_balance_due', v_new_balance_due,
    'status_changed',  v_status_changed,
    'customer_id',     v_order.customer_id,
    'event_date',      v_order.event_date,
    'total_cents',     COALESCE(v_order.total_cents, 0),
    'amount_cents',    p_amount_cents,
    'tip_cents',       COALESCE(p_tip_cents, 0)
  );
END;
$$;
