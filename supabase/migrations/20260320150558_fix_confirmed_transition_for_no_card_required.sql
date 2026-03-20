/*
  # Fix confirmed transition when require_card_on_file = false

  ## Problem
  When an admin sets deposit to $0 and "No Card Needed", the customer accepts the invoice
  and the code tries to set status from draft → confirmed. The trigger blocks this because
  payment_amount_due > 0 but stripe_payment_method_id is NULL.

  The check should be skipped when require_card_on_file = false, since no card was ever
  required for this order.

  ## Fix
  Update the validate_order_status_transition function to also allow confirmed when
  require_card_on_file is explicitly false (admin deliberately waived both deposit and card).
*/

CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER AS $$
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
      IF NEW.status NOT IN ('setup_in_progress', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transition from confirmed to %. Valid transitions: setup_in_progress, cancelled', NEW.status;
      END IF;
      IF NEW.stripe_payment_method_id IS NULL
         AND COALESCE(NEW.payment_amount_due, 0) > 0
         AND NEW.require_card_on_file IS NOT FALSE THEN
        RAISE EXCEPTION 'Cannot confirm order without payment method on file (unless payment is $0 or card is not required)';
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
