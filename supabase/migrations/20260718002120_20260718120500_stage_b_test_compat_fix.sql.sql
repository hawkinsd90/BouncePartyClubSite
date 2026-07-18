/* Stage B — fix compat harness: explicit text casts for v1 RPC string args */
CREATE OR REPLACE FUNCTION public._stage_b_test_compat()
RETURNS TABLE(case_id text, status text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_master_uid uuid := 'f460cd91-01a9-4943-8b3d-18f9000ffa85';
  v_test_bundle_id uuid := '11111111-1111-1111-1111-111111111111';
  v_block_party_id uuid := 'a8869bcb-6771-4022-82a6-635425c85b39';
  v_tables_cat uuid := '98b08f65-2586-48b3-98bb-06803885b02d';
  v_table_prod uuid := 'aeed01e4-73a3-40a0-bb01-82ec2f60ee73';
  v_test_product_id uuid := '77777777-7777-7777-7777-777777777777';
  v_threshold int;
  v_mode text;
  v_count int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_master_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_master_uid::text)::text, true);

  -- Set Stage B config on test bundle via v2
  PERFORM public.save_product_bundle_v2(
    'update'::text, v_test_bundle_id, 'stage-b-test-prod-only'::text, 'STAGE-B-TEST Product Only'::text,
    null::text, null::text, null::int, null::int, false, false, false, false, false, false, 999,
    jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2')),
    15000, 'selected'::text, ARRAY[v_tables_cat], ARRAY[v_block_party_id], '[]'::jsonb
  );

  -- CASE 18: v1 save_product_bundle does NOT erase threshold/mode/eligibility
  PERFORM public.save_product_bundle(
    'update'::text, v_test_bundle_id, 'stage-b-test-prod-only'::text, 'STAGE-B-TEST Product Only'::text,
    null::text, null::text, null::int, null::int, false, false, false, false, false, false, 999,
    jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2'))
  );
  SELECT addon_qualifying_threshold_cents, inflatable_eligibility_mode INTO v_threshold, v_mode
  FROM product_bundles WHERE id = v_test_bundle_id;
  SELECT count(*) INTO v_count FROM package_inflatable_eligibility WHERE bundle_id = v_test_bundle_id;
  IF v_threshold = 15000 AND v_mode = 'selected' AND v_count = 1 THEN
    RETURN QUERY SELECT '18'::text, 'PASS'::text, 'v1 save preserved threshold+mode+eligibility'::text;
  ELSE
    RETURN QUERY SELECT '18'::text, 'FAIL'::text, 'v1 erased: threshold=' || COALESCE(v_threshold::text,'null') || ' mode=' || COALESCE(v_mode,'null') || ' elig=' || v_count::text;
  END IF;

  -- CASE 19: v1 availability quick toggle does NOT erase Stage B config
  PERFORM public.save_product_bundle(
    'update'::text, v_test_bundle_id, 'stage-b-test-prod-only'::text, 'STAGE-B-TEST Product Only'::text,
    null::text, null::text, null::int, null::int, false, false, true, true, true, false, 999,
    jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2'))
  );
  SELECT addon_qualifying_threshold_cents, inflatable_eligibility_mode INTO v_threshold, v_mode
  FROM product_bundles WHERE id = v_test_bundle_id;
  SELECT count(*) INTO v_count FROM package_inflatable_eligibility WHERE bundle_id = v_test_bundle_id;
  IF v_threshold = 15000 AND v_mode = 'selected' AND v_count = 1 THEN
    RETURN QUERY SELECT '19'::text, 'PASS'::text, 'availability toggle preserved config'::text;
  ELSE
    RETURN QUERY SELECT '19'::text, 'FAIL'::text, 'toggle erased config'::text;
  END IF;

  -- CASE 20: Existing Celebration Seating can be updated through v1
  BEGIN
    PERFORM public.save_product_bundle(
      'update'::text, 'cde247f7-522c-44f8-a6fc-a0bea426acb4'::uuid, 'celebration-seating'::text,
      'Celebration Seating'::text, null::text, null::text, 10000, 5000, true, false, true, true, false, false, 10,
      jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '1'))
    );
    RETURN QUERY SELECT '20'::text, 'PASS'::text, 'celebration-seating v1 update works'::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '20'::text, 'FAIL'::text, SQLERRM::text;
  END;

  -- CASE 15: v2 create product with threshold
  BEGIN
    PERFORM public.save_inventory_product_v2(
      'create'::text, v_test_product_id, 'stage-b-test-product'::text, 'STAGE-B-TEST Product'::text,
      null::text, 10, 0, true, true, v_tables_cat, 500, 1000, 200, true, false, 15000
    );
    SELECT addon_qualifying_threshold_cents INTO v_threshold FROM product_pricing WHERE product_id = v_test_product_id;
    IF v_threshold = 15000 THEN
      RETURN QUERY SELECT '15'::text, 'PASS'::text, 'product created with threshold 15000'::text;
    ELSE
      RETURN QUERY SELECT '15'::text, 'FAIL'::text, 'threshold not saved: ' || COALESCE(v_threshold::text,'null');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '15'::text, 'FAIL'::text, SQLERRM::text;
  END;

  -- CASE 12: v1 product update does NOT erase stored threshold
  PERFORM public.save_inventory_product(
    'update'::text, v_test_product_id, 'stage-b-test-product'::text, 'STAGE-B-TEST Product'::text,
    null::text, 10, 0, true, true, v_tables_cat, 500, 1000, 200, true, false
  );
  SELECT addon_qualifying_threshold_cents INTO v_threshold FROM product_pricing WHERE product_id = v_test_product_id;
  IF v_threshold = 15000 THEN
    RETURN QUERY SELECT '12'::text, 'PASS'::text, 'v1 update preserved threshold'::text;
  ELSE
    RETURN QUERY SELECT '12'::text, 'FAIL'::text, 'v1 erased threshold to: ' || COALESCE(v_threshold::text,'null');
  END IF;

  -- CASE 13: v2 product update saves new threshold
  PERFORM public.save_inventory_product_v2(
    'update'::text, v_test_product_id, 'stage-b-test-product'::text, 'STAGE-B-TEST Product'::text,
    null::text, 10, 0, true, true, v_tables_cat, 500, 1000, 200, true, false, 20000
  );
  SELECT addon_qualifying_threshold_cents INTO v_threshold FROM product_pricing WHERE product_id = v_test_product_id;
  IF v_threshold = 20000 THEN
    RETURN QUERY SELECT '13'::text, 'PASS'::text, 'v2 update saved new threshold 20000'::text;
  ELSE
    RETURN QUERY SELECT '13'::text, 'FAIL'::text, 'threshold not updated: ' || COALESCE(v_threshold::text,'null');
  END IF;

  -- CASE 14: Negative product threshold rejected via v2
  BEGIN
    PERFORM public.save_inventory_product_v2(
      'update'::text, v_test_product_id, 'stage-b-test-product'::text, 'STAGE-B-TEST Product'::text,
      null::text, 10, 0, true, true, v_tables_cat, 500, 1000, 200, true, false, -5
    );
    RETURN QUERY SELECT '14'::text, 'FAIL'::text, 'negative threshold accepted'::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '14'::text, 'PASS'::text, 'negative threshold rejected'::text;
  END;

  -- CASE 11: Existing save_inventory_product caller remains functional (v1 on real product)
  BEGIN
    PERFORM public.save_inventory_product(
      'update'::text, 'aeed01e4-73a3-40a0-bb01-82ec2f60ee73', 'six-foot-rectangular-table'::text,
      'Six-foot Rectangular Table'::text, null::text, 50, 0, true, true, v_tables_cat, 100, 1000, 200, true, false
    );
    RETURN QUERY SELECT '11'::text, 'PASS'::text, 'v1 product update functional'::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '11'::text, 'FAIL'::text, SQLERRM::text;
  END;

  -- CASE 45: Failed update preserves previous inflatable components
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update'::text, '66666666-6666-6666-6666-666666666666'::uuid, 'stage-b-test-mixed'::text,
      'STAGE-B-TEST Mixed'::text, null::text, null::text, null::int, null::int, false, false, true, true, false, false, 997,
      jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '1')),
      null::int, 'none'::text, '{}'::uuid[], '{}'::uuid[],
      jsonb_build_array(jsonb_build_object('unit_id', v_block_party_id, 'quantity_per_bundle', '1', 'selection_mode', 'bogus'))
    );
    RETURN QUERY SELECT '45'::text, 'FAIL'::text, 'failing update did not raise'::text;
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_count FROM package_inflatable_components WHERE bundle_id = '66666666-6666-6666-6666-666666666666'::uuid;
    IF v_count >= 1 THEN
      RETURN QUERY SELECT '45'::text, 'PASS'::text, 'inflatable components preserved after rollback'::text;
    ELSE
      RETURN QUERY SELECT '45'::text, 'FAIL'::text, 'components lost: count=' || v_count::text;
    END IF;
  END;

  -- CASE 47: Failed update preserves selected eligible inflatables
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update'::text, v_test_bundle_id, 'stage-b-test-prod-only'::text, 'STAGE-B-TEST Product Only'::text,
      null::text, null::text, null::int, null::int, false, false, true, true, false, false, 999,
      '[]'::jsonb, 15000, 'none'::text, '{}'::uuid[], '{}'::uuid[], '[]'::jsonb
    );
    RETURN QUERY SELECT '47'::text, 'FAIL'::text, 'zero-component available should have failed'::text;
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_count FROM package_inflatable_eligibility WHERE bundle_id = v_test_bundle_id;
    IF v_count = 1 THEN
      RETURN QUERY SELECT '47'::text, 'PASS'::text, 'eligible inflatables preserved after rollback'::text;
    ELSE
      RETURN QUERY SELECT '47'::text, 'FAIL'::text, 'eligibility lost: count=' || v_count::text;
    END IF;
  END;

END;
$function$;
