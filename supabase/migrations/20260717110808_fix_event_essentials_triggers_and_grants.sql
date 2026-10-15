/*
# Fix Event Essentials Triggers and Grants

1. Purpose
   Grants authenticated INSERT/UPDATE/DELETE on the five Event Essentials tables
   so the existing admin/master RLS policies can actually execute. Without these
   base grants, RLS policies are unreachable — the role lacks the underlying
   table privileges to perform the operations the policies authorize.

   Also fixes three broken `updated_at` triggers that were incorrectly defined
   as `FOR EACH STATEMENT` while the shared function body references `NEW`.
   PostgreSQL does not bind `NEW` in statement-level triggers, so these triggers
   either error on UPDATE or silently fail to refresh `updated_at`.

2. Tables Affected
   - public.inventory_products
   - public.product_pricing
   - public.product_categories
   - public.product_bundles
   - public.product_bundle_components

3. Grants Added
   - INSERT, UPDATE, DELETE on all five tables TO authenticated
   - anon is NOT granted any write privileges
   - RLS remains the authoritative permission layer

4. Triggers Corrected (drop + recreate as FOR EACH ROW)
   - update_inventory_products_timestamp on public.inventory_products
   - update_product_pricing_timestamp on public.product_pricing
   - update_product_bundles_timestamp on public.product_bundles
   All three recreated as BEFORE UPDATE FOR EACH ROW using
   public.update_updated_at_column().

   The already-correct product_categories trigger is NOT touched.
   The update_updated_at_column() function is NOT altered.

5. Security
   - No RLS policies are removed or weakened
   - No anon write access is granted
   - RLS remains enforced on all five tables
*/

-- ---------------------------------------------------------------------------
-- Grant authenticated write privileges on Event Essentials tables
-- ---------------------------------------------------------------------------

GRANT INSERT, UPDATE, DELETE ON public.inventory_products TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_pricing TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_bundles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_bundle_components TO authenticated;

-- ---------------------------------------------------------------------------
-- Fix broken FOR EACH STATEMENT triggers → FOR EACH ROW
-- The shared function update_updated_at_column() references NEW,
-- which is only bound in row-level triggers.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS update_inventory_products_timestamp ON public.inventory_products;

CREATE TRIGGER update_inventory_products_timestamp
  BEFORE UPDATE ON public.inventory_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_pricing_timestamp ON public.product_pricing;

CREATE TRIGGER update_product_pricing_timestamp
  BEFORE UPDATE ON public.product_pricing
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_bundles_timestamp ON public.product_bundles;

CREATE TRIGGER update_product_bundles_timestamp
  BEFORE UPDATE ON public.product_bundles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
