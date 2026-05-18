/*
  # Add Referral Source to Orders

  ## Summary
  Adds two new nullable text columns to the orders table to capture how customers
  heard about Bounce Party Club. This supports the "How did you hear about us?"
  question shown on the checkout screen and the customer invoice acceptance screen.

  ## New Columns
  - `referral_source` (text, nullable): The main dropdown selection.
    Constrained to a known set of values:
      social_media, google, physical_marketing, referral, returning_customer, other
  - `referral_source_detail` (text, nullable): Optional sub-selection or free-text detail.
    Examples: facebook, instagram, google_search, google_business, or a friend's name.

  ## Historical Orders
  All existing orders will have NULL for both columns. This is expected and
  displayed as "N/A / Not Captured" in analytics.

  ## Notes
  - No RLS changes required — existing orders RLS policies cover all columns.
  - referral_source_detail is always optional and may be NULL even for new orders.
  - The check constraint allows NULL (existing/backfill orders) or one of the six
    known values. Unknown sub-detail values are intentionally unconstrained since
    free-text is allowed.
*/

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS referral_source text,
  ADD COLUMN IF NOT EXISTS referral_source_detail text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_referral_source_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_referral_source_check
      CHECK (
        referral_source IS NULL OR referral_source IN (
          'social_media',
          'google',
          'physical_marketing',
          'referral',
          'returning_customer',
          'other'
        )
      );
  END IF;
END $$;
