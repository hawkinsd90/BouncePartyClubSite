-- Stage E4 — Allow orders.surface to be NULL for Event Essentials-only orders.
--
-- The surface field (grass/cement) only applies to inflatables. EE-only orders
-- have no surface. Previously we stored 'cement' as a placeholder, which is
-- misleading. This migration drops the NOT NULL constraint while preserving
-- the CHECK constraint that limits non-null values to grass and cement.
--
-- Dev only — do not apply to production.

ALTER TABLE orders ALTER COLUMN surface DROP NOT NULL;

-- Recreate the CHECK constraint to allow NULL while keeping grass/cement
-- as the only valid non-null values.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_surface_check;
ALTER TABLE orders ADD CONSTRAINT orders_surface_check
  CHECK (surface IS NULL OR surface = ANY (ARRAY['grass'::text, 'cement'::text]));
