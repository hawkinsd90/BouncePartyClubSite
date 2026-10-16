/*
  # Fix get_booking_sources_analytics: use correct revenue column

  The orders table does not have a total_cents column. Revenue per order
  is subtotal_cents + tax_cents. This replaces the function with the
  correct column reference.
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
  caller_uid := auth.uid();

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
      'revenue_cents',          COALESCE(SUM(o.subtotal_cents + o.tax_cents), 0)::bigint
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
