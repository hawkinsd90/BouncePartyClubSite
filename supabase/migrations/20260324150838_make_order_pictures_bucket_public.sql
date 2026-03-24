/*
  # Make order-pictures storage bucket public

  ## Problem
  The order-pictures bucket is private, so getPublicUrl() returns URLs
  that return 403/HTML when the browser tries to load them as images.

  ## Changes
  - Set order-pictures bucket to public so images load correctly in the customer portal
*/

UPDATE storage.buckets SET public = true WHERE name = 'order-pictures';
