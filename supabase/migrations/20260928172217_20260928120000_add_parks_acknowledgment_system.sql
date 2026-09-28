/*
# Add Parks Acknowledgment System

## Purpose
Replaces the hardcoded Wayne County order-ID waiver exception with a
reusable, admin-controlled feature. When enabled on an order, the
customer's waiver receives an additional Section 15 acknowledging that
the inflatable equipment is not operated by the county or county parks
of the order's event/delivery address.

## Changes to existing tables
- `orders` — two new columns:
  - `parks_acknowledgment_required` (boolean, NOT NULL, default false)
    Admin-controlled flag. When true, Section 15 is appended to the
    waiver text for unsigned/generated waivers.
  - `parks_acknowledgment_county` (text, nullable)
    The resolved county name (e.g. "Wayne", "Washtenaw") for the
    event/delivery address. Null when the feature is disabled.

## Data migration
- The original hardcoded Wayne County order
  (4ae9723c-936f-4155-ad93-2e47ef844feb) is backfilled with
  parks_acknowledgment_required = true and
  parks_acknowledgment_county = 'Wayne' so the new DB-driven mechanism
  preserves its existing behavior.

## Security
- No new tables. RLS is already enabled on `orders`. The new columns
  inherit existing order-level RLS policies — no new policies needed.

## Notes
- The `addresses` table is NOT modified.
- No address backfill is performed.
- Historical signed waiver snapshots are NOT touched.
*/

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS parks_acknowledgment_required boolean NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS parks_acknowledgment_county text;

-- Backfill the original hardcoded Wayne County order so the new
-- DB-driven mechanism preserves its existing waiver behavior.
UPDATE orders
  SET parks_acknowledgment_required = true,
      parks_acknowledgment_county = 'Wayne'
  WHERE id = '4ae9723c-936f-4155-ad93-2e47ef844feb';
