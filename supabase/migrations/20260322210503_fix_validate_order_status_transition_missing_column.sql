/*
  # Fix validate_order_status_transition trigger - remove reference to missing column

  ## Problem
  The trigger references NEW.payment_amount_due in the confirmed → setup_in_progress
  branch, but that column does not exist on the orders table. This causes a P0001
  error ("record new has no field payment_amount_due") whenever any transition
  from confirmed status is attempted, including the auto-trigger when a task
  goes en_route.

  ## Fix
  Remove the payment_amount_due check. The orders table uses stripe_payment_method_id
  and require_card_on_file for payment validation, which are already checked elsewhere.
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
        RAISE EXCEPTION 'Invalid transition from draft to %. Valid transitions: pending_review, confirmed, cancelled, void', NEW.status;
      END IF;

    WHEN 'pending_review' THEN
      IF NEW.status NOT IN ('awaiting_customer_approval', 'confirmed', 'cancelled', 'void') THEN
        RAISE EXCEPTION 'Invalid transition from pending_review to %. Valid transitions: awaiting_customer_approval, confirmed, cancelled, void', NEW.status;
      END IF;

    WHEN 'awaiting_customer_approval' THEN
      IF NEW.status NOT IN ('confirmed', 'pending_review', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from awaiting_customer_approval to %. Valid transitions: confirmed, pending_review, cancelled', NEW.status;
      END IF;

    WHEN 'confirmed' THEN
      IF NEW.status NOT IN ('setup_in_progress', 'in_progress', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from confirmed to %. Valid transitions: setup_in_progress, in_progress, cancelled', NEW.status;
      END IF;

    WHEN 'setup_in_progress' THEN
      IF NEW.status NOT IN ('on_the_way', 'setup_completed', 'confirmed', 'in_progress') THEN
        RAISE EXCEPTION 'Invalid transition from setup_in_progress to %. Valid transitions: on_the_way, setup_completed, confirmed, in_progress', NEW.status;
      END IF;

    WHEN 'in_progress' THEN
      IF NEW.status NOT IN ('setup_in_progress', 'on_the_way', 'setup_completed', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from in_progress to %. Valid transitions: setup_in_progress, on_the_way, setup_completed, completed, cancelled', NEW.status;
      END IF;

    WHEN 'on_the_way' THEN
      IF NEW.status NOT IN ('setup_completed', 'setup_in_progress') THEN
        RAISE EXCEPTION 'Invalid transition from on_the_way to %. Valid transitions: setup_completed, setup_in_progress', NEW.status;
      END IF;

    WHEN 'setup_completed' THEN
      IF NEW.status NOT IN ('pickup_in_progress') THEN
        RAISE EXCEPTION 'Invalid transition from setup_completed to %. Valid transitions: pickup_in_progress', NEW.status;
      END IF;

    WHEN 'pickup_in_progress' THEN
      IF NEW.status NOT IN ('on_the_way_back', 'setup_completed') THEN
        RAISE EXCEPTION 'Invalid transition from pickup_in_progress to %. Valid transitions: on_the_way_back, setup_completed', NEW.status;
      END IF;

    WHEN 'on_the_way_back' THEN
      IF NEW.status NOT IN ('completed', 'pickup_in_progress') THEN
        RAISE EXCEPTION 'Invalid transition from on_the_way_back to %. Valid transitions: completed, pickup_in_progress', NEW.status;
      END IF;

    WHEN 'completed', 'cancelled', 'void' THEN
      RAISE EXCEPTION 'Cannot change status from terminal state: %', OLD.status;

    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;
