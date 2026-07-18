/*
# Stage B — Package Pricing, Inflatable Eligibility & Mixed Components Schema

## Purpose
Additive schema foundation for threshold-based add-on pricing, inflatable
prerequisite modes, and inflatables as direct package components. This is the
database foundation only — no customer pricing behavior or Admin UI changes.

## New Columns
1. product_pricing.addon_qualifying_threshold_cents (integer, nullable)
   - NULL = no threshold configured yet
   - When addon_enabled = true, this threshold (using eligible cart items
     outside the product's own category) unlocks the add-on price
   - CHECK: NULL or >= 0
2. product_bundles.addon_qualifying_threshold_cents (integer, nullable)
   - NULL = no threshold configured yet
   - CHECK: NULL or >= 0
3. product_bundles.inflatable_eligibility_mode (text, not null, default 'none')
   - One of: 'none', 'any', 'selected'
   - 'none' = no inflatable required
   - 'any' = at least one inflatable must be in cart
   - 'selected' = at least one specifically selected inflatable must be in cart
   - CHECK constraint enforces allowed values
   - Existing packages default to 'none' (preserves current behavior)

## New Tables
1. product_bundle_excluded_categories
   - Categories excluded from a package's add-on qualifying subtotal
   - PK: (bundle_id, category_id)
   - FK: bundle_id -> product_bundles(id) ON DELETE CASCADE
   - FK: category_id -> product_categories(id) ON DELETE RESTRICT
     (Deleting a category referenced by a package pricing rule must NOT silently
      change package pricing. Category deletion workflow should reassign/remove
      references first.)
2. package_inflatable_eligibility
   - Specifically selected inflatables that satisfy a 'selected' mode package
   - PK: (bundle_id, unit_id)
   - FK: bundle_id -> product_bundles(id) ON DELETE CASCADE
   - FK: unit_id -> units(id) ON DELETE RESTRICT
     (Units in this project are soft-deactivated via active=false, not hard
      deleted. RESTRICT still guards against accidental hard deletes while a
      package depends on the unit as an eligibility prerequisite.)
3. package_inflatable_components
   - Inflatables directly included as package components
   - PK: id (uuid)
   - Unique: (bundle_id, unit_id, selection_mode)
   - FK: bundle_id -> product_bundles(id) ON DELETE CASCADE
   - FK: unit_id -> units(id) ON DELETE RESTRICT
   - CHECK: quantity_per_bundle > 0
   - CHECK: selection_mode IN ('dry', 'water', 'customer_choice')

## Indexes
- product_bundle_excluded_categories(bundle_id)
- product_bundle_excluded_categories(category_id)
- package_inflatable_eligibility(bundle_id)
- package_inflatable_eligibility(unit_id)
- package_inflatable_components(bundle_id)
- package_inflatable_components(unit_id)

## Security
- RLS enabled on all three new tables
- Admin/master full CRUD (select/insert/update/delete) via user_roles check
- Public SELECT (anon, authenticated) scoped to rows whose parent bundle is
  active=true AND public_visible=true
- Public SELECT on inflatable tables additionally scoped to active units
- No direct anon writes (all writes go through SECURITY DEFINER RPCs)

## Backfill
- product_pricing.addon_qualifying_threshold_cents: NULL (no forced values)
- product_bundles.addon_qualifying_threshold_cents: NULL
- product_bundles.inflatable_eligibility_mode: 'none' via column default
- New relationship tables: empty for all existing packages

## Backward Compatibility
- v1 save_product_bundle and save_inventory_product are NOT modified here
- v1 INSERT/UPDATE use explicit column lists, so new columns receive defaults
  on create and are preserved on update — v1 saves will NOT erase thresholds
  or eligibility mode
- Existing customer catalog pricing is unchanged
*/

