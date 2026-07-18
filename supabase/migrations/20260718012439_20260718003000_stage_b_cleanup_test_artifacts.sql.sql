/*
# Stage B — Corrective migration: ensure no test harness artifacts remain

Safety-net migration. The test harness functions were already dropped via direct
SQL sessions after testing. This ensures no harness function or test data
survives in any environment that replays migrations. Idempotent.
*/
DROP FUNCTION IF EXISTS public._stage_b_test_harness() CASCADE;
DROP FUNCTION IF EXISTS public._stage_b_test_harness_fix() CASCADE;
DROP FUNCTION IF EXISTS public._stage_b_test_compat() CASCADE;

DELETE FROM product_bundles
WHERE slug LIKE 'stage-b-%'
   OR name LIKE 'STAGE-B-%'
   OR id IN (
     '11111111-1111-1111-1111-111111111111'::uuid,
     '55555555-5555-5555-5555-555555555555'::uuid,
     '66666666-6666-6666-6666-666666666666'::uuid
   );

DELETE FROM product_pricing
WHERE product_id IN (
  '77777777-7777-7777-7777-777777777777'::uuid,
  '00000000-0000-0000-0000-000000000099'::uuid
);

DELETE FROM inventory_products
WHERE slug LIKE 'stage-b-%'
   OR name LIKE 'STAGE-B-%'
   OR id = '77777777-7777-7777-7777-777777777777'::uuid;
