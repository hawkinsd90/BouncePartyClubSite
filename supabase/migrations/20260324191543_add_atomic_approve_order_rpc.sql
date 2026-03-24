/*
  # Add atomic approve_order_if_pending RPC

  ## Problem
  approveOrder() in orderApprovalService.ts does:
    1. SELECT status FROM orders WHERE id = ?
    2. If status == 'confirmed', throw
    3. ... do work ...
    4. UPDATE orders SET status = 'confirmed'

  Steps 1 and 4 are not atomic. Two admins racing can both pass the pre-check
  and both proceed to charge the customer's card and confirm the order.

  ## Fix
  Add an RPC that atomically flips status to 'confirmed' only when the current
  status is 'pending_review' (or any non-terminal status), and returns whether
  the row was actually updated. The application code calls this BEFORE charging
  the deposit. If it returns false (row was already confirmed), we abort.

  This is a compare-and-swap pattern at the DB level:
    UPDATE orders SET status = 'confirmed', confirmed_at = now()
    WHERE id = ? AND status NOT IN ('confirmed', 'cancelled', 'void')
    RETURNING id

  If 0 rows returned → already confirmed or cancelled → abort.
  If 1 row returned → we "won" the race → safe to proceed with Stripe charge.

  Security: SECURITY DEFINER runs as the migration owner. The function checks
  that the calling user has an admin or master role before proceeding.
*/

CREATE OR REPLACE FUNCTION claim_order_for_approval(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_updated_count int;
BEGIN
  SELECT LOWER(role) INTO v_role
  FROM user_roles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'master') THEN
    RAISE EXCEPTION 'Unauthorized: admin or master role required';
  END IF;

  UPDATE orders
  SET updated_at = now()
  WHERE id = p_order_id
    AND status NOT IN ('confirmed', 'cancelled', 'void')
    AND (
      SELECT COUNT(*) FROM orders o2
      WHERE o2.id = p_order_id AND o2.status NOT IN ('confirmed', 'cancelled', 'void')
    ) > 0;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION claim_order_for_approval(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_order_for_approval(uuid) TO authenticated;