-- ---------------------------------------------------------------------------
-- A. product_pricing: add-on qualifying threshold
-- ---------------------------------------------------------------------------
ALTER TABLE product_pricing
  ADD COLUMN IF NOT EXISTS addon_qualifying_threshold_cents integer;

ALTER TABLE product_pricing
  DROP CONSTRAINT IF EXISTS product_pricing_addon_threshold_nonnegative;
ALTER TABLE product_pricing
  ADD CONSTRAINT product_pricing_addon_threshold_nonnegative
  CHECK (addon_qualifying_threshold_cents IS NULL OR addon_qualifying_threshold_cents >= 0);

-- ---------------------------------------------------------------------------
-- B & D. product_bundles: add-on threshold + inflatable eligibility mode
-- ---------------------------------------------------------------------------
ALTER TABLE product_bundles
  ADD COLUMN IF NOT EXISTS addon_qualifying_threshold_cents integer;

ALTER TABLE product_bundles
  ADD COLUMN IF NOT EXISTS inflatable_eligibility_mode text NOT NULL DEFAULT 'none';

ALTER TABLE product_bundles
  DROP CONSTRAINT IF EXISTS product_bundles_addon_threshold_nonnegative;
ALTER TABLE product_bundles
  ADD CONSTRAINT product_bundles_addon_threshold_nonnegative
  CHECK (addon_qualifying_threshold_cents IS NULL OR addon_qualifying_threshold_cents >= 0);

ALTER TABLE product_bundles
  DROP CONSTRAINT IF EXISTS product_bundles_inflatable_eligibility_mode_check;
ALTER TABLE product_bundles
  ADD CONSTRAINT product_bundles_inflatable_eligibility_mode_check
  CHECK (inflatable_eligibility_mode IN ('none', 'any', 'selected'));

-- Backfill is implicit: NOT NULL DEFAULT 'none' fills existing rows.

-- ---------------------------------------------------------------------------
-- C. product_bundle_excluded_categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_bundle_excluded_categories (
  bundle_id uuid NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES product_categories(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_id, category_id)
);

ALTER TABLE product_bundle_excluded_categories ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pbec_bundle_id
  ON product_bundle_excluded_categories(bundle_id);
CREATE INDEX IF NOT EXISTS idx_pbec_category_id
  ON product_bundle_excluded_categories(category_id);

-- ---------------------------------------------------------------------------
-- E. package_inflatable_eligibility
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS package_inflatable_eligibility (
  bundle_id uuid NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_id, unit_id)
);

ALTER TABLE package_inflatable_eligibility ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pie_bundle_id
  ON package_inflatable_eligibility(bundle_id);
CREATE INDEX IF NOT EXISTS idx_pie_unit_id
  ON package_inflatable_eligibility(unit_id);

-- ---------------------------------------------------------------------------
-- F. package_inflatable_components
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS package_inflatable_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  quantity_per_bundle integer NOT NULL,
  selection_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bundle_id, unit_id, selection_mode)
);

ALTER TABLE package_inflatable_components ENABLE ROW LEVEL SECURITY;

ALTER TABLE package_inflatable_components
  DROP CONSTRAINT IF EXISTS package_inflatable_components_qty_positive;
ALTER TABLE package_inflatable_components
  ADD CONSTRAINT package_inflatable_components_qty_positive
  CHECK (quantity_per_bundle > 0);

ALTER TABLE package_inflatable_components
  DROP CONSTRAINT IF EXISTS package_inflatable_components_selection_mode_check;
ALTER TABLE package_inflatable_components
  ADD CONSTRAINT package_inflatable_components_selection_mode_check
  CHECK (selection_mode IN ('dry', 'water', 'customer_choice'));

CREATE INDEX IF NOT EXISTS idx_pic_bundle_id
  ON package_inflatable_components(bundle_id);
