/*
# Phase 3A: Create product_categories, tighten product/pricing RLS, seed unit prices

1. New Tables
- `product_categories` — organizes inventory products into browsable customer categories
  - id (uuid, primary key)
  - slug (text, unique) — URL-safe identifier
  - name (text) — display name
  - sort_order (integer, default 0) — display ordering
  - active (boolean, default true) — soft disable
  - public_visible (boolean, default true) — hide from public catalog
  - created_at, updated_at (timestamptz)

2. Modified Tables
- `inventory_products` — added `category_id` (uuid, nullable, references product_categories.id)

3. Data Changes
- Seeds 5 categories: Tables, Chairs, Tents, Generators, Other Event Essentials
- Assigns six-foot-rectangular-table -> Tables category
- Assigns white-folding-chair -> Chairs category
- Fixes white-folding-chair description: "White resin folding chair" -> "White folding chair"
- Seeds individual product prices:
  - Table: standalone $12.00 (1200 cents), add-on $12.00 (1200 cents), both enabled
  - Chair: standalone $3.00 (300 cents), add-on $3.00 (300 cents), both enabled

4. Security Changes (RLS)
- product_categories: RLS enabled with public read (active + visible) and admin CRUD
- inventory_products: public SELECT policy tightened to require non-null category_id
  with matching active+visible category. Admin policy unchanged.
- product_pricing: public SELECT policy tightened to require product's category to be
  active+visible. Admin policy unchanged.
- Guarded: policy replacement only runs after confirming both existing public products
  have non-null category_id. If guard fails, exception is raised and policies are not replaced.

5. Triggers
- update_product_categories_timestamp: BEFORE UPDATE FOR EACH ROW on product_categories
  using existing reusable public.update_updated_at_column() function
*/

-- Step 1: Create product_categories table
CREATE TABLE IF NOT EXISTS product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  public_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Step 2: Add category_id to inventory_products
ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES product_categories(id);

-- Step 3: Seed categories
INSERT INTO product_categories (slug, name, sort_order)
VALUES
  ('tables', 'Tables', 1),
  ('chairs', 'Chairs', 2),
  ('tents', 'Tents', 3),
  ('generators', 'Generators', 4),
  ('other', 'Other Event Essentials', 5)
ON CONFLICT (slug) DO NOTHING;

-- Step 4: Backfill product category assignments
UPDATE inventory_products SET category_id = (
  SELECT id FROM product_categories WHERE slug = 'tables'
) WHERE slug = 'six-foot-rectangular-table';

UPDATE inventory_products SET category_id = (
  SELECT id FROM product_categories WHERE slug = 'chairs'
) WHERE slug = 'white-folding-chair';

-- Step 5: Fix chair description
UPDATE inventory_products SET description = 'White folding chair'
WHERE slug = 'white-folding-chair' AND description = 'White resin folding chair';

-- Step 6: Seed individual product prices
UPDATE product_pricing
SET standalone_price_cents = 1200, standalone_enabled = true,
    addon_price_cents = 1200, addon_enabled = true
WHERE product_id = (
  SELECT id FROM inventory_products WHERE slug = 'six-foot-rectangular-table'
);

UPDATE product_pricing
SET standalone_price_cents = 300, standalone_enabled = true,
    addon_price_cents = 300, addon_enabled = true
WHERE product_id = (
  SELECT id FROM inventory_products WHERE slug = 'white-folding-chair'
);

-- Step 7: Enable RLS on product_categories and add policies
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active visible categories" ON product_categories;
CREATE POLICY "Public can view active visible categories"
  ON product_categories FOR SELECT
  TO anon, authenticated
  USING (active = true AND public_visible = true);

DROP POLICY IF EXISTS "Admins can select all categories" ON product_categories;
CREATE POLICY "Admins can select all categories"
  ON product_categories FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can insert categories" ON product_categories;
CREATE POLICY "Admins can insert categories"
  ON product_categories FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

DROP POLICY IF EXISTS "Admins can update categories" ON product_categories;
CREATE POLICY "Admins can update categories"
  ON product_categories FOR UPDATE
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

DROP POLICY IF EXISTS "Admins can delete categories" ON product_categories;
CREATE POLICY "Admins can delete categories"
  ON product_categories FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ));

-- Step 8: Add updated_at trigger using existing reusable function
DROP TRIGGER IF EXISTS update_product_categories_timestamp ON product_categories;
CREATE TRIGGER update_product_categories_timestamp
  BEFORE UPDATE ON product_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 9: Guarded policy replacement for inventory_products and product_pricing
-- Only replace if both existing public products have non-null category_id
DO $$
DECLARE
  v_unassigned_count integer;
BEGIN
  SELECT COUNT(*) INTO v_unassigned_count
  FROM inventory_products
  WHERE slug IN ('six-foot-rectangular-table', 'white-folding-chair')
    AND active = true
    AND public_visible = true
    AND category_id IS NULL;

  IF v_unassigned_count > 0 THEN
    RAISE EXCEPTION
      'Backfill guard failed: % active/visible product(s) still have category_id = NULL. Aborting policy replacement.',
      v_unassigned_count;
  END IF;

  -- Replace inventory_products public SELECT policy
  DROP POLICY IF EXISTS "Public can view active visible products" ON inventory_products;
  CREATE POLICY "Public can view active visible products"
    ON inventory_products FOR SELECT
    TO anon, authenticated
    USING (
      active = true
      AND public_visible = true
      AND category_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM product_categories pc
        WHERE pc.id = inventory_products.category_id
          AND pc.active = true
          AND pc.public_visible = true
      )
    );

  -- Replace product_pricing public SELECT policy
  DROP POLICY IF EXISTS "Public can view pricing of active visible products" ON product_pricing;
  CREATE POLICY "Public can view pricing of active visible products"
    ON product_pricing FOR SELECT
    TO anon, authenticated
    USING (
      EXISTS (
        SELECT 1 FROM inventory_products ip
        WHERE ip.id = product_pricing.product_id
          AND ip.active = true
          AND ip.public_visible = true
          AND ip.category_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM product_categories pc
            WHERE pc.id = ip.category_id
              AND pc.active = true
              AND pc.public_visible = true
          )
      )
    );
END $$;
