CREATE OR REPLACE FUNCTION find_order_id_by_prefix(p_prefix text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM orders
  WHERE id::text ILIKE (lower(p_prefix) || '%')
  LIMIT 1;
$$;