/*
  # Add refund_requested column to orders

  ## Summary
  Adds a durable flag to record whether a refund was requested at cancellation time.
  Previously, the admin's refund choice in the cancel modal was sent to the edge function
  but never persisted — it evaporated silently.

  ## Changes
  - `orders.refund_requested` (boolean, DEFAULT false): Records explicit refund intent
    at cancellation. Does NOT trigger any automatic refund. Manual action via the
    Payments tab is still required.

  ## Notes
  1. Existing cancelled orders default to false — no retroactive assumption.
  2. Written by customer-cancel-order edge function when adminOverrideRefund is true.
  3. Also visible in order_changelog entries with change_type = 'cancellation'.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'refund_requested'
  ) THEN
    ALTER TABLE orders ADD COLUMN refund_requested boolean DEFAULT false;
    COMMENT ON COLUMN orders.refund_requested IS 'Whether a refund was requested at cancellation time. Does not trigger automatic refund.';
  END IF;
END $$;
