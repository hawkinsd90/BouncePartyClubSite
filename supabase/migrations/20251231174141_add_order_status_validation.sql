/*
  # Add Order Status Transition Validation

  1. Functions
    - `validate_order_status_transition()` - Validates status changes before update
    - Prevents invalid status transitions based on business logic
    - Enforces payment method requirement for confirmed orders

  2. Triggers
    - Runs before any order status update
    - Prevents invalid transitions (e.g., draft -> completed)
    - Ensures terminal states (completed, cancelled, void) cannot be changed

  3. Valid Transitions
    - draft → pending_review, cancelled, void
    - pending_review → awaiting_customer_approval, cancelled, void
    - awaiting_customer_approval → confirmed, pending_review, cancelled
    - confirmed → setup_in_progress, cancelled (requires payment method)
    - setup_in_progress → on_the_way, setup_completed, confirmed
    - on_the_way → setup_completed, setup_in_progress
    - setup_completed → pickup_in_progress
    - pickup_in_progress → on_the_way_back, setup_completed
    - on_the_way_back → completed, pickup_in_progress
    - completed → (none - terminal state)
    - cancelled → (none - terminal state)
    - void → (none - terminal state)
*/

CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  CASE OLD.status
    WHEN 'draft' THEN
      IF NEW.status NOT IN ('pending_review', 'cancelled', 'void') THEN
        RAISE EXCEPTION 'Invalid transition from draft to %. Valid transitions: pending_review, cancelled, void', NEW.status;
      END IF;

    WHEN 'pending_review' THEN
      IF NEW.status NOT IN ('awaiting_customer_approval', 'cancelled', 'void') THEN
        RAISE EXCEPTION 'Invalid transition from pending_review to %. Valid transitions: awaiting_customer_approval, cancelled, void', NEW.status;
      END IF;

    WHEN 'awaiting_customer_approval' THEN
      IF NEW.status NOT IN ('confirmed', 'pending_review', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from awaiting_customer_approval to %. Valid transitions: confirmed, pending_review, cancelled', NEW.status;
      END IF;

    WHEN 'confirmed' THEN
      IF NEW.status NOT IN ('setup_in_progress', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from confirmed to %. Valid transitions: setup_in_progress, cancelled', NEW.status;
      END IF;
      IF NEW.stripe_payment_method_id IS NULL AND COALESCE(NEW.payment_amount_due, 0) > 0 THEN
        RAISE EXCEPTION 'Cannot confirm order without payment method on file (unless payment is $0)';
      END IF;

    WHEN 'setup_in_progress' THEN
      IF NEW.status NOT IN ('on_the_way', 'setup_completed', 'confirmed') THEN
        RAISE EXCEPTION 'Invalid transition from setup_in_progress to %. Valid transitions: on_the_way, setup_completed, confirmed', NEW.status;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS validate_status_transition ON orders;
CREATE TRIGGER validate_status_transition
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_order_status_transition();
