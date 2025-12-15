/*
  # Add Order Cancellation Reason

  1. Changes
    - Add `cancellation_reason` field to orders table
    - Add `cancelled_at` timestamp to track when order was cancelled
    - Add `cancelled_by` to track who cancelled (null = customer, user_id = admin)
  
  2. Purpose
    - Track why orders are cancelled for analytics and customer service
    - Support customer self-service cancellations with automatic refund logic
*/

-- Add cancellation tracking fields
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN orders.cancellation_reason IS 'Reason provided when order was cancelled';
COMMENT ON COLUMN orders.cancelled_at IS 'Timestamp when order was cancelled';
COMMENT ON COLUMN orders.cancelled_by IS 'User who cancelled the order (null for customer cancellations)';
