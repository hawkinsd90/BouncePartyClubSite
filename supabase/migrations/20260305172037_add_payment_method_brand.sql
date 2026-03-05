/*
  # Add payment_method_brand to orders table

  1. Changes
    - Add `payment_method_brand` (text) column to orders table
    - This stores the card brand (visa, mastercard, amex, etc.) for display purposes

  2. Purpose
    - Display payment method information in approval modals and customer portal
    - Improve user experience by showing card brand alongside last 4 digits
*/

-- Add payment_method_brand to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS payment_method_brand text;
