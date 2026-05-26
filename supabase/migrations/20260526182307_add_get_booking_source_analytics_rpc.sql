/*
  # RPC: get_booking_source_analytics

  ## Purpose
  Narrow SECURITY DEFINER function that returns per-order referral source rows
  for the Site Analytics booking sources panel. Replaces a direct browser-side
  SELECT on the orders table, which has no admin RLS policy.

  ## Why a SETOF function instead of jsonb
  The existing SiteAnalytics.tsx aggregates rows client-side (building a sourceMap).
  Returning SETOF rows keeps the downstream JS aggregation logic identical — only
  the one query call changes.

  ## Fields returned (exactly what the old direct query selected)
  - referral_source        text (nullable)
  - referral_source_detail text (nullable)
  - subtotal_cents         integer
  - tax_cents              integer (nullable)

  ## Security
  - SECURITY DEFINER with fixed search_path = public
  - Caller must be authenticated with role admin or master (via get_user_role())
  - No anon access
  - Status filter (void/draft/cancelled excluded) is enforced server-side

  ## Parameters
  - p_start timestamptz (optional, default -infinity)
  - p_end   timestamptz (optional, default now())
    Matches the same parameter convention as get_admin_analytics().
*/

CREATE OR REPLACE FUNCTION get_booking_source_analytics(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  referral_source        text,
  referral_source_detail text,
  subtotal_cents         integer,
  tax_cents              integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_start timestamptz := COALESCE(p_start, '-infinity'::timestamptz);
  v_end   timestamptz := COALESCE(p_end,   now());
BEGIN
  -- Enforce admin or master role
  SELECT get_user_role(auth.uid()) INTO v_role;
  IF v_role NOT IN ('admin', 'master') THEN
    RAISE EXCEPTION 'Permission denied: admin or master role required';
  END IF;

  RETURN QUERY
    SELECT
      o.referral_source,
      o.referral_source_detail,
      o.subtotal_cents,
      o.tax_cents
    FROM orders o
    WHERE o.status NOT IN ('void', 'draft', 'cancelled')
      AND o.created_at >= v_start
      AND o.created_at <= v_end;
END;
$$;

GRANT EXECUTE ON FUNCTION get_booking_source_analytics(timestamptz, timestamptz) TO authenticated;
