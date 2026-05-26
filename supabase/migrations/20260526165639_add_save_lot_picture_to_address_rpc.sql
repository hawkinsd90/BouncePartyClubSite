/*
  # RPC: save_lot_picture_to_address

  ## Summary
  Secure server-side function that saves a lot photo to the event address of the order
  it belongs to. The address is derived server-side from the order — callers cannot
  supply an arbitrary address_id.

  ## Behavior
  1. Verifies caller is admin or master role.
  2. Fetches the order_lot_pictures row for the given ID.
  3. Resolves the order's address_id from the orders table.
  4. Refuses if the order has no address_id.
  5. Inserts into address_lot_pictures (upsert on conflict).
  6. Updates order_lot_pictures.address_id with the resolved address.
  7. Returns the address_lot_pictures.id of the saved (or pre-existing) row.

  ## Duplicate prevention
  Uses ON CONFLICT (address_id, file_path) DO NOTHING with a RETURNING clause,
  falling back to a SELECT if the row already existed.

  ## Security
  SECURITY DEFINER with a fixed search_path so it can write to tables
  regardless of the caller's RLS context, while still enforcing the admin/master
  role check as the first step.
*/

CREATE OR REPLACE FUNCTION save_lot_picture_to_address(
  p_order_lot_picture_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role           text;
  v_file_path      text;
  v_file_name      text;
  v_notes          text;
  v_order_id       uuid;
  v_address_id     uuid;
  v_result_id      uuid;
BEGIN
  -- 1. Verify caller role
  SELECT get_user_role(auth.uid()) INTO v_role;
  IF v_role NOT IN ('admin', 'master') THEN
    RAISE EXCEPTION 'Permission denied: admin or master role required';
  END IF;

  -- 2. Fetch lot picture row
  SELECT olp.file_path, olp.file_name, olp.notes, olp.order_id
  INTO v_file_path, v_file_name, v_notes, v_order_id
  FROM order_lot_pictures olp
  WHERE olp.id = p_order_lot_picture_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot picture not found: %', p_order_lot_picture_id;
  END IF;

  -- 3. Resolve the order's address_id
  SELECT o.address_id INTO v_address_id
  FROM orders o
  WHERE o.id = v_order_id;

  IF v_address_id IS NULL THEN
    RAISE EXCEPTION 'This order has no address — cannot save lot photo to address';
  END IF;

  -- 4. Insert into address_lot_pictures, ignore duplicate
  INSERT INTO address_lot_pictures (
    address_id,
    file_path,
    file_name,
    notes,
    saved_from_order_id,
    saved_from_order_lot_picture_id,
    saved_by
  )
  VALUES (
    v_address_id,
    v_file_path,
    v_file_name,
    v_notes,
    v_order_id,
    p_order_lot_picture_id,
    auth.uid()
  )
  ON CONFLICT (address_id, file_path) DO NOTHING
  RETURNING id INTO v_result_id;

  -- If the row already existed (conflict), fetch its id
  IF v_result_id IS NULL THEN
    SELECT id INTO v_result_id
    FROM address_lot_pictures
    WHERE address_id = v_address_id
      AND file_path = v_file_path;
  END IF;

  -- 5. Stamp address_id back onto the source order_lot_pictures row
  UPDATE order_lot_pictures
  SET address_id = v_address_id
  WHERE id = p_order_lot_picture_id
    AND address_id IS DISTINCT FROM v_address_id;

  RETURN v_result_id;
END;
$$;

-- Grant execute to authenticated users (role check is enforced inside)
GRANT EXECUTE ON FUNCTION save_lot_picture_to_address(uuid) TO authenticated;
