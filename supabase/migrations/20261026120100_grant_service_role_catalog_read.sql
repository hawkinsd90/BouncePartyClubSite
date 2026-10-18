/*
  # service_role read access to the Event Essentials catalog (Step 3B: SEC-016)

  Step 3B corrective migration. It belongs to the coordinated Step 4 Development rollout (and, after Development is proven and a release is
  approved, the separate Production release) and is applied only through the approved Step 4 mechanism, in version order, after the October
  block (20261025120000) and the earlier Step 3B files, together with the read-only pre/post checks in
  audit/security/step3b-verification-rules.json. It is never run ad hoc; the migration history records it only after it succeeded.

  ## Problem
  Hosted Development denies `service_role` SELECT on eight Event Essentials catalog tables (verified live, 2026-10-17). The
  `create-booking` Edge Function reads them with a service-role client, so booking creation on Development fails with a
  permission error. On Production the tables do not exist yet; after the recovered chain runs they receive `service_role` rights from
  Production's default privileges, so there the statement below is a harmless no-op.

  ## Fix
  SELECT only, on exactly the eight tables `create-booking` reads (directly or through its bundle select), to `service_role` only.
  No write privilege, and nothing for `anon` or `authenticated`. Tables that do not exist are skipped, so the file is safe on any
  database in the recovery order. Safe to run twice.
*/

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_products', 'product_pricing', 'product_categories', 'product_bundles',
    'product_bundle_components', 'package_inflatable_components', 'package_inflatable_eligibility',
    'product_bundle_excluded_categories'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', t);
    ELSE
      RAISE NOTICE 'service_role catalog read: public.% does not exist, skipped', t;
    END IF;
  END LOOP;
END $$;
