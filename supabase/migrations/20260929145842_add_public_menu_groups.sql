/*
# Create Public Menu Groups System

## Purpose
Allows admins to configure customer-facing navigation groups based on
existing Event Essentials product categories. These groups appear in the
public top navigation when their selected categories contain qualifying
inventory (physical count > 1).

## New Tables

### public_menu_groups
- id (uuid, primary key)
- title (text, not null) — customer-facing menu label, e.g. "Tables & Chairs"
- is_enabled (boolean, default true) — controls public visibility
- display_order (integer, default 0) — ordering in the nav
- created_at, updated_at (timestamptz)

### public_menu_group_categories
- menu_group_id (uuid, FK → public_menu_groups.id ON DELETE CASCADE)
- category_id (uuid, FK → product_categories.id ON DELETE CASCADE)
- PRIMARY KEY (menu_group_id, category_id)
- This is a normalized join table — no duplicated category data.

## New RPC

### get_public_nav_menu_groups()
SECURITY DEFINER function that returns enabled menu groups with:
- id, title, display_order
- category_slugs (array of slugs from product_categories)
- qualifying_inventory_count (sum of max(total_quantity - temp_unavailable_qty, 0)
  across active + public_visible products whose category is active + public_visible
  and belongs to the menu group)

Only returns groups where is_enabled = true.
Only counts products where active=true, public_visible=true, and the
category is active=true and public_visible=true.

## Security
- RLS enabled on both tables.
- Public (anon + authenticated) can SELECT only enabled menu groups.
- Admin/Master can do full CRUD on both tables.
- The RPC uses SECURITY DEFINER with an explicit safe search_path.
- Only safe, non-secret fields are exposed via the RPC.
*/

-- 1. Create public_menu_groups table
CREATE TABLE IF NOT EXISTS public_menu_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  is_enabled    boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. Create public_menu_group_categories join table
CREATE TABLE IF NOT EXISTS public_menu_group_categories (
  menu_group_id uuid NOT NULL REFERENCES public_menu_groups(id) ON DELETE CASCADE,
  category_id   uuid NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_group_id, category_id)
);

-- 3. Enable RLS
ALTER TABLE public_menu_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_menu_group_categories ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for public_menu_groups

-- Public can read enabled groups
DROP POLICY IF EXISTS "Public can read enabled menu groups" ON public_menu_groups;
CREATE POLICY "Public can read enabled menu groups"
  ON public_menu_groups FOR SELECT
  TO anon, authenticated
  USING (is_enabled = true);

-- Admins can read all groups
DROP POLICY IF EXISTS "Admins can read all menu groups" ON public_menu_groups;
CREATE POLICY "Admins can read all menu groups"
  ON public_menu_groups FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- Admins can insert
DROP POLICY IF EXISTS "Admins can insert menu groups" ON public_menu_groups;
CREATE POLICY "Admins can insert menu groups"
  ON public_menu_groups FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- Admins can update
DROP POLICY IF EXISTS "Admins can update menu groups" ON public_menu_groups;
CREATE POLICY "Admins can update menu groups"
  ON public_menu_groups FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- Admins can delete
DROP POLICY IF EXISTS "Admins can delete menu groups" ON public_menu_groups;
CREATE POLICY "Admins can delete menu groups"
  ON public_menu_groups FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- 5. RLS Policies for public_menu_group_categories

-- Public can read associations for enabled groups
DROP POLICY IF EXISTS "Public can read menu group categories" ON public_menu_group_categories;
CREATE POLICY "Public can read menu group categories"
  ON public_menu_group_categories FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public_menu_groups
      WHERE public_menu_groups.id = public_menu_group_categories.menu_group_id
      AND public_menu_groups.is_enabled = true
    )
  );

-- Admins can read all associations
DROP POLICY IF EXISTS "Admins can read all menu group categories" ON public_menu_group_categories;
CREATE POLICY "Admins can read all menu group categories"
  ON public_menu_group_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- Admins can insert
DROP POLICY IF EXISTS "Admins can insert menu group categories" ON public_menu_group_categories;
CREATE POLICY "Admins can insert menu group categories"
  ON public_menu_group_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- Admins can delete
DROP POLICY IF EXISTS "Admins can delete menu group categories" ON public_menu_group_categories;
CREATE POLICY "Admins can delete menu group categories"
  ON public_menu_group_categories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('ADMIN', 'MASTER')
    )
  );

-- 6. Updated_at trigger for public_menu_groups
CREATE OR REPLACE FUNCTION update_public_menu_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS public_menu_groups_updated_at ON public_menu_groups;
CREATE TRIGGER public_menu_groups_updated_at
  BEFORE UPDATE ON public_menu_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_public_menu_groups_updated_at();

-- 7. Index for display ordering
CREATE INDEX IF NOT EXISTS idx_public_menu_groups_display_order
  ON public_menu_groups (display_order);

-- 8. Public RPC to get nav menu groups with qualifying inventory counts
CREATE OR REPLACE FUNCTION public.get_public_nav_menu_groups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '[]'::jsonb;
  group_record RECORD;
  group_json jsonb;
  category_slugs text[];
  qualifying_count integer;
BEGIN
  FOR group_record IN
    SELECT id, title, display_order
    FROM public_menu_groups
    WHERE is_enabled = true
    ORDER BY display_order
  LOOP
    -- Get category slugs for this group (only active + public_visible categories)
    SELECT array_agg(pc.slug)
    INTO category_slugs
    FROM public_menu_group_categories pmgc
    JOIN product_categories pc ON pc.id = pmgc.category_id
    WHERE pmgc.menu_group_id = group_record.id
      AND pc.active = true
      AND pc.public_visible = true;

    -- Calculate qualifying inventory count
    -- Sum of max(total_quantity - temp_unavailable_qty, 0) across qualifying products
    -- Qualifying = active + public_visible products whose category is active + public_visible
    -- and belongs to this menu group
    SELECT COALESCE(SUM(
      GREATEST(ip.total_quantity - COALESCE(ip.temp_unavailable_qty, 0), 0)
    ), 0)
    INTO qualifying_count
    FROM inventory_products ip
    JOIN public_menu_group_categories pmgc ON pmgc.category_id = ip.category_id
    JOIN product_categories pc ON pc.id = ip.category_id
    WHERE pmgc.menu_group_id = group_record.id
      AND ip.active = true
      AND ip.public_visible = true
      AND pc.active = true
      AND pc.public_visible = true;

    group_json := jsonb_build_object(
      'id', group_record.id,
      'title', group_record.title,
      'display_order', group_record.display_order,
      'category_slugs', COALESCE(category_slugs, ARRAY[]::text[]),
      'qualifying_inventory_count', qualifying_count
    );

    result := result || jsonb_build_array(group_json);
  END LOOP;

  RETURN result;
END;
$$;

-- Grant execute to public roles
REVOKE EXECUTE ON FUNCTION public.get_public_nav_menu_groups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_nav_menu_groups() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_nav_menu_groups() TO authenticated;
