/*
# Add Event Essentials Setup Fee minimum to pricing_rules

1. Modified Tables
- `pricing_rules`: add `event_essentials_setup_minimum_cents` integer column
  with NOT NULL DEFAULT 15000 and a CHECK constraint >= 0.

2. Purpose
- Makes the Setup Fee threshold configurable from Admin Pricing instead of
  hardcoded. Existing orders are NOT affected — this is a pricing
  configuration value, not an order value. The frozen effective fee remains
  stored on each order in `orders.setup_fee_cents`.

3. Important Notes
- Default 15000 ($150.00) preserves current behavior for all existing rows.
- A configured value of 0 is valid and effectively disables automatic Setup Fees.
- No RLS or policy changes needed — existing pricing_rules access controls apply.
*/

ALTER TABLE pricing_rules
  ADD COLUMN IF NOT EXISTS event_essentials_setup_minimum_cents integer NOT NULL DEFAULT 15000
  CHECK (event_essentials_setup_minimum_cents >= 0);
