/*
  # Add Travel Fee Default Setting and Home Address
  
  1. New Settings
    - `apply_travel_fee_by_default` - Boolean flag to control if travel fee is automatically applied
    - `home_address_line1` - Company home address line 1
    - `home_address_line2` - Company home address line 2
    - `home_address_city` - Company home address city
    - `home_address_state` - Company home address state
    - `home_address_zip` - Company home address zip code
    - `home_address_lat` - Company home address latitude
    - `home_address_lng` - Company home address longitude
    
  2. Purpose
    - Allow admins to control whether travel fee is applied by default (similar to tax setting)
    - Store company home address in database instead of hardcoding
    - Use stored home address for all distance calculations and base radius
    
  3. Migration
    - Insert default settings if they don't exist
    - Default apply_travel_fee_by_default to true (current behavior)
    - Default home address to Wayne, MI (current hardcoded value)
*/

-- Insert apply_travel_fee_by_default setting (default to true to maintain current behavior)
INSERT INTO admin_settings (key, value, updated_at)
VALUES ('apply_travel_fee_by_default', 'true', NOW())
ON CONFLICT (key) DO NOTHING;

-- Insert default home address settings (Wayne, MI - current hardcoded value)
INSERT INTO admin_settings (key, value, updated_at)
VALUES 
  ('home_address_line1', '3200 S Wayne Rd', NOW()),
  ('home_address_line2', '', NOW()),
  ('home_address_city', 'Wayne', NOW()),
  ('home_address_state', 'MI', NOW()),
  ('home_address_zip', '48184', NOW()),
  ('home_address_lat', '42.2753', NOW()),
  ('home_address_lng', '-83.3863', NOW())
ON CONFLICT (key) DO NOTHING;
