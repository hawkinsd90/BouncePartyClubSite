-- Create the create_portal_short_link RPC function.
--
-- Root cause: createShortPortalLink() in src/lib/utils.ts calls
-- supabaseClient.rpc('create_portal_short_link', { p_invoice_token })
-- but this RPC did not exist in the database, causing every short-link
-- creation to fall back to the full /customer-portal/<order-id> URL.
--
-- This function:
-- 1. Looks up the invoice_links row by link_token
-- 2. If a short_code already exists, reuses it
-- 3. Otherwise generates a random 8-char base32 short code
-- 4. Updates the row with the short_code
-- 5. Returns { success: true, short_code } on success
-- 6. Returns { success: false, error } on failure

CREATE OR REPLACE FUNCTION public.create_portal_short_link(p_invoice_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link record;
  v_short_code text;
  v_attempts integer := 0;
BEGIN
  IF p_invoice_token IS NULL OR p_invoice_token = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing invoice token');
  END IF;

  SELECT id, short_code, order_id, expires_at
  INTO v_link
  FROM invoice_links
  WHERE link_token = p_invoice_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice link not found');
  END IF;

  -- Reuse existing short code
  IF v_link.short_code IS NOT NULL AND v_link.short_code <> '' THEN
    RETURN jsonb_build_object('success', true, 'short_code', v_link.short_code);
  END IF;

  -- Generate a unique short code (8 chars from Crockford base32 alphabet)
  LOOP
    v_attempts := v_attempts + 1;
    v_short_code := substring(
      md5(gen_random_uuid()::text || clock_timestamp()::text),
      1, 8
    );

    INSERT INTO invoice_links (id, short_code)
    VALUES (v_link.id, v_short_code)
    ON CONFLICT (id) DO UPDATE SET short_code = EXCLUDED.short_code;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM invoice_links
      WHERE short_code = v_short_code
      AND id <> v_link.id
    );

    IF v_attempts > 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Failed to generate unique short code');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'short_code', v_short_code);
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION public.create_portal_short_link(text) TO anon, authenticated;