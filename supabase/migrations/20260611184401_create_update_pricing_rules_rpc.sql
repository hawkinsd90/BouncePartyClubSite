CREATE OR REPLACE FUNCTION update_pricing_rules(
  p_id uuid,
  p_base_radius_miles integer,
  p_per_mile_after_base_cents integer,
  p_surface_sandbag_fee_cents integer,
  p_deposit_per_unit_cents integer,
  p_included_cities text[],
  p_generator_fee_single_cents integer,
  p_generator_fee_multiple_cents integer,
  p_same_day_pickup_fee_cents integer,
  p_same_day_weekday_delivery_fee_cents integer,
  p_apply_taxes_by_default boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pricing_rules SET
    base_radius_miles = p_base_radius_miles,
    per_mile_after_base_cents = p_per_mile_after_base_cents,
    surface_sandbag_fee_cents = p_surface_sandbag_fee_cents,
    deposit_per_unit_cents = p_deposit_per_unit_cents,
    included_cities = p_included_cities,
    generator_fee_single_cents = p_generator_fee_single_cents,
    generator_fee_multiple_cents = p_generator_fee_multiple_cents,
    same_day_pickup_fee_cents = p_same_day_pickup_fee_cents,
    same_day_weekday_delivery_fee_cents = p_same_day_weekday_delivery_fee_cents,
    apply_taxes_by_default = p_apply_taxes_by_default
  WHERE id = p_id;
END;
$$;