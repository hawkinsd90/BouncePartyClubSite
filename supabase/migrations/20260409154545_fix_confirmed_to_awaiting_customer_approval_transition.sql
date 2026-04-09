/*
  # Fix: Allow confirmed → awaiting_customer_approval status transition

  ## Problem
  When an admin edits a confirmed order (e.g., adds a generator) without checking
  "Skip Customer Approval", the save service tries to move the order to
  awaiting_customer_approval. The status validator was blocking this transition
  because it only allowed confirmed → in_progress, cancelled, or void.

  ## Fix
  Add awaiting_customer_approval as a valid target state from confirmed.
  This mirrors the pending_review → awaiting_customer_approval path and allows
  admins to request customer re-approval on already-confirmed orders.
*/

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
      IF NEW.status NOT IN ('awaiting_customer_approval', 'in_progress', 'cancelled', 'void') THEN
        RAISE EXCEPTION 'Invalid transition from confirmed to %. Valid: awaiting_customer_approval, in_progress, cancelled, void', NEW.status;
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
