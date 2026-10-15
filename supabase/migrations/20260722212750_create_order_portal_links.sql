-- Create order_portal_links table and create_order_short_link RPC.
--
-- Root cause: The existing create_portal_short_link RPC requires an invoice
-- token (invoice_links.link_token). Standard booking requests created via
-- the Quote flow have no invoice_links row, so short-link generation always
-- fails for them.
--
-- This migration adds a narrow order-level portal-link table that does NOT
-- require an invoice token. The /i/:shortCode route (ShortLink.tsx) already
-- resolves short codes via invoice_links; we extend it to also check
-- order_portal_links.
--
-- Schema:
--   order_portal_links (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
--     short_code TEXT NOT NULL UNIQUE,
--     expires_at TIMESTAMPTZ,  -- nullable, matches invoice_links pattern
--     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
--     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   )
--
-- The create_order_short_link RPC:
--   1. Looks up an existing link for the order
--   2. Reuses the short_code if one exists
--   3. Otherwise generates a unique 8-char short code
--   4. Returns { success: true, short_code } or { success: false, error }

CREATE TABLE IF NOT EXISTS public.order_portal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  short_code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_portal_links_order_id
  ON public.order_portal_links (order_id);

-- Enable RLS
ALTER TABLE public.order_portal_links ENABLE ROW LEVEL SECURITY;

-- Anon can read short codes (needed for /i/:shortCode resolution)
CREATE POLICY "anon_select_order_portal_links"
  ON public.order_portal_links FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only authenticated (admin) can insert
CREATE POLICY "authenticated_insert_order_portal_links"
  ON public.order_portal_links FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only authenticated (admin) can update
CREATE POLICY "authenticated_update_order_portal_links"
  ON public.order_portal_links FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

-- Grant table privileges
GRANT SELECT ON public.order_portal_links TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.order_portal_links TO authenticated;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_order_portal_links_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_portal_links_updated_at ON public.order_portal_links;
CREATE TRIGGER trg_order_portal_links_updated_at
  BEFORE UPDATE ON public.order_portal_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_order_portal_links_updated_at();

-- create_order_short_link RPC
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
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing order ID');
  END IF;

  -- Check for existing link
  SELECT short_code, expires_at
  INTO v_existing
  FROM order_portal_links
  WHERE order_id = p_order_id
  AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;

  IF FOUND AND v_existing.short_code IS NOT NULL AND v_existing.short_code <> '' THEN
    RETURN jsonb_build_object('success', true, 'short_code', v_existing.short_code);
  END IF;

  -- Generate a unique short code
  LOOP
    v_attempts := v_attempts + 1;
    v_short_code := substring(
      md5(gen_random_uuid()::text || clock_timestamp()::text),
      1, 8
    );

    INSERT INTO order_portal_links (order_id, short_code)
    VALUES (p_order_id, v_short_code)
    ON CONFLICT (order_id) DO UPDATE
      SET short_code = EXCLUDED.short_code,
          updated_at = now()
    WHERE order_portal_links.short_code IS NULL
       OR order_portal_links.short_code = '';

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM order_portal_links
      WHERE short_code = v_short_code
      AND order_id <> p_order_id
    ) AND NOT EXISTS (
      SELECT 1 FROM invoice_links
      WHERE short_code = v_short_code
    );

    IF v_attempts > 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Failed to generate unique short code');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'short_code', v_short_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_short_link(UUID) TO anon, authenticated;

-- Extend the ShortLink resolver: update the existing invoice_links lookup
-- to also check order_portal_links if no invoice_links match.
-- This is done in the frontend ShortLink.tsx component, not in the database.
