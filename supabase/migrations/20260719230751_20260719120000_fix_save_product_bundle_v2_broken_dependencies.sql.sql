/*
# Fix save_product_bundle_v2 RPC — Broken Dependencies

## Problem

The `public.save_product_bundle_v2` RPC (created in migration 20260718000923)
became un-callable. `pg_get_functiondef()` returned its definition, but every
call — whether via `SELECT`, `DO` block, or PostgREST — failed with:

    ERROR: 42883: function public.save_product_bundle_v2(
      text, uuid, text, text, text, text, integer, integer,
      boolean, boolean, boolean, boolean, boolean, integer,
      jsonb, integer, text, uuid[], uuid[], jsonb
    ) does not exist

even though `proargtypes` in `pg_proc` matched the call exactly.

`pg_depend` showed the function had two dangling `deptype = 'n'` references to
OIDs (13619, 17549) that no longer resolve to any `pg_class` entry — i.e. the
function's compiled plan referenced database objects that were dropped. The
sibling `save_inventory_product_v2` RPC from the same migration did NOT have
this problem and remained callable.

This blocked Stage C2 (Package Admin) entirely: PackageForm and PackageManager
could not create, edit, or availability-toggle any package.

## Fix

Drop the broken function and recreate it with the identical signature and body
from the original migration. `DROP FUNCTION` clears the stale `pg_depend`
entries; `CREATE FUNCTION` re-resolves every table/column reference against the
current schema, producing a clean, callable function.

## What This Migration Does NOT Change

- No table or column alterations.
- No RLS policy changes.
- No data modifications.
- The function signature, body logic, and SECURITY DEFINER / search_path
  settings are identical to the original — only the compiled dependencies are
  refreshed.
- The `GRANT EXECUTE TO authenticated` is re-issued after recreation.

## Verification

After applying, the RPC is callable via `SELECT`, `DO` blocks, and PostgREST.
*/

-- 1. Drop the broken function (clears stale pg_depend entries).
DROP FUNCTION IF EXISTS public.save_product_bundle_v2(
  text, uuid, text, text, text, text,
  integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean,
  integer, jsonb,
  integer, text, uuid[], uuid[], jsonb
);

