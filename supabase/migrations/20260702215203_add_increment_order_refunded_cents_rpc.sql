CREATE OR REPLACE FUNCTION increment_order_refunded_cents(
  p_order_id uuid,
  p_amount_cents integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE orders
  SET total_refunded_cents = COALESCE(total_refunded_cents, 0) + p_amount_cents
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_order_refunded_cents(uuid, integer) TO authenticated;
