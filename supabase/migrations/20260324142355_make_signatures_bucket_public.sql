/*
  # Make signatures storage bucket public

  ## Problem
  The signatures bucket is marked as private, but the signature_image_url stored in
  order_signatures uses /object/public/ URLs. Browsers block these with ERR_BLOCKED_BY_ORB
  because the storage server returns a non-image content type for private bucket objects
  when accessed without auth headers.

  ## Fix
  Make the signatures bucket public so the /object/public/ URLs work correctly.
  The signature images are referenced by URL in the order_signatures table and need
  to be publicly accessible for display in the customer portal.
*/

UPDATE storage.buckets
SET public = true
WHERE name = 'signatures';