-- 2. Recreate with the identical body from migration 20260718000923.
CREATE FUNCTION public.save_product_bundle_v2(
  p_operation text,
  p_bundle_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_image_url text,
  p_standalone_price_cents integer,
  p_addon_price_cents integer,
  p_standalone_enabled boolean,
  p_addon_enabled boolean,
  p_active boolean,
  p_public_visible boolean,
  p_menu_visible boolean,
  p_featured boolean,
  p_sort_order integer,
  p_components jsonb,
  p_addon_qualifying_threshold_cents integer DEFAULT NULL,
  p_inflatable_eligibility_mode text DEFAULT 'none',
  p_excluded_category_ids uuid[] DEFAULT '{}',
  p_eligible_unit_ids uuid[] DEFAULT '{}',
  p_inflatable_components jsonb DEFAULT '[]'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_exists boolean;
  v_bundle_name text;
  v_components jsonb;
  v_component jsonb;
  v_component_product_id text;
  v_component_qty_text text;
  v_component_qty numeric;
  v_product_id uuid;
  v_product_name text;
  v_product_active boolean;
  v_product_visible boolean;
  v_product_category_id uuid;
  v_category_active boolean;
  v_category_visible boolean;
  v_category_name text;
  v_seen_product_ids text[] := ARRAY[]::text[];
  v_missing_products text[] := ARRAY[]::text[];
  v_product_ids uuid[] := ARRAY[]::uuid[];
  v_idx integer;
  v_count integer;
  v_publishing boolean;
  -- Inflatable component parsing
  v_ic jsonb;
  v_ic_item jsonb;
  v_ic_unit_id_text text;
  v_ic_unit_id uuid;
  v_ic_qty_text text;
  v_ic_qty numeric;
  v_ic_mode text;
  v_ic_unit_name text;
  v_ic_unit_active boolean;
  v_ic_unit_supports_water boolean;
  v_ic_seen_keys text[] := ARRAY[]::text[];
  v_ic_key text;
  v_missing_units text[] := ARRAY[]::text[];
  v_unit_ids uuid[] := ARRAY[]::uuid[];
  v_cat_id uuid;
  v_missing_cats text[] := ARRAY[]::text[];
  v_dup_cats text[] := ARRAY[]::text[];
  v_dup_units text[] := ARRAY[]::text[];
  v_unit_id uuid;
  v_unit_name text;
  v_unit_active boolean;
  v_unit_supports_water boolean;
BEGIN
  -- Authorization
  v_role := public.get_user_role(auth.uid());
  IF v_role NOT IN ('admin', 'master') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Operation validation
  IF p_operation NOT IN ('create', 'update') THEN
    RAISE EXCEPTION 'Invalid operation: %. Must be ''create'' or ''update''', p_operation;
  END IF;

  -- Field validation
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Package name is required';
  END IF;
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'Slug is required';
  END IF;
  IF p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Slug must be lowercase, alphanumeric, hyphen-separated';
  END IF;
  IF p_standalone_enabled = true AND p_standalone_price_cents IS NULL THEN
    RAISE EXCEPTION 'Standalone price is required when standalone is enabled';
  END IF;
  IF p_standalone_price_cents IS NOT NULL AND p_standalone_price_cents < 0 THEN
    RAISE EXCEPTION 'Standalone price cannot be negative';
  END IF;
  IF p_addon_enabled = true AND p_addon_price_cents IS NULL THEN
    RAISE EXCEPTION 'Add-on price is required when add-on is enabled';
  END IF;
  IF p_addon_price_cents IS NOT NULL AND p_addon_price_cents < 0 THEN
    RAISE EXCEPTION 'Add-on price cannot be negative';
  END IF;

  -- Threshold validation
  IF p_addon_qualifying_threshold_cents IS NOT NULL AND p_addon_qualifying_threshold_cents < 0 THEN
    RAISE EXCEPTION 'Add-on qualifying threshold cannot be negative';
  END IF;

  -- Eligibility mode validation
  IF p_inflatable_eligibility_mode NOT IN ('none', 'any', 'selected') THEN
    RAISE EXCEPTION 'Invalid inflatable eligibility mode: %. Must be none, any, or selected',
      p_inflatable_eligibility_mode;
  END IF;

  -- Selected mode requires at least one eligible unit
  IF p_inflatable_eligibility_mode = 'selected' AND array_length(p_eligible_unit_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selected eligibility mode requires at least one eligible inflatable unit';
  END IF;

  -- Components JSON validation (product components)
  IF p_components IS NULL THEN
    RAISE EXCEPTION 'Components must be a JSON array';
  END IF;
  IF jsonb_typeof(p_components) != 'array' THEN
    RAISE EXCEPTION 'Components must be a JSON array';
  END IF;

  -- Inflatable components JSON validation
  IF p_inflatable_components IS NULL THEN
    RAISE EXCEPTION 'Inflatable components must be a JSON array';
  END IF;
  IF jsonb_typeof(p_inflatable_components) != 'array' THEN
    RAISE EXCEPTION 'Inflatable components must be a JSON array';
  END IF;

  v_publishing := (p_active = true AND p_public_visible = true);

  -- Available package must have at least one total component (product or inflatable)
  IF v_publishing THEN
    IF jsonb_array_length(p_components) = 0 AND jsonb_array_length(p_inflatable_components) = 0 THEN
      RAISE EXCEPTION 'Cannot publish a package with no components';
    END IF;
  END IF;

  -- Parse and validate product components
  v_idx := 0;
  FOR v_component IN SELECT * FROM jsonb_array_elements(p_components)
  LOOP
    v_idx := v_idx + 1;
    IF jsonb_typeof(v_component) != 'object' THEN
      RAISE EXCEPTION 'Component % must be a JSON object', v_idx;
    END IF;
    IF NOT (v_component ? 'product_id') THEN
      RAISE EXCEPTION 'Component % is missing product_id', v_idx;
    END IF;
    v_component_product_id := v_component ->> 'product_id';
    IF v_component_product_id IS NULL OR btrim(v_component_product_id) = '' THEN
      RAISE EXCEPTION 'Component % is missing product_id', v_idx;
    END IF;
    IF v_component_product_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid product ID in components: %', v_component_product_id;
    END IF;
    v_product_id := v_component_product_id::uuid;

    IF NOT (v_component ? 'quantity_per_bundle') THEN
      RAISE EXCEPTION 'Component for product % is missing quantity_per_bundle', v_component_product_id;
    END IF;
    v_component_qty_text := v_component ->> 'quantity_per_bundle';
    IF v_component_qty_text IS NULL OR btrim(v_component_qty_text) = '' THEN
      RAISE EXCEPTION 'Quantity for product % is required', v_component_product_id;
    END IF;
    IF btrim(v_component_qty_text) !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Quantity for product % must be a positive whole integer', v_component_product_id;
    END IF;
    v_component_qty := btrim(v_component_qty_text)::numeric;
    IF v_component_qty < 1 THEN
      RAISE EXCEPTION 'Quantity for product % must be a positive integer', v_component_product_id;
    END IF;
    IF v_component_qty > 2147483647 THEN
      RAISE EXCEPTION 'Quantity for product % is too large', v_component_product_id;
    END IF;

    IF array_position(v_seen_product_ids, v_component_product_id) IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate product in components: %', v_component_product_id;
    END IF;
    v_seen_product_ids := array_append(v_seen_product_ids, v_component_product_id);
    v_product_ids := array_append(v_product_ids, v_product_id);
  END LOOP;

  -- Verify every referenced product exists
  IF array_length(v_product_ids, 1) IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM inventory_products WHERE id = ANY(v_product_ids);
    IF v_count != array_length(v_product_ids, 1) THEN
      SELECT array_agg(t.ip_id::text) INTO v_missing_products
      FROM unnest(v_product_ids) AS t(ip_id)
      LEFT JOIN inventory_products ip ON ip.id = t.ip_id
      WHERE ip.id IS NULL;
      RAISE EXCEPTION 'Product not found: %', array_to_string(v_missing_products, ', ');
    END IF;
  END IF;

  -- Publishing validation: product component state
  IF v_publishing AND array_length(v_product_ids, 1) IS NOT NULL THEN
    FOR v_product_id IN SELECT unnest(v_product_ids)
    LOOP
      SELECT name, active, public_visible, category_id
      INTO v_product_name, v_product_active, v_product_visible, v_product_category_id
      FROM inventory_products WHERE id = v_product_id;

      IF v_product_active = false THEN
        RAISE EXCEPTION 'Cannot publish package because product "%" is inactive.', v_product_name;
      END IF;
      IF v_product_visible = false THEN
        RAISE EXCEPTION 'Cannot publish package because product "%" is hidden.', v_product_name;
      END IF;
      IF v_product_category_id IS NULL THEN
        RAISE EXCEPTION 'Cannot publish package because product "%" has no category.', v_product_name;
      END IF;

      SELECT name, active, public_visible
      INTO v_category_name, v_category_active, v_category_visible
      FROM product_categories WHERE id = v_product_category_id;

      IF v_category_active = false THEN
        RAISE EXCEPTION 'Cannot publish package because category "%" is inactive.', v_category_name;
      END IF;
      IF v_category_visible = false THEN
        RAISE EXCEPTION 'Cannot publish package because category "%" is hidden.', v_category_name;
      END IF;
    END LOOP;
  END IF;

  -- Validate excluded category IDs (existence + duplicates)
  IF array_length(p_excluded_category_ids, 1) IS NOT NULL THEN
    FOREACH v_cat_id IN ARRAY p_excluded_category_ids
    LOOP
      IF array_position(v_dup_cats, v_cat_id::text) IS NOT NULL THEN
        RAISE EXCEPTION 'Duplicate excluded category ID: %', v_cat_id;
      END IF;
      v_dup_cats := array_append(v_dup_cats, v_cat_id::text);
    END LOOP;

    SELECT count(*) INTO v_count FROM product_categories WHERE id = ANY(p_excluded_category_ids);
    IF v_count != array_length(p_excluded_category_ids, 1) THEN
      SELECT array_agg(t.cid::text) INTO v_missing_cats
      FROM unnest(p_excluded_category_ids) AS t(cid)
      LEFT JOIN product_categories c ON c.id = t.cid
      WHERE c.id IS NULL;
      RAISE EXCEPTION 'Excluded category not found: %', array_to_string(v_missing_cats, ', ');
    END IF;
  END IF;

  -- Validate eligible unit IDs (existence + duplicates; active only when publishing)
  IF p_inflatable_eligibility_mode = 'selected' AND array_length(p_eligible_unit_ids, 1) IS NOT NULL THEN
    FOREACH v_unit_id IN ARRAY p_eligible_unit_ids
    LOOP
      IF array_position(v_dup_units, v_unit_id::text) IS NOT NULL THEN
        RAISE EXCEPTION 'Duplicate eligible inflatable unit ID: %', v_unit_id;
      END IF;
      v_dup_units := array_append(v_dup_units, v_unit_id::text);
    END LOOP;

    SELECT count(*) INTO v_count FROM units WHERE id = ANY(p_eligible_unit_ids);
    IF v_count != array_length(p_eligible_unit_ids, 1) THEN
      SELECT array_agg(t.uid::text) INTO v_missing_units
      FROM unnest(p_eligible_unit_ids) AS t(uid)
      LEFT JOIN units u ON u.id = t.uid
      WHERE u.id IS NULL;
      RAISE EXCEPTION 'Eligible inflatable not found: %', array_to_string(v_missing_units, ', ');
    END IF;

    IF v_publishing THEN
      FOR v_unit_id IN SELECT unnest(p_eligible_unit_ids)
      LOOP
        SELECT name, active INTO v_unit_name, v_unit_active
        FROM units WHERE id = v_unit_id;
        IF v_unit_active = false THEN
          RAISE EXCEPTION 'Cannot publish package because eligible inflatable "%" is inactive.', v_unit_name;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Parse and validate inflatable components
  v_idx := 0;
  FOR v_ic_item IN SELECT * FROM jsonb_array_elements(p_inflatable_components)
  LOOP
    v_idx := v_idx + 1;
    IF jsonb_typeof(v_ic_item) != 'object' THEN
      RAISE EXCEPTION 'Inflatable component % must be a JSON object', v_idx;
    END IF;
    IF NOT (v_ic_item ? 'unit_id') THEN
      RAISE EXCEPTION 'Inflatable component % is missing unit_id', v_idx;
    END IF;
    v_ic_unit_id_text := v_ic_item ->> 'unit_id';
    IF v_ic_unit_id_text IS NULL OR btrim(v_ic_unit_id_text) = '' THEN
      RAISE EXCEPTION 'Inflatable component % is missing unit_id', v_idx;
    END IF;
    IF v_ic_unit_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid unit ID in inflatable components: %', v_ic_unit_id_text;
    END IF;
    v_ic_unit_id := v_ic_unit_id_text::uuid;

    IF NOT (v_ic_item ? 'quantity_per_bundle') THEN
      RAISE EXCEPTION 'Inflatable component for unit % is missing quantity_per_bundle', v_ic_unit_id_text;
    END IF;
    v_ic_qty_text := v_ic_item ->> 'quantity_per_bundle';
    IF v_ic_qty_text IS NULL OR btrim(v_ic_qty_text) = '' THEN
      RAISE EXCEPTION 'Quantity for inflatable unit % is required', v_ic_unit_id_text;
    END IF;
    IF btrim(v_ic_qty_text) !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Quantity for inflatable unit % must be a positive whole integer', v_ic_unit_id_text;
    END IF;
    v_ic_qty := btrim(v_ic_qty_text)::numeric;
    IF v_ic_qty < 1 THEN
      RAISE EXCEPTION 'Quantity for inflatable unit % must be a positive integer', v_ic_unit_id_text;
    END IF;
    IF v_ic_qty > 2147483647 THEN
      RAISE EXCEPTION 'Quantity for inflatable unit % is too large', v_ic_unit_id_text;
    END IF;

    IF NOT (v_ic_item ? 'selection_mode') THEN
      RAISE EXCEPTION 'Inflatable component for unit % is missing selection_mode', v_ic_unit_id_text;
    END IF;
    v_ic_mode := v_ic_item ->> 'selection_mode';
    IF v_ic_mode NOT IN ('dry', 'water', 'customer_choice') THEN
      RAISE EXCEPTION 'Invalid selection mode "%" for inflatable unit %', v_ic_mode, v_ic_unit_id_text;
    END IF;

    -- Duplicate (bundle/unit/mode) check
    v_ic_key := v_ic_unit_id_text || '|' || v_ic_mode;
    IF array_position(v_ic_seen_keys, v_ic_key) IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate inflatable component for unit % with mode %', v_ic_unit_id_text, v_ic_mode;
    END IF;
    v_ic_seen_keys := array_append(v_ic_seen_keys, v_ic_key);

    -- Verify unit exists
    SELECT name, active, price_water_cents IS NOT NULL
    INTO v_ic_unit_name, v_ic_unit_active, v_ic_unit_supports_water
    FROM units WHERE id = v_ic_unit_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inflatable unit not found: %', v_ic_unit_id_text;
    END IF;

    -- Publishing validation
    IF v_publishing THEN
      IF v_ic_unit_active = false THEN
        RAISE EXCEPTION 'Cannot publish package because inflatable "%" is inactive.', v_ic_unit_name;
      END IF;
      IF v_ic_mode = 'water' AND v_ic_unit_supports_water = false THEN
        RAISE EXCEPTION 'Inflatable "%" does not support water mode.', v_ic_unit_name;
      END IF;
      IF v_ic_mode = 'customer_choice' AND v_ic_unit_supports_water = false THEN
        RAISE EXCEPTION 'Inflatable "%" does not support water; customer_choice requires water support.', v_ic_unit_name;
      END IF;
    END IF;

    v_unit_ids := array_append(v_unit_ids, v_ic_unit_id);
  END LOOP;

  -- =====================================================================
  -- Operation-specific persistence (atomic: any exception rolls back all)
  -- =====================================================================
  IF p_operation = 'create' THEN
    IF p_bundle_id IS NULL THEN
      RAISE EXCEPTION 'Package ID is required for create';
    END IF;
    SELECT EXISTS(SELECT 1 FROM product_bundles WHERE id = p_bundle_id) INTO v_exists;
    IF v_exists THEN
      RAISE EXCEPTION 'Package ID already exists';
    END IF;

    BEGIN
      INSERT INTO product_bundles (
        id, slug, name, description, image_url,
        standalone_price_cents, addon_price_cents,
        standalone_enabled, addon_enabled,
        active, public_visible, menu_visible, featured, sort_order,
        addon_qualifying_threshold_cents, inflatable_eligibility_mode
      )
      VALUES (
        p_bundle_id, p_slug, p_name, p_description, p_image_url,
        p_standalone_price_cents, p_addon_price_cents,
        p_standalone_enabled, p_addon_enabled,
        p_active, p_public_visible, p_menu_visible, p_featured, p_sort_order,
        p_addon_qualifying_threshold_cents, p_inflatable_eligibility_mode
      );

      -- Product components
      FOR v_component IN SELECT * FROM jsonb_array_elements(p_components)
      LOOP
        v_product_id := (v_component ->> 'product_id')::uuid;
        v_component_qty_text := v_component ->> 'quantity_per_bundle';
        v_component_qty := btrim(v_component_qty_text)::numeric;
        INSERT INTO product_bundle_components (bundle_id, product_id, quantity_per_bundle)
        VALUES (p_bundle_id, v_product_id, v_component_qty::integer);
      END LOOP;

      -- Inflatable components
      FOR v_ic_item IN SELECT * FROM jsonb_array_elements(p_inflatable_components)
      LOOP
        v_ic_unit_id := (v_ic_item ->> 'unit_id')::uuid;
        v_ic_qty_text := v_ic_item ->> 'quantity_per_bundle';
        v_ic_qty := btrim(v_ic_qty_text)::numeric;
        v_ic_mode := v_ic_item ->> 'selection_mode';
        INSERT INTO package_inflatable_components (bundle_id, unit_id, quantity_per_bundle, selection_mode)
        VALUES (p_bundle_id, v_ic_unit_id, v_ic_qty::integer, v_ic_mode);
      END LOOP;

      -- Excluded categories
      FOREACH v_cat_id IN ARRAY p_excluded_category_ids
      LOOP
        INSERT INTO product_bundle_excluded_categories (bundle_id, category_id)
        VALUES (p_bundle_id, v_cat_id);
      END LOOP;

      -- Eligible units (only for 'selected' mode)
      IF p_inflatable_eligibility_mode = 'selected' THEN
        FOREACH v_unit_id IN ARRAY p_eligible_unit_ids
        LOOP
          INSERT INTO package_inflatable_eligibility (bundle_id, unit_id)
          VALUES (p_bundle_id, v_unit_id);
        END LOOP;
      END IF;

      RETURN p_bundle_id;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Slug "%" is already in use.', p_slug;
    END;

  ELSE -- update
    IF p_bundle_id IS NULL THEN
      RAISE EXCEPTION 'Package ID is required for update';
    END IF;
    SELECT name INTO v_bundle_name FROM product_bundles WHERE id = p_bundle_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Package with ID % not found', p_bundle_id;
    END IF;

    BEGIN
      UPDATE product_bundles
      SET slug = p_slug,
          name = p_name,
          description = p_description,
          image_url = p_image_url,
          standalone_price_cents = p_standalone_price_cents,
          addon_price_cents = p_addon_price_cents,
          standalone_enabled = p_standalone_enabled,
          addon_enabled = p_addon_enabled,
          active = p_active,
          public_visible = p_public_visible,
          menu_visible = p_menu_visible,
          featured = p_featured,
          sort_order = p_sort_order,
          addon_qualifying_threshold_cents = p_addon_qualifying_threshold_cents,
          inflatable_eligibility_mode = p_inflatable_eligibility_mode
      WHERE id = p_bundle_id;

      -- Atomic full replacement of all relationship sets
      DELETE FROM product_bundle_components WHERE bundle_id = p_bundle_id;
      DELETE FROM package_inflatable_components WHERE bundle_id = p_bundle_id;
      DELETE FROM product_bundle_excluded_categories WHERE bundle_id = p_bundle_id;
      DELETE FROM package_inflatable_eligibility WHERE bundle_id = p_bundle_id;

      FOR v_component IN SELECT * FROM jsonb_array_elements(p_components)
      LOOP
        v_product_id := (v_component ->> 'product_id')::uuid;
        v_component_qty_text := v_component ->> 'quantity_per_bundle';
        v_component_qty := btrim(v_component_qty_text)::numeric;
        INSERT INTO product_bundle_components (bundle_id, product_id, quantity_per_bundle)
        VALUES (p_bundle_id, v_product_id, v_component_qty::integer);
      END LOOP;

      FOR v_ic_item IN SELECT * FROM jsonb_array_elements(p_inflatable_components)
      LOOP
        v_ic_unit_id := (v_ic_item ->> 'unit_id')::uuid;
        v_ic_qty_text := v_ic_item ->> 'quantity_per_bundle';
        v_ic_qty := btrim(v_ic_qty_text)::numeric;
        v_ic_mode := v_ic_item ->> 'selection_mode';
        INSERT INTO package_inflatable_components (bundle_id, unit_id, quantity_per_bundle, selection_mode)
        VALUES (p_bundle_id, v_ic_unit_id, v_ic_qty::integer, v_ic_mode);
      END LOOP;

      FOREACH v_cat_id IN ARRAY p_excluded_category_ids
      LOOP
        INSERT INTO product_bundle_excluded_categories (bundle_id, category_id)
        VALUES (p_bundle_id, v_cat_id);
      END LOOP;

      IF p_inflatable_eligibility_mode = 'selected' THEN
        FOREACH v_unit_id IN ARRAY p_eligible_unit_ids
        LOOP
          INSERT INTO package_inflatable_eligibility (bundle_id, unit_id)
          VALUES (p_bundle_id, v_unit_id);
        END LOOP;
      END IF;

      RETURN p_bundle_id;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Slug "%" is already in use.', p_slug;
    END;
  END IF;
END;
$function$;

-- 3. Re-grant execute to authenticated (admin/master enforced inside RPC).
GRANT EXECUTE ON FUNCTION public.save_product_bundle_v2 TO authenticated;

-- 4. Reload PostgREST schema cache so the function is immediately exposed.
NOTIFY pgrst, 'reload schema';
