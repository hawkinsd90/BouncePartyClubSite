/*
  # Fix Water Slide Pricing

  Water slides are always used in wet/water mode. The Tropical and Caribbean Water Slide
  units had price_water_cents = 0, which caused them to display as "(Dry)" and use the
  dry price incorrectly.

  ## Changes
  - Set price_water_cents equal to price_dry_cents for pure water slide units
    (units where types = '{Water Slide}' only, not combos)
  - These units have no dry mode — the price_dry_cents value is already the correct price
*/

UPDATE units
SET price_water_cents = price_dry_cents
WHERE 'Water Slide' = ANY(types)
  AND price_water_cents = 0
  AND price_dry_cents > 0;
