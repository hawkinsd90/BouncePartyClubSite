/*
  # Fix Balance Calculation to Exclude Tip

  1. Problem
    - Order balance_due_cents incorrectly includes tip_cents
    - This causes double-counting: order shows Total (with tip) + Tip (again)
    - When customer pays in full + tip, system still shows a balance equal to the tip amount

  2. Solution
    - Tip is paid separately and should NOT be part of the order balance
    - Recalculate balance_due_cents to exclude tip_cents
    - Formula: (subtotal + travel_fee + surface_fee + generator_fee + same_day_pickup_fee + tax) - (deposit_due - deposit_paid)

  3. Impact
    - Fixes all orders to show correct balance (excluding tip)
    - Tip is tracked separately in tip_cents column
*/

-- Recalculate balance_due_cents for all orders (excluding tip)
UPDATE orders
SET balance_due_cents = (
  COALESCE(subtotal_cents, 0) +
  COALESCE(travel_fee_cents, 0) +
  COALESCE(surface_fee_cents, 0) +
  COALESCE(generator_fee_cents, 0) +
  COALESCE(same_day_pickup_fee_cents, 0) +
  COALESCE(tax_cents, 0)
) - COALESCE(deposit_due_cents, 0) + COALESCE(deposit_paid_cents, 0);
