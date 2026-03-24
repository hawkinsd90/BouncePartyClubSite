/*
  # Fix REPLICA IDENTITY FULL for realtime-subscribed tables

  ## Problem
  Three tables are members of the supabase_realtime publication and have active
  frontend subscriptions, but they have REPLICA IDENTITY DEFAULT (primary key only).

  With DEFAULT identity, Postgres only includes primary-key columns in WAL events
  for UPDATE and DELETE operations. Supabase Realtime uses row-level filters such
  as `order_id=eq.X`, but `order_id` is not the primary key on these tables.
  This means every UPDATE and DELETE event on these tables is silently dropped by
  Supabase Realtime — the filter can never match.

  INSERT events do work (all columns are included on INSERT regardless of identity),
  but UPDATE events (e.g. order_signatures.pdf_url being set after PDF generation,
  or order_lot_pictures row updates) are lost.

  ## Tables fixed
  - order_pictures: added to realtime publication in prior migration but REPLICA
    IDENTITY was not set; both UPDATE/DELETE events are dropped silently
  - order_lot_pictures: subscribed in CustomerPortal.tsx but UPDATE/DELETE events
    are dropped silently
  - order_signatures: subscribed in CustomerPortal.tsx; UPDATE events (e.g. when
    generate-signed-waiver backfills pdf_url) are dropped silently

  ## Changes
  - Sets REPLICA IDENTITY FULL on order_pictures
  - Sets REPLICA IDENTITY FULL on order_lot_pictures
  - Sets REPLICA IDENTITY FULL on order_signatures

  ## Notes
  - REPLICA IDENTITY FULL causes slightly more WAL volume (all columns included in
    WAL events) but is the standard Supabase recommendation for realtime tables
  - task_status, orders, and payments already have REPLICA IDENTITY FULL from
    migration 20260324043743
  - This is a non-destructive, zero-downtime change
*/

ALTER TABLE order_pictures REPLICA IDENTITY FULL;
ALTER TABLE order_lot_pictures REPLICA IDENTITY FULL;
ALTER TABLE order_signatures REPLICA IDENTITY FULL;
