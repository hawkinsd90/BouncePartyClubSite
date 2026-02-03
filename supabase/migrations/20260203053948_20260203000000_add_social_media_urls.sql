/*
  # Add Social Media URLs and Travel Address Preference

  1. Changes
    - Add Instagram URL setting
    - Add Facebook URL setting
    - Add preference for using business address for travel calculations
    - Remove deprecated business_website setting

  2. Settings
    - instagram_url: Instagram profile URL for social media links
    - facebook_url: Facebook page URL for social media links
    - use_business_address_for_travel: Boolean flag to use business address for travel calculations
*/

-- Add social media URL settings
INSERT INTO admin_settings (key, value, description)
VALUES
  ('instagram_url', 'http://instagram.com/bouncepartyclub', 'Instagram profile URL'),
  ('facebook_url', 'https://www.facebook.com/bouncepartyclub', 'Facebook page URL'),
  ('use_business_address_for_travel', 'true', 'Whether to use business address for travel calculations')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = now();

-- Remove the old business_website setting if it exists
DELETE FROM admin_settings WHERE key = 'business_website';
