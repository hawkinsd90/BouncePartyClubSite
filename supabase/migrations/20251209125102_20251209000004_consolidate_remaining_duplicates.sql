-- Consolidate Remaining Duplicate Policies Where Possible
-- Note: Most "duplicate" policies are actually intentional (user access vs admin access)
-- This only consolidates true duplicates where one policy is a strict superset of another

-- Fix check_unit_availability function (missing from earlier fix)
CREATE OR REPLACE FUNCTION public.check_unit_availability(
  p_unit_id uuid,
  p_start_date date,
  p_end_date date,
  p_exclude_order_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_inventory integer;
  max_booked integer;
  available_count integer;
BEGIN
  SELECT inventory INTO total_inventory
  FROM public.units
  WHERE id = p_unit_id;

  IF total_inventory IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(MAX(booked_count), 0) INTO max_booked
  FROM (
    SELECT o.event_date::date as booking_date, COUNT(*) as booked_count
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE oi.unit_id = p_unit_id
      AND o.status NOT IN ('draft', 'void', 'canceled')
      AND (p_exclude_order_id IS NULL OR o.id != p_exclude_order_id)
      AND o.event_date::date <= p_end_date
      AND COALESCE(o.event_end_date::date, o.event_date::date) >= p_start_date
    GROUP BY o.event_date::date
  ) AS booking_counts;

  available_count := total_inventory - max_booked;

  RETURN GREATEST(available_count, 0);
END;
$$;

-- Consolidate order_discounts policies
-- Remove the individual CRUD policies since "Admins can manage discounts" (FOR ALL) covers everything
DROP POLICY IF EXISTS "Authenticated users can view order discounts" ON order_discounts;
DROP POLICY IF EXISTS "Authenticated users can insert order discounts" ON order_discounts;
DROP POLICY IF EXISTS "Authenticated users can update order discounts" ON order_discounts;
DROP POLICY IF EXISTS "Authenticated users can delete order discounts" ON order_discounts;

-- Consolidate saved_discount_templates policies
-- Remove the individual CRUD policies since "Admins can manage discount templates" (FOR ALL) covers everything
DROP POLICY IF EXISTS "Authenticated users can view discount templates" ON saved_discount_templates;
DROP POLICY IF EXISTS "Authenticated users can insert discount templates" ON saved_discount_templates;
DROP POLICY IF EXISTS "Authenticated users can delete discount templates" ON saved_discount_templates;

-- Consolidate saved_fee_templates policies
-- Remove the individual CRUD policies since "Admins can manage fee templates" (FOR ALL) covers everything
DROP POLICY IF EXISTS "Authenticated users can view fee templates" ON saved_fee_templates;
DROP POLICY IF EXISTS "Authenticated users can insert fee templates" ON saved_fee_templates;
DROP POLICY IF EXISTS "Authenticated users can delete fee templates" ON saved_fee_templates;
