/*
  # Add Payment Method Tracking to Payments

  1. Changes to `payments` table
    - Add `payment_method` column (text) - Describes how the payment was made
      Examples: 'card', 'cash', 'apple_pay', 'google_pay', 'link', etc.
    - Add `payment_brand` column (text, nullable) - Card brand if applicable
      Examples: 'visa', 'mastercard', 'amex', 'discover'
    - Add `payment_last4` column (text, nullable) - Last 4 digits of card if applicable

  2. Purpose
    - Enable receipts to display payment method details
    - Track payment types for reporting and reconciliation
    - Show customers how they paid on receipts

  3. Notes
    - Existing payment records will have NULL payment_method until updated
    - Edge functions will populate this field from Stripe PaymentMethod data
*/

-- Add payment method columns to payments table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE payments ADD COLUMN payment_method text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'payment_brand'
  ) THEN
    ALTER TABLE payments ADD COLUMN payment_brand text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'payment_last4'
  ) THEN
    ALTER TABLE payments ADD COLUMN payment_last4 text;
  END IF;
END $$;