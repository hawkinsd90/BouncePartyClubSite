/*
  # Fix Order Status Transition for Direct Approval

  1. Changes
    - Allow `pending_review` → `confirmed` transition
    - This enables admin to approve orders with payment on file directly
    - When admin approves, charge-deposit function charges card and sets status to confirmed

  2. Reasoning
    - When an order has payment method already saved, admin approval should:
      1. Charge the deposit
      2. Move directly to confirmed status
    - This skips the "awaiting_customer_approval" step since payment is automatic
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