CREATE INDEX IF NOT EXISTS idx_pic_unit_id
  ON package_inflatable_components(unit_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: product_bundle_excluded_categories
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can select all excluded categories" ON product_bundle_excluded_categories;
CREATE POLICY "Admins can select all excluded categories"
  ON product_bundle_excluded_categories FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can insert excluded categories" ON product_bundle_excluded_categories;
CREATE POLICY "Admins can insert excluded categories"
  ON product_bundle_excluded_categories FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can update excluded categories" ON product_bundle_excluded_categories;
CREATE POLICY "Admins can update excluded categories"
  ON product_bundle_excluded_categories FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can delete excluded categories" ON product_bundle_excluded_categories;
CREATE POLICY "Admins can delete excluded categories"
  ON product_bundle_excluded_categories FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Public can view excluded categories of active visible bundles" ON product_bundle_excluded_categories;
CREATE POLICY "Public can view excluded categories of active visible bundles"
  ON product_bundle_excluded_categories FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM product_bundles pb
    WHERE pb.id = product_bundle_excluded_categories.bundle_id
      AND pb.active = true
      AND pb.public_visible = true
  ));

-- ---------------------------------------------------------------------------
-- RLS Policies: package_inflatable_eligibility
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can select all package inflatable eligibility" ON package_inflatable_eligibility;
CREATE POLICY "Admins can select all package inflatable eligibility"
  ON package_inflatable_eligibility FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can insert package inflatable eligibility" ON package_inflatable_eligibility;
CREATE POLICY "Admins can insert package inflatable eligibility"
  ON package_inflatable_eligibility FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can update package inflatable eligibility" ON package_inflatable_eligibility;
CREATE POLICY "Admins can update package inflatable eligibility"
  ON package_inflatable_eligibility FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can delete package inflatable eligibility" ON package_inflatable_eligibility;
CREATE POLICY "Admins can delete package inflatable eligibility"
  ON package_inflatable_eligibility FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Public can view eligibility of active visible bundles with active units" ON package_inflatable_eligibility;
CREATE POLICY "Public can view eligibility of active visible bundles with active units"
  ON package_inflatable_eligibility FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM product_bundles pb
      WHERE pb.id = package_inflatable_eligibility.bundle_id
        AND pb.active = true
        AND pb.public_visible = true
    )
    AND EXISTS (
      SELECT 1 FROM units u
      WHERE u.id = package_inflatable_eligibility.unit_id
        AND u.active = true
    )
  );

-- ---------------------------------------------------------------------------
-- RLS Policies: package_inflatable_components
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can select all package inflatable components" ON package_inflatable_components;
CREATE POLICY "Admins can select all package inflatable components"
  ON package_inflatable_components FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can insert package inflatable components" ON package_inflatable_components;
CREATE POLICY "Admins can insert package inflatable components"
  ON package_inflatable_components FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can update package inflatable components" ON package_inflatable_components;
CREATE POLICY "Admins can update package inflatable components"
  ON package_inflatable_components FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can delete package inflatable components" ON package_inflatable_components;
CREATE POLICY "Admins can delete package inflatable components"
  ON package_inflatable_components FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Public can view inflatable components of active visible bundles with active units" ON package_inflatable_components;
CREATE POLICY "Public can view inflatable components of active visible bundles with active units"
  ON package_inflatable_components FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM product_bundles pb
      WHERE pb.id = package_inflatable_components.bundle_id
        AND pb.active = true
        AND pb.public_visible = true
    )
    AND EXISTS (
      SELECT 1 FROM units u
      WHERE u.id = package_inflatable_components.unit_id
        AND u.active = true
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (explicit, least-privilege — avoid the earlier category-grant omission)
-- ---------------------------------------------------------------------------
GRANT SELECT ON product_bundle_excluded_categories TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_bundle_excluded_categories TO authenticated;

GRANT SELECT ON package_inflatable_eligibility TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON package_inflatable_eligibility TO authenticated;

GRANT SELECT ON package_inflatable_components TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON package_inflatable_components TO authenticated;
