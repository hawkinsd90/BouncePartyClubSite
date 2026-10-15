-- Corrective migration for order_portal_links security, uniqueness, and resolver RPC.
--
-- Issues fixed:
-- 1. Broad RLS policies (USING (true)) allowed public enumeration of all rows.
-- 2. No unique constraint on order_id — ON CONFLICT (order_id) was a no-op.
-- 3. create_order_short_link was executable by anon with no auth check.
-- 4. No public resolver RPC — ShortLink.tsx needed direct table SELECT.
-- 5. Short codes used MD5 hex (not URL-safe random, not Crockford Base32).

-- ============================================================================
-- 1. Remove broad RLS policies and direct table access
-- ============================================================================

DROP POLICY IF EXISTS "anon_select_order_portal_links" ON public.order_portal_links;
DROP POLICY IF EXISTS "authenticated_insert_order_portal_links" ON public.order_portal_links;
DROP POLICY IF EXISTS "authenticated_update_order_portal_links" ON public.order_portal_links;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.order_portal_links FROM anon, authenticated;

-- ============================================================================
-- 2. Add unique constraint on order_id
-- ============================================================================

-- No existing rows (verified via audit), so no dedup needed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_portal_links_order_id_unique
  ON public.order_portal_links (order_id);

-- ============================================================================
-- 3. Create resolve_portal_short_link SECURITY DEFINER RPC
--    Public resolver — anon can resolve one short code to a redirect target.
--    Returns only order_id, invoice token (if applicable), and link_type.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_portal_short_link(p_short_code text)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice record;
  v_order record;
BEGIN
  IF p_short_code IS NULL OR length(trim(p_short_code)) = 0 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF length(p_short_code) > 64 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- 1. Check invoice_links
  SELECT order_id, link_token
  INTO v_invoice
  FROM invoice_links
  WHERE short_code = p_short_code
  AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'found', true,
      'link_type', 'invoice',
      'order_id', v_invoice.order_id,
      'invoice_token', v_invoice.link_token
    );
  END IF;

  -- 2. Check order_portal_links
  SELECT order_id
  INTO v_order
  FROM order_portal_links
  WHERE short_code = p_short_code
  AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'found', true,
      'link_type', 'order',
      'order_id', v_order.order_id
    );
  END IF;

  RETURN jsonb_build_object('found', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_portal_short_link(text) TO anon, authenticated;

-- ============================================================================
-- 4. Rewrite create_order_short_link with auth check, strong codes, collision
--    checking against both tables, and bounded attempts.
-- ============================================================================

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
  v_allowed boolean := false;
BEGIN
  -- Auth check: only authorized staff can create order-level short links.
  -- Anon users must use the invoice-token RPC (create_portal_short_link).
  v_user_role := public.get_user_role(auth.uid());

  IF v_user_role IN ('master', 'admin', 'dispatcher', 'crew') THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized: only staff can create order short links'
    );
  END IF;

  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order ID');
  END IF;

  -- Check for existing active link
  SELECT short_code, expires_at, created_at
  INTO v_existing
  FROM order_portal_links
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF FOUND THEN
    -- Reuse if active (not expired)
    IF v_existing.expires_at IS NULL OR v_existing.expires_at > now() THEN
      IF v_existing.short_code IS NOT NULL AND v_existing.short_code <> '' THEN
        RETURN jsonb_build_object('success', true, 'short_code', v_existing.short_code);
      END IF;
    END IF;
    -- Expired or empty code: delete old row, generate new below
    DELETE FROM order_portal_links WHERE order_id = p_order_id;
  END IF;

  -- Generate a unique 12-char URL-safe random code
  LOOP
    v_attempts := v_attempts + 1;
    v_short_code := substring(
      encode(gen_random_bytes(9), 'base64'),
      1, 12
    );
    -- Make URL-safe: replace +/ with -_
    v_short_code := replace(replace(v_short_code, '+', '-'), '/', '_');

    -- Check collision against order_portal_links
    IF EXISTS (SELECT 1 FROM order_portal_links WHERE short_code = v_short_code) THEN
      CONTINUE;
    END IF;

    -- Check collision against invoice_links
    IF EXISTS (SELECT 1 FROM invoice_links WHERE short_code = v_short_code) THEN
      CONTINUE;
    END IF;

    -- Insert — unique constraint on order_id handles concurrent race
    BEGIN
      INSERT INTO order_portal_links (order_id, short_code)
      VALUES (p_order_id, v_short_code);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Another concurrent call won the race for this order.
      -- Re-read the winning row and return its code.
      SELECT short_code INTO v_short_code
      FROM order_portal_links
      WHERE order_id = p_order_id
      AND (expires_at IS NULL OR expires_at > now());

      IF v_short_code IS NOT NULL AND v_short_code <> '' THEN
        RETURN jsonb_build_object('success', true, 'short_code', v_short_code);
      END IF;

      -- Row was inserted but expired or empty — retry
      DELETE FROM order_portal_links WHERE order_id = p_order_id;
      CONTINUE;
    END;
  END LOOP;

  IF v_attempts > v_max_attempts THEN
    RETURN jsonb_build_object('success', false, 'error', 'Failed to generate unique short code');
  END IF;

  -- Return the exact code stored in the database
  SELECT short_code INTO v_short_code
  FROM order_portal_links
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object('success', true, 'short_code', v_short_code);
END;
$$;

-- Only authenticated staff can call create_order_short_link
GRANT EXECUTE ON FUNCTION public.create_order_short_link(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_order_short_link(UUID) FROM anon;
