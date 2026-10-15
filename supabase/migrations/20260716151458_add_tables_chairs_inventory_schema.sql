-- ============================================================
-- Tables & Chairs Phase 1: Inventory schema
-- ============================================================

-- --------------------------------------------------------
-- Table: inventory_products
-- --------------------------------------------------------
CREATE TABLE inventory_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text,
  total_quantity integer NOT NULL,
  temp_unavailable_qty integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT false,
  public_visible boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_products_slug_unique UNIQUE (slug),
  CONSTRAINT inventory_products_total_qty_nonneg CHECK (total_quantity >= 0),
  CONSTRAINT inventory_products_temp_unavail_nonneg CHECK (temp_unavailable_qty >= 0),
  CONSTRAINT inventory_products_temp_le_total CHECK (temp_unavailable_qty <= total_quantity)
);

-- --------------------------------------------------------
-- Table: product_bundles
-- --------------------------------------------------------
CREATE TABLE product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text,
  standalone_price_cents integer,
  addon_price_cents integer,
  standalone_enabled boolean NOT NULL DEFAULT false,
  addon_enabled boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT false,
  public_visible boolean NOT NULL DEFAULT false,
  menu_visible boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_bundles_slug_unique UNIQUE (slug),
  CONSTRAINT product_bundles_standalone_price_nonneg
    CHECK (standalone_price_cents IS NULL OR standalone_price_cents >= 0),
  CONSTRAINT product_bundles_addon_price_nonneg
    CHECK (addon_price_cents IS NULL OR addon_price_cents >= 0),
  CONSTRAINT product_bundles_standalone_requires_price
    CHECK (NOT standalone_enabled OR standalone_price_cents IS NOT NULL),
  CONSTRAINT product_bundles_addon_requires_price
    CHECK (NOT addon_enabled OR addon_price_cents IS NOT NULL)
);

-- --------------------------------------------------------
-- Table: product_bundle_components
-- --------------------------------------------------------
CREATE TABLE product_bundle_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES inventory_products(id),
  quantity_per_bundle integer NOT NULL,
  CONSTRAINT product_bundle_components_bundle_product_unique
    UNIQUE (bundle_id, product_id),
  CONSTRAINT product_bundle_components_qty_positive
    CHECK (quantity_per_bundle > 0)
);

-- --------------------------------------------------------
-- Table: product_pricing
-- --------------------------------------------------------
CREATE TABLE product_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  standalone_price_cents integer,
  addon_price_cents integer,
  standalone_enabled boolean NOT NULL DEFAULT false,
  addon_enabled boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_pricing_product_unique UNIQUE (product_id),
  CONSTRAINT product_pricing_standalone_price_nonneg
    CHECK (standalone_price_cents IS NULL OR standalone_price_cents >= 0),
  CONSTRAINT product_pricing_addon_price_nonneg
    CHECK (addon_price_cents IS NULL OR addon_price_cents >= 0),
  CONSTRAINT product_pricing_standalone_requires_price
    CHECK (NOT standalone_enabled OR standalone_price_cents IS NOT NULL),
  CONSTRAINT product_pricing_addon_requires_price
    CHECK (NOT addon_enabled OR addon_price_cents IS NOT NULL)
);

-- --------------------------------------------------------
-- order_items additions (nullable, additive)
-- --------------------------------------------------------
ALTER TABLE order_items
  ADD COLUMN product_id uuid REFERENCES inventory_products(id),
  ADD COLUMN bundle_id uuid REFERENCES product_bundles(id),
  ADD COLUMN item_name text,
  ADD COLUMN component_snapshot jsonb,
  ADD COLUMN pricing_context text;

-- Constraints (safe: all 64 existing rows have unit_id NOT NULL, new cols NULL)
ALTER TABLE order_items
  ADD CONSTRAINT order_items_single_reference CHECK (
    num_nonnulls(unit_id, product_id, bundle_id) = 1
  );

ALTER TABLE order_items
  ADD CONSTRAINT order_items_pricing_context_valid CHECK (
    pricing_context IS NULL
    OR pricing_context = 'standalone'
    OR pricing_context = 'addon'
  );

-- --------------------------------------------------------
-- Indexes
-- --------------------------------------------------------
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
CREATE INDEX idx_order_items_bundle_id ON order_items(bundle_id);
CREATE INDEX idx_inventory_products_active_visible
  ON inventory_products(active, public_visible);
CREATE INDEX idx_product_bundles_active_visible
  ON product_bundles(active, public_visible);

-- --------------------------------------------------------
-- updated_at triggers (reuse existing generic function)
-- --------------------------------------------------------
CREATE TRIGGER update_inventory_products_timestamp
  BEFORE UPDATE ON inventory_products
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_product_bundles_timestamp
  BEFORE UPDATE ON product_bundles
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_product_pricing_timestamp
  BEFORE UPDATE ON product_pricing
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS
-- ============================================================

-- --------------------------------------------------------
-- inventory_products RLS
-- --------------------------------------------------------
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active visible products"
  ON inventory_products FOR SELECT TO anon, authenticated
  USING (active = true AND public_visible = true);

CREATE POLICY "Admins can select all products"
  ON inventory_products FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can insert products"
  ON inventory_products FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can update products"
  ON inventory_products FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can delete products"
  ON inventory_products FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

-- --------------------------------------------------------
-- product_bundles RLS
-- --------------------------------------------------------
ALTER TABLE product_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active visible bundles"
  ON product_bundles FOR SELECT TO anon, authenticated
  USING (active = true AND public_visible = true);

CREATE POLICY "Admins can select all bundles"
  ON product_bundles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can insert bundles"
  ON product_bundles FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can update bundles"
  ON product_bundles FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can delete bundles"
  ON product_bundles FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

-- --------------------------------------------------------
-- product_bundle_components RLS
-- --------------------------------------------------------
ALTER TABLE product_bundle_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view components of active visible bundles"
  ON product_bundle_components FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.product_bundles pb
      WHERE pb.id = product_bundle_components.bundle_id
        AND pb.active = true
        AND pb.public_visible = true
    )
  );

CREATE POLICY "Admins can select all bundle components"
  ON product_bundle_components FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can insert bundle components"
  ON product_bundle_components FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can update bundle components"
  ON product_bundle_components FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can delete bundle components"
  ON product_bundle_components FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

-- --------------------------------------------------------
-- product_pricing RLS
-- --------------------------------------------------------
ALTER TABLE product_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view pricing of active visible products"
  ON product_pricing FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_products ip
      WHERE ip.id = product_pricing.product_id
        AND ip.active = true
        AND ip.public_visible = true
    )
  );

CREATE POLICY "Admins can select all product pricing"
  ON product_pricing FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can insert pricing"
  ON product_pricing FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can update pricing"
  ON product_pricing FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));

CREATE POLICY "Admins can delete pricing"
  ON product_pricing FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND lower(role) = ANY (ARRAY['admin', 'master'])
  ));
