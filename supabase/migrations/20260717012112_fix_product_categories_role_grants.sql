-- Grant missing privileges so RLS policies can take effect.
-- Without these grants the roles can't even reach the RLS check.
GRANT SELECT ON public.product_categories TO anon, authenticated;
GRANT SELECT ON public.inventory_products TO anon, authenticated;
GRANT SELECT ON public.product_pricing TO anon, authenticated;
GRANT SELECT ON public.product_bundles TO anon, authenticated;
GRANT SELECT ON public.product_bundle_components TO anon, authenticated;
