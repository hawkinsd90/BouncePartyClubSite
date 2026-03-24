/*
  # Set REPLICA IDENTITY FULL for realtime-subscribed tables

  ## Problem
  The customer portal subscribes to realtime changes on the `task_status` and
  `orders` tables using row-level filters (e.g. order_id=eq.X).

  With the default REPLICA IDENTITY (primary key only), Postgres does not
  include the full old row in UPDATE/DELETE WAL events. Supabase Realtime
  cannot match the filter on non-PK columns without the full row, so UPDATE
  events on `task_status` (e.g. crew marks "En Route") are silently dropped
  and never delivered to the customer portal subscription.

  ## Changes
  - Sets REPLICA IDENTITY FULL on `task_status` so that UPDATE events carry
    all columns, allowing the order_id filter to match correctly
  - Sets REPLICA IDENTITY FULL on `orders` for the same reason
  - Sets REPLICA IDENTITY FULL on `payments` for consistent realtime behavior

  ## Notes
  - REPLICA IDENTITY FULL causes slightly more WAL volume but is the standard
    Supabase recommendation for tables used with realtime row filters
  - This is a non-destructive, zero-downtime change
*/

ALTER TABLE task_status REPLICA IDENTITY FULL;
ALTER TABLE orders REPLICA IDENTITY FULL;
ALTER TABLE payments REPLICA IDENTITY FULL;
