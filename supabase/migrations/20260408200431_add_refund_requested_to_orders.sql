/*
  # Add refund_requested column to orders

  Adds a durable flag to record whether a refund was requested at cancellation time.
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
