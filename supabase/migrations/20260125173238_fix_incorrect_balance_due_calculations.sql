/*
  # Fix Incorrect Balance Due Calculations
  
  1. Problem
    - 80 orders have incorrect balance_due_cents values
    - The balance doesn't match: total - deposit
    - Order #CDF04DF2 shows $609.72 balance when it should be $514.72
    - Appears to be caused by calculation errors during order creation/updates
    
  2. Solution
    - Recalculate balance_due_cents for all orders
    - Formula: (subtotal + travel_fee + surface_fee + generator_fee + same_day_pickup_fee + tax + tip) - (deposit_due - deposit_paid)
    - This ensures the balance accurately reflects what customer owes after the event
    
  3. Impact
    - Fixes 80 orders with incorrect balance calculations
    - Ensures accurate financial reporting and customer billing
*/

-- Recalculate balance_due_cents for all orders
UPDATE orders
SET balance_due_cents = (
  COALESCE(subtotal_cents, 0) + 
  COALESCE(travel_fee_cents, 0) + 
  COALESCE(surface_fee_cents, 0) + 
  COALESCE(generator_fee_cents, 0) + 
  COALESCE(same_day_pickup_fee_cents, 0) + 
  COALESCE(tax_cents, 0) +
  COALESCE(tip_cents, 0)
) - COALESCE(deposit_due_cents, 0) + COALESCE(deposit_paid_cents, 0)
WHERE balance_due_cents != (
  COALESCE(subtotal_cents, 0) + 
  COALESCE(travel_fee_cents, 0) + 
  COALESCE(surface_fee_cents, 0) + 
  COALESCE(generator_fee_cents, 0) + 
  COALESCE(same_day_pickup_fee_cents, 0) + 
  COALESCE(tax_cents, 0) +
  COALESCE(tip_cents, 0)
) - COALESCE(deposit_due_cents, 0) + COALESCE(deposit_paid_cents, 0);
