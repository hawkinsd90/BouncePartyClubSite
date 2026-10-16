/*
  # Customer approval timestamp

  orders.customer_approved_at is written by order-lifecycle when a customer approval completes, and is selected and listed
  by create_booking_request. Migration 20251126190624 (add_customer_approval_workflow) already creates it; this statement only
  ensures it exists, as a nullable timestamp with no default: it is NULL until a customer approval stamps it. Additive and
  idempotent; no data is changed.
*/

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_approved_at timestamptz;
