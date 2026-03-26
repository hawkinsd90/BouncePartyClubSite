/*
  # Backfill payment_method_last_four and payment_method_brand on orders

  ## Problem
  Orders that had a stripe_payment_method_id saved but whose payment_method_last_four
  / payment_method_brand columns were never populated show "Card on file" instead of
  the masked card number in the customer portal.

  ## Fix
  For every order that:
    - has a stripe_payment_method_id (card is on file)
    - is missing payment_method_last_four or payment_method_brand
  pull the most recent succeeded payment row for that order and copy its
  payment_last4 / payment_brand into the order record.

  ## Tables modified
  - orders: payment_method_last_four, payment_method_brand (SET only where currently NULL)
*/

UPDATE orders o
SET
  payment_method_last_four = p.payment_last4,
  payment_method_brand     = p.payment_brand
FROM (
  SELECT DISTINCT ON (order_id)
    order_id,
    payment_last4,
    payment_brand
  FROM payments
  WHERE status = 'succeeded'
    AND payment_last4 IS NOT NULL
  ORDER BY order_id, created_at DESC
) p
WHERE o.id = p.order_id
  AND o.stripe_payment_method_id IS NOT NULL
  AND (o.payment_method_last_four IS NULL OR o.payment_method_brand IS NULL);
