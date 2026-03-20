/*
  # Add require_card_on_file to orders

  ## Summary
  Adds a `require_card_on_file` column to the orders table to support the workflow
  where a deposit is waived but the admin still wants (or does not want) a card on file.

  ## Changes
  - New column `require_card_on_file` (boolean, default true) on the `orders` table
    - When true: customer must go through Stripe card setup even if $0 is due
    - When false: customer can accept the invoice without any payment/card interaction

  ## Notes
  - Existing orders default to true (preserve current behavior)
  - Only relevant when deposit_due_cents = 0 (deposit waived)
*/

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS require_card_on_file boolean DEFAULT true;
