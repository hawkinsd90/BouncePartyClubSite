/*
  # Fix Home Address Default to Correct Address
  
  1. Purpose
    - Update the default home address from 3200 S Wayne Rd to the correct address: 4426 Woodward St
    - This matches the address used throughout the codebase
    - Update coordinates to match: 42.2808, -83.3863
    
  2. Changes
    - Update home_address_line1 to '4426 Woodward St'
    - Update coordinates to correct lat/lng
*/

-- Update home address to correct address (only if still set to the wrong default)
UPDATE admin_settings 
SET value = '4426 Woodward St', updated_at = NOW()
WHERE key = 'home_address_line1' AND value = '3200 S Wayne Rd';

-- Update latitude to correct value
UPDATE admin_settings 
SET value = '42.2808', updated_at = NOW()
WHERE key = 'home_address_lat' AND value = '42.2753';

-- Update longitude to correct value  
UPDATE admin_settings 
SET value = '-83.3863', updated_at = NOW()
WHERE key = 'home_address_lng' AND value = '-83.3863';
