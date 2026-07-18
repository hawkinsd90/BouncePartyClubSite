/*
# Stage B — Fixed test harness for cases 25, 28, 31 (argument order fix)
Previous harness had p_excluded_category_ids and p_eligible_unit_ids swapped
in three cases. This replaces the function with corrected argument order.
The RPCs themselves were correct — this is a test-only fix.
*/
CREATE OR REPLACE FUNCTION public._stage_b_test_harness_fix()
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
  v_chairs_cat uuid := 'ecbe8fab-97f6-4716-9307-f959ad58bfd2';
  v_table_prod uuid := 'aeed01e4-73a3-40a0-bb01-82ec2f60ee73';
  v_table_id text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_master_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_master_uid::text)::text, true);

  -- CASE 25 (fixed): excluded categories in p_excluded_category_ids, empty eligible units
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update', v_test_bundle_id, 'stage-b-test-prod-only', 'STAGE-B-TEST Product Only',
      null, null, null, null, false, false, false, false, false, false, 999,
      jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2')),
      15000, 'none',
      ARRAY[v_tables_cat, v_chairs_cat],  -- p_excluded_category_ids (CORRECT position)
      '{}'::uuid[],                        -- p_eligible_unit_ids
      '[]'::jsonb
    );
    PERFORM 1 FROM product_bundle_excluded_categories WHERE bundle_id = v_test_bundle_id AND category_id = v_tables_cat;
    IF FOUND THEN
      RETURN QUERY SELECT '25'::text, 'PASS'::text, 'excluded categories saved'::text;
    ELSE
      RETURN QUERY SELECT '25'::text, 'FAIL'::text, 'excluded category not inserted'::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '25'::text, 'FAIL'::text, SQLERRM::text;
  END;

  -- CASE 28 (fixed): selected mode with eligible unit in p_eligible_unit_ids
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update', v_test_bundle_id, 'stage-b-test-prod-only', 'STAGE-B-TEST Product Only',
      null, null, null, null, false, false, false, false, false, false, 999,
      jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2')),
      15000, 'selected',
      ARRAY[v_tables_cat],                 -- p_excluded_category_ids
      ARRAY[v_block_party_id],             -- p_eligible_unit_ids (CORRECT position)
      '[]'::jsonb
    );
    PERFORM 1 FROM package_inflatable_eligibility WHERE bundle_id = v_test_bundle_id AND unit_id = v_block_party_id;
    IF FOUND THEN
      RETURN QUERY SELECT '28'::text, 'PASS'::text, 'selected mode with eligible unit'::text;
    ELSE
      RETURN QUERY SELECT '28'::text, 'FAIL'::text, 'eligibility row not inserted'::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '28'::text, 'FAIL'::text, SQLERRM::text;
  END;

  -- CASE 31 (fixed): invalid category in p_excluded_category_ids
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update', v_test_bundle_id, 'stage-b-test-prod-only', 'STAGE-B-TEST Product Only',
      null, null, null, null, false, false, false, false, false, false, 999,
      jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2')),
      15000, 'none',
      ARRAY['44444444-4444-4444-4444-444444444444'::uuid],  -- p_excluded_category_ids (CORRECT)
      '{}'::uuid[],
      '[]'::jsonb
    );
    RETURN QUERY SELECT '31'::text, 'FAIL'::text, 'invalid category accepted'::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '31'::text, 'PASS'::text, 'invalid category rejected'::text;
  END;

  -- CASE 32: Duplicate excluded category rejected
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update', v_test_bundle_id, 'stage-b-test-prod-only', 'STAGE-B-TEST Product Only',
      null, null, null, null, false, false, false, false, false, false, 999,
      jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2')),
      15000, 'none',
      ARRAY[v_tables_cat, v_tables_cat],  -- duplicate
      '{}'::uuid[],
      '[]'::jsonb
    );
    RETURN QUERY SELECT '32'::text, 'FAIL'::text, 'duplicate category accepted'::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '32'::text, 'PASS'::text, 'duplicate category rejected'::text;
  END;

  -- CASE 33: Duplicate eligible unit rejected
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update', v_test_bundle_id, 'stage-b-test-prod-only', 'STAGE-B-TEST Product Only',
      null, null, null, null, false, false, false, false, false, false, 999,
      jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2')),
      15000, 'selected',
      '{}'::uuid[],
      ARRAY[v_block_party_id, v_block_party_id],  -- duplicate
      '[]'::jsonb
    );
    RETURN QUERY SELECT '33'::text, 'FAIL'::text, 'duplicate unit accepted'::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '33'::text, 'PASS'::text, 'duplicate unit rejected'::text;
  END;

  -- CASE 38: Duplicate package/unit/mode component rejected
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update', v_test_bundle_id, 'stage-b-test-prod-only', 'STAGE-B-TEST Product Only',
      null, null, null, null, false, false, false, false, false, false, 999,
      jsonb_build_array(jsonb_build_object('product_id', v_table_prod, 'quantity_per_bundle', '2')),
      15000, 'none',
      '{}'::uuid[],
      '{}'::uuid[],
      jsonb_build_array(
        jsonb_build_object('unit_id', v_block_party_id, 'quantity_per_bundle', '1', 'selection_mode', 'dry'),
        jsonb_build_object('unit_id', v_block_party_id, 'quantity_per_bundle', '2', 'selection_mode', 'dry')
      )
    );
    RETURN QUERY SELECT '38'::text, 'FAIL'::text, 'duplicate unit/mode accepted'::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '38'::text, 'PASS'::text, 'duplicate unit/mode rejected'::text;
  END;

  -- CASE 41: Available package with inflatable components only succeeds
  BEGIN
    PERFORM public.save_product_bundle_v2(
      'update', '55555555-5555-5555-5555-555555555555'::uuid, 'stage-b-test-inflat-only',
      'STAGE-B-TEST Inflatable Only', null, null, null, null, false, false, true, true, false, false, 998,
      '[]'::jsonb, null, 'none', '{}'::uuid[], '{}'::uuid[],
      jsonb_build_array(jsonb_build_object('unit_id', v_block_party_id, 'quantity_per_bundle', '1', 'selection_mode', 'dry'))
    );
    RETURN QUERY SELECT '41'::text, 'PASS'::text, 'inflatable-only available published'::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT '41'::text, 'FAIL'::text, SQLERRM::text;
  END;

END;
$function$;
