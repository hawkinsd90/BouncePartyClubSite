/*
  # Fix order status model: align auto_update_order_status and validate_order_status_transition

  ## Problem

  Two separate issues both caused by the same drift: phantom status values
  (setup_in_progress, on_the_way, setup_completed, pickup_in_progress, on_the_way_back)
  were added to validate_order_status_transition and auto_update_order_status as if they
  belong to orders.status, but orders_status_check never included them.

  ### Issue 1 — Dead auto-complete branch
  auto_update_order_status() checks:
    IF v_all_completed AND v_order_status IN ('pickup_in_progress', 'on_the_way_back')

  v_order_status is read from orders.status. The orders_status_check constraint never
  allows 'pickup_in_progress' or 'on_the_way_back' in orders.status. Therefore this
  branch can never fire — the auto-completion trigger for pick-up tasks is permanently
  dead. The correct column to check for operational stage is orders.workflow_status,
  which does allow 'pickup_in_progress' as a value.

  ### Issue 2 — Phantom transitions in validate_order_status_transition
  The validator allows transitions to/from status values that the check constraint
  will always reject (setup_in_progress, on_the_way, setup_completed, pickup_in_progress,
  on_the_way_back). These branches can never succeed, and their presence causes the
  RAISE EXCEPTION error messages to mislead debugging.

  ## Authoritative status model (derived from live orders_status_check constraint)

  orders.status (high-level lifecycle):
    draft → pending_review → awaiting_customer_approval → confirmed → in_progress → completed
    any non-terminal → cancelled
    any non-terminal → void

  orders.workflow_status (operational detail, separate column):
    pending, on_the_way, arrived, setup_in_progress, setup_completed,
    pickup_scheduled, pickup_in_progress, completed

  task_status.status (per-task operational states):
    pending, en_route, arrived, completed

  ## Fix

  1. auto_update_order_status: change the completion branch to read workflow_status
     instead of orders.status, so it can actually fire when pickup tasks complete.

  2. validate_order_status_transition: remove all phantom transitions. Clean the
     validator down to only the values orders_status_check actually permits.
     The in_progress state can transition to completed or cancelled (manual admin
     action). The trigger never needs to guard workflow_status transitions since
     that column has its own check constraint.
*/

-- Fix 1: auto_update_order_status reads workflow_status for completion check
CREATE OR REPLACE FUNCTION auto_update_order_status()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_order_status TEXT;
  v_workflow_status TEXT;
  v_all_completed BOOLEAN;
  v_task_count INT;
  v_completed_count INT;
BEGIN
  SELECT status, workflow_status
  INTO v_order_status, v_workflow_status
  FROM orders
  WHERE id = NEW.order_id;

  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'completed') as completed
  INTO v_task_count, v_completed_count
  FROM task_status
  WHERE order_id = NEW.order_id;

  v_all_completed := (v_task_count > 0 AND v_task_count = v_completed_count);

  -- When the first drop-off task goes en_route on a confirmed order: mark in_progress
  IF NEW.status = 'en_route' AND v_order_status = 'confirmed' THEN
    UPDATE orders
    SET status = 'in_progress'
    WHERE id = NEW.order_id;
  END IF;

  -- When all tasks are completed and the workflow shows the order is in pickup phase:
  -- auto-advance orders.status to completed.
  -- Uses workflow_status (not orders.status) because pickup_in_progress lives there.
  IF v_all_completed AND v_workflow_status IN ('pickup_in_progress', 'pickup_scheduled') THEN
    UPDATE orders
    SET status = 'completed'
    WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix 2: validate_order_status_transition — remove phantom states, keep only
-- values that orders_status_check actually permits.
CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  CASE OLD.status
    WHEN 'draft' THEN
      IF NEW.status NOT IN ('pending_review', 'confirmed', 'cancelled', 'void') THEN
        RAISE EXCEPTION 'Invalid transition from draft to %. Valid: pending_review, confirmed, cancelled, void', NEW.status;
      END IF;

    WHEN 'pending_review' THEN
      IF NEW.status NOT IN ('awaiting_customer_approval', 'confirmed', 'cancelled', 'void') THEN
        RAISE EXCEPTION 'Invalid transition from pending_review to %. Valid: awaiting_customer_approval, confirmed, cancelled, void', NEW.status;
      END IF;

    WHEN 'awaiting_customer_approval' THEN
      IF NEW.status NOT IN ('confirmed', 'pending_review', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from awaiting_customer_approval to %. Valid: confirmed, pending_review, cancelled', NEW.status;
      END IF;

    WHEN 'confirmed' THEN
      IF NEW.status NOT IN ('in_progress', 'cancelled', 'void') THEN
        RAISE EXCEPTION 'Invalid transition from confirmed to %. Valid: in_progress, cancelled, void', NEW.status;
      END IF;

    WHEN 'in_progress' THEN
      IF NEW.status NOT IN ('completed', 'cancelled', 'void') THEN
        RAISE EXCEPTION 'Invalid transition from in_progress to %. Valid: completed, cancelled, void', NEW.status;
      END IF;

    WHEN 'completed', 'cancelled', 'void' THEN
      RAISE EXCEPTION 'Cannot change status from terminal state: %', OLD.status;

    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;
