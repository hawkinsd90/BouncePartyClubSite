/*
  # Replace claim_order_for_approval with status-predicated update pattern

  ## Problem
  The previous RPC approach was overly complex and still had an issue:
  it used updated_at as a proxy which doesn't actually claim the order atomically.

  ## Better pattern
  The approval flow in orderApprovalService.ts does the status update in two places:
  1. Zero-deposit path: UPDATE orders SET status = 'confirmed' WHERE id = ?
  2. Deposit path: the charge-deposit edge function sets status = 'confirmed'

  The atomic guard is simpler in the application layer:
  Change both UPDATE calls to add WHERE status NOT IN ('confirmed','cancelled','void')
  and check affected rowcount. If 0 rows updated → someone else already confirmed → abort.

  This migration just drops the now-unneeded RPC from the previous migration.
  The actual code fix is in orderApprovalService.ts.
*/

DROP FUNCTION IF EXISTS claim_order_for_approval(uuid);
