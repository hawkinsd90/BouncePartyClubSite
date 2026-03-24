/*
  # Add order_pictures to supabase_realtime publication

  ## Problem
  order_pictures was missing from the realtime publication that was set up for
  orders, payments, task_status, order_signatures, and order_lot_pictures.
  This prevents live updates when customer-uploaded pictures are added.

  ## Changes
  - Adds order_pictures to the supabase_realtime publication
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'order_pictures'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_pictures;
  END IF;
END $$;
