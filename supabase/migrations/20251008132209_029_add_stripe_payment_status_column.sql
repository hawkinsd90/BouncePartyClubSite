/*
  # Add Stripe Payment Status Column

  1. Changes
    - Add `stripe_payment_status` column to `orders` table
      - Values: 'unpaid', 'pending', 'paid', 'failed', 'refunded'
      - Default: 'unpaid'
      - Used to track payment status when using Stripe Checkout
  
  2. Notes
    - This column allows the frontend to poll for payment completion
    - Updates when Stripe webhook confirms payment
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'stripe_payment_status'
  ) THEN
    ALTER TABLE orders ADD COLUMN stripe_payment_status text DEFAULT 'unpaid';
  END IF;
END $$;