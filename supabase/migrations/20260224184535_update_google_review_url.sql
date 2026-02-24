/*
  # Update Google Review URL

  1. Changes
    - Update google_review_url setting with actual Bounce Party Club review link

  2. Purpose
    - Configure the correct Google review link for customer communications
*/

-- Update Google review URL setting with actual link
UPDATE admin_settings
SET value = 'https://g.page/r/CcALHMmxBHPSEBM/review'
WHERE key = 'google_review_url';
