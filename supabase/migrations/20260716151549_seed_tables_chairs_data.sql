-- ============================================================
-- Tables & Chairs Phase 1: Seed data
-- All inserts use ON CONFLICT DO NOTHING to preserve Admin edits on rerun.
-- ============================================================

-- --------------------------------------------------------
-- Admin settings (key/value rows)
-- --------------------------------------------------------
INSERT INTO admin_settings (key, value, description)
VALUES
  ('tc_page_enabled', 'false', 'Controls whether the public Tables & Chairs route and navigation are enabled.'),
  ('min_table_chair_order_cents', '', 'Minimum subtotal for standalone Tables & Chairs orders.')
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------
-- Inventory products
-- --------------------------------------------------------
INSERT INTO inventory_products (slug, name, description, total_quantity, temp_unavailable_qty, active, public_visible, sort_order)
VALUES
  ('six-foot-rectangular-table', 'Six-foot Rectangular Table', '6ft rectangular folding table', 10, 0, false, false, 1),
  ('white-folding-chair', 'White Folding Chair', 'White resin folding chair', 100, 0, false, false, 2)
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------
-- Product bundles
-- --------------------------------------------------------
INSERT INTO product_bundles (slug, name, description, standalone_price_cents, addon_price_cents, standalone_enabled, addon_enabled, active, public_visible, menu_visible, featured, sort_order)
VALUES
  ('celebration-seating', 'Celebration Seating', '6 six-foot tables and 50 white folding chairs', 15000, NULL, true, false, false, false, false, false, 1),
  ('party-add-on-small', 'Party Add-On Small', '2 tables and 20 chairs', NULL, 5000, false, true, false, false, false, false, 2),
  ('party-add-on-medium', 'Party Add-On Medium', '3 tables and 30 chairs', NULL, 9000, false, true, false, false, false, false, 3)
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------
-- Bundle components (resolve IDs by slug)
-- --------------------------------------------------------
WITH table_product AS (SELECT id FROM inventory_products WHERE slug = 'six-foot-rectangular-table'),
     chair_product AS (SELECT id FROM inventory_products WHERE slug = 'white-folding-chair'),
     celeb_bundle AS (SELECT id FROM product_bundles WHERE slug = 'celebration-seating'),
     small_bundle AS (SELECT id FROM product_bundles WHERE slug = 'party-add-on-small'),
     medium_bundle AS (SELECT id FROM product_bundles WHERE slug = 'party-add-on-medium')
INSERT INTO product_bundle_components (bundle_id, product_id, quantity_per_bundle)
VALUES
  ((SELECT id FROM celeb_bundle), (SELECT id FROM table_product), 6),
  ((SELECT id FROM celeb_bundle), (SELECT id FROM chair_product), 50),
  ((SELECT id FROM small_bundle), (SELECT id FROM table_product), 2),
  ((SELECT id FROM small_bundle), (SELECT id FROM chair_product), 20),
  ((SELECT id FROM medium_bundle), (SELECT id FROM table_product), 3),
  ((SELECT id FROM medium_bundle), (SELECT id FROM chair_product), 30)
ON CONFLICT (bundle_id, product_id) DO NOTHING;

-- --------------------------------------------------------
-- Product pricing
-- --------------------------------------------------------
WITH table_product AS (SELECT id FROM inventory_products WHERE slug = 'six-foot-rectangular-table'),
     chair_product AS (SELECT id FROM inventory_products WHERE slug = 'white-folding-chair')
INSERT INTO product_pricing (product_id, standalone_price_cents, addon_price_cents, standalone_enabled, addon_enabled, sort_order)
VALUES
  ((SELECT id FROM table_product), NULL, NULL, false, false, 1),
  ((SELECT id FROM chair_product), NULL, NULL, false, false, 2)
ON CONFLICT (product_id) DO NOTHING;
