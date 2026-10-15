-- Grant base table privileges for new Tables & Chairs tables
GRANT SELECT ON inventory_products TO anon, authenticated;
GRANT SELECT ON product_bundles TO anon, authenticated;
GRANT SELECT ON product_bundle_components TO anon, authenticated;
GRANT SELECT ON product_pricing TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON inventory_products TO authenticated;
GRANT INSERT, UPDATE, DELETE ON product_bundles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON product_bundle_components TO authenticated;
GRANT INSERT, UPDATE, DELETE ON product_pricing TO authenticated;
