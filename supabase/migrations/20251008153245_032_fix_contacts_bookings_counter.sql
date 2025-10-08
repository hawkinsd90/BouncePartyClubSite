/*
  # Fix contacts bookings counter
  
  1. Changes
    - Create trigger to automatically update contacts.total_bookings when orders are created
    - Create trigger to update contacts.total_spent_cents when orders are paid
    - Backfill existing data to fix current contacts
  
  2. Security
    - Triggers run with appropriate permissions
*/

-- Function to update contact bookings count
CREATE OR REPLACE FUNCTION update_contact_booking_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the contact's total bookings and total spent
  UPDATE contacts
  SET 
    total_bookings = (
      SELECT COUNT(*)
      FROM orders
      WHERE customer_id = NEW.customer_id
        AND status NOT IN ('cancelled', 'draft')
    ),
    total_spent_cents = (
      SELECT COALESCE(SUM(subtotal_cents + travel_fee_cents + surface_fee_cents + same_day_pickup_fee_cents + tax_cents), 0)
      FROM orders
      WHERE customer_id = NEW.customer_id
        AND status IN ('confirmed', 'completed')
    ),
    last_contact_date = NOW()
  WHERE customer_id = NEW.customer_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new orders
DROP TRIGGER IF EXISTS trigger_update_contact_stats ON orders;
CREATE TRIGGER trigger_update_contact_stats
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_booking_stats();

-- Backfill existing contacts
UPDATE contacts c
SET 
  total_bookings = (
    SELECT COUNT(*)
    FROM orders o
    WHERE o.customer_id = c.customer_id
      AND o.status NOT IN ('cancelled', 'draft')
  ),
  total_spent_cents = (
    SELECT COALESCE(SUM(o.subtotal_cents + o.travel_fee_cents + o.surface_fee_cents + o.same_day_pickup_fee_cents + o.tax_cents), 0)
    FROM orders o
    WHERE o.customer_id = c.customer_id
      AND o.status IN ('confirmed', 'completed')
  );
