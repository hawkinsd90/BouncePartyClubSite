/*
  # Update Home Base to Wayne, MI

  This migration updates the pricing configuration to reflect the correct home base location
  and service area coverage.

  ## Changes Made:
  
  1. **Home Base Location**: Changed from Detroit to Wayne, MI (4426 Woodward St, Wayne, MI 48184)
     - Coordinates: 42.2808° N, 83.3863° W
  
  2. **Service Area Coverage**:
     - Free delivery within 20-mile radius of Wayne, MI
     - Free delivery to the entire city of Detroit (regardless of distance)
     - Travel fee of $5.00 per mile beyond the 20-mile radius
  
  3. **Updated Included Cities**:
     - Added "Detroit" to the included_city_list_json to ensure free delivery
  
  ## Notes:
  - The base_radius_miles remains at 20 miles
  - The per_mile_after_base_cents is updated to 500 ($5.00 per mile)
  - Detroit is explicitly included in the free delivery zone
*/

UPDATE pricing_rules
SET 
  per_mile_after_base_cents = 500,
  included_city_list_json = '["Detroit"]'::jsonb,
  updated_at = now()
WHERE id IS NOT NULL;
