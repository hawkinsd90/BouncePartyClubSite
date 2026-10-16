/*
  # Add get_booking_sources_analytics RPC

  ## Purpose
  Creates a SECURITY DEFINER function that returns booking source analytics
  for a given time period. Replaces the direct `orders` table query in
  SiteAnalytics.tsx, which was blocked by RLS for admin browser clients.

  ## Function: get_booking_sources_analytics(since, until)
  Parameters:
    - p_since timestamptz: start of period (required)
    - p_until timestamptz: end of period (NULL = now)

  Returns a JSON array of objects, each with:
    - referral_source (text | null): the source key, null = not captured
    - referral_source_detail (text | null): sub-detail where applicable
    - order_count (int): number of qualifying orders with this source
    - revenue_cents (bigint): sum of total_cents for those orders

  ## Security
    - SECURITY DEFINER: runs as function owner, bypasses RLS on orders
    - Admin check: verifies caller's auth.uid() has role 'admin' or 'master'
      in user_roles before returning any data
    - Returns empty array if caller is not admin/master

  ## Excluded statuses (match SiteAnalytics existing logic)
    - void, draft, cancelled
*/

CREATE OR REPLACE FUNCTION get_booking_sources_analytics(
  p_since timestamptz,
  p_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_uid uuid;
  caller_role text;
  result jsonb;
BEGIN
  -- Identify the caller
  caller_uid := auth.uid();

  -- Verify caller is admin or master
  SELECT role INTO caller_role
  FROM user_roles
  WHERE user_id = caller_uid
  LIMIT 1;

  IF caller_role IS NULL OR caller_role NOT IN ('admin', 'master') THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb) INTO result
  FROM (
    SELECT jsonb_build_object(
      'referral_source',        o.referral_source,
      'referral_source_detail', o.referral_source_detail,
      'order_count',            COUNT(*)::int,
      'revenue_cents',          COALESCE(SUM(o.total_cents), 0)::bigint
    ) AS row_data
    FROM orders o
    WHERE o.status NOT IN ('void', 'draft', 'cancelled')
      AND o.created_at >= p_since
      AND (p_until IS NULL OR o.created_at < p_until)
    GROUP BY o.referral_source, o.referral_source_detail
  ) grouped;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_booking_sources_analytics(timestamptz, timestamptz) TO authenticated;
