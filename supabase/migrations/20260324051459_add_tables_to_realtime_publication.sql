/*
  # Add core tables to supabase_realtime publication

  ## Problem
  The customer portal uses Supabase Realtime to subscribe to changes on orders,
  payments, task_status, order_signatures, and order_lot_pictures. However,
  none of these tables were added to the supabase_realtime publication, so
  no events were ever delivered to subscribers — live updates simply never fired.

  ## Changes
  Adds the following tables to the supabase_realtime publication:
  - orders (portal status updates, admin completion triggers portal refresh)
  - payments (payment confirmed → portal refreshes)
  - task_status (crew workflow updates → portal shows delivery/pickup progress)
  - order_signatures (waiver signed → portal reflects completion)
  - order_lot_pictures (lot pics uploaded → portal reflects completion)

  ## Notes
  - REPLICA IDENTITY FULL was already set on orders, payments, and task_status
    in a prior migration. This migration only adds table publication membership.
  - ALTER PUBLICATION ... ADD TABLE is safe and non-destructive.
  - IF NOT EXISTS is not supported by ALTER PUBLICATION ADD TABLE syntax,
    so we use a DO block to check membership before adding.
*/

DO $$
BEGIN
  -- orders
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;

  -- payments
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payments;
  END IF;

  -- task_status
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'task_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE task_status;
  END IF;

  -- order_signatures
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'order_signatures'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_signatures;
  END IF;

  -- order_lot_pictures
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'order_lot_pictures'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_lot_pictures;
  END IF;
END $$;
