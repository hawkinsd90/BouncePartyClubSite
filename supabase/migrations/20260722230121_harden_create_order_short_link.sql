-- Corrective migration: replace create_order_short_link with hardened version.
-- Preserves order_portal_links table and resolve_portal_short_link RPC.

DROP FUNCTION IF EXISTS public.create_order_short_link(UUID);

CREATE OR REPLACE FUNCTION public.create_order_short_link(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_short_code text;
  v_attempts integer := 0;
  v_max_attempts integer := 20;
  v_user_role text;
  v_order_exists boolean;
BEGIN
  -- Defense in depth: role check
  v_user_role := public.get_user_role(auth.uid());

  IF v_user_role NOT IN ('master', 'admin', 'dispatcher', 'crew') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: only staff can create order short links'
    );
  END IF;

  -- Crew restriction: no reliable order-to-crew assignment exists in the schema.
  -- task_status, route_stops, crew_location_history, and orders have no user_id
  -- or crew_user_id column. Crew cannot be safely authorized per-order.
  -- Until an assignment relationship is added, crew is denied.
  IF v_user_role = 'crew' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: crew cannot create order short links without an assignment relationship'
    );
  END IF;

  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order ID');
  END IF;

  -- Validate order exists
  SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;
  IF NOT v_order_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  -- Check for existing active link
  SELECT short_code, expires_at
  INTO v_existing
  FROM order_portal_links
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.expires_at IS NULL OR v_existing.expires_at > now() THEN
      IF v_existing.short_code IS NOT NULL AND v_existing.short_code <> '' THEN
        RETURN jsonb_build_object('success', true, 'short_code', v_existing.short_code);
      END IF;
    END IF;
    DELETE FROM order_portal_links WHERE order_id = p_order_id;
  END IF;

  -- Generation loop with attempt limit INSIDE the loop
  LOOP
    v_attempts := v_attempts + 1;

    IF v_attempts > v_max_attempts THEN
      RETURN jsonb_build_object('success', false, 'error', 'Failed to generate unique short code');
    END IF;

    v_short_code := substring(
      encode(gen_random_bytes(9), 'base64'),
      1, 12
    );
    v_short_code := replace(replace(v_short_code, '+', '-'), '/', '_');

    IF EXISTS (SELECT 1 FROM order_portal_links WHERE short_code = v_short_code) THEN
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM invoice_links WHERE short_code = v_short_code) THEN
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO order_portal_links (order_id, short_code)
      VALUES (p_order_id, v_short_code);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      SELECT short_code INTO v_short_code
      FROM order_portal_links
      WHERE order_id = p_order_id
      AND (expires_at IS NULL OR expires_at > now());

      IF v_short_code IS NOT NULL AND v_short_code <> '' THEN
        RETURN jsonb_build_object('success', true, 'short_code', v_short_code);
      END IF;

      DELETE FROM order_portal_links WHERE order_id = p_order_id;
      CONTINUE;
    END;
  END LOOP;

  SELECT short_code INTO v_short_code
  FROM order_portal_links
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object('success', true, 'short_code', v_short_code);
END;
$$;

-- Revoke from PUBLIC, grant only to authenticated
REVOKE ALL ON FUNCTION public.create_order_short_link(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_short_link(UUID) TO authenticated;
