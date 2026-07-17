/*
# Add Event Essentials Transactional Admin RPCs

1. Purpose
   Creates four narrow SECURITY DEFINER functions for atomic, validated
   admin writes to the Event Essentials schema. These replace multi-table
   client writes with server-side transactions that enforce:

   - Admin/master authorization (public.get_user_role)
   - Explicit create/update operation contract
   - Input validation with controlled, descriptive errors
   - Product/package dependency enforcement
   - Category/package dependency enforcement
   - Atomic multi-table writes (product+pricing, bundle+components)
   - Atomic category reordering

2. Functions Created
   - public.save_inventory_product(p_operation, p_product_id, ...)
     Inserts or updates a product AND its pricing row atomically.
     Enforces: no hiding/deactivating/uncategorizing a product that is
     used by an active public package.

   - public.save_product_bundle(p_operation, p_bundle_id, ..., p_components)
     Inserts or updates a bundle AND its complete component set atomically.
     Enforces: publishing validation (active+public requires all components
     to be active, visible, categorized, and their categories active+visible).

   - public.save_product_category(p_operation, p_category_id, ...)
     Inserts or updates a category.
     Enforces: no hiding/deactivating a category whose products are used
     by active public packages.

   - public.reorder_product_categories(p_ordered_category_ids)
     Atomically reassigns sort_order values (10, 20, 30...) to all supplied
     category IDs in one transaction.

3. Security
   - All functions: SECURITY DEFINER, SET search_path TO 'public'
   - Authorization: public.get_user_role(auth.uid()) IN ('admin', 'master')
   - REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated only
   - anon is NOT granted execute
   - Existing RLS policies remain as a secondary layer

4. Important Notes
   - p_operation explicitly distinguishes 'create' from 'update'
   - For create: product/bundle IDs must be non-null client-generated UUIDs;
     the function rejects if the ID already exists
   - For update: the row must already exist; the function raises not-found
     and never silently creates
   - Category create: p_category_id must be null; the function generates
     the ID via gen_random_uuid()
   - DB CHECK constraints remain the final safety layer
*/

-- ===========================================================================
-- RPC 1: save_inventory_product
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.save_inventory_product(
  p_operation text,
  p_product_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_image_url text,
  p_total_quantity integer,
  p_temp_unavailable_qty integer,
  p_active boolean,
  p_public_visible boolean,
  p_category_id uuid,
  p_sort_order integer,
  p_standalone_price_cents integer,
  p_addon_price_cents integer,
  p_standalone_enabled boolean,
  p_addon_enabled boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_exists boolean;
  v_product_name text;
  v_affected_packages text;
  v_category_active boolean;
  v_category_visible boolean;
  v_new_id uuid;
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
    RAISE EXCEPTION 'Product name is required';
  END IF;
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'Slug is required';
  END IF;
  IF p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Slug must be lowercase, alphanumeric, hyphen-separated';
  END IF;
  IF p_total_quantity IS NULL OR p_total_quantity < 0 THEN
    RAISE EXCEPTION 'Total quantity cannot be negative';
  END IF;
  IF p_temp_unavailable_qty IS NULL OR p_temp_unavailable_qty < 0 THEN
    RAISE EXCEPTION 'Temporarily unavailable quantity cannot be negative';
  END IF;
  IF p_temp_unavailable_qty > p_total_quantity THEN
    RAISE EXCEPTION 'Temporarily unavailable cannot exceed total quantity';
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

  -- Category existence check (if provided)
  IF p_category_id IS NOT NULL THEN
    SELECT active, public_visible INTO v_category_active, v_category_visible
    FROM product_categories WHERE id = p_category_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Category with ID % not found', p_category_id;
    END IF;
  END IF;

  -- Operation-specific logic
  IF p_operation = 'create' THEN
    IF p_product_id IS NULL THEN
      RAISE EXCEPTION 'Product ID is required for create';
    END IF;
    SELECT EXISTS(SELECT 1 FROM inventory_products WHERE id = p_product_id) INTO v_exists;
    IF v_exists THEN
      RAISE EXCEPTION 'Product ID already exists';
    END IF;

    BEGIN
      INSERT INTO inventory_products (
        id, slug, name, description, image_url,
        total_quantity, temp_unavailable_qty,
        active, public_visible, category_id, sort_order
      )
      VALUES (
        p_product_id, p_slug, p_name, p_description, p_image_url,
        p_total_quantity, p_temp_unavailable_qty,
        p_active, p_public_visible, p_category_id, p_sort_order
      );

      INSERT INTO product_pricing (
        product_id, standalone_price_cents, addon_price_cents,
        standalone_enabled, addon_enabled, sort_order
      )
      VALUES (
        p_product_id, p_standalone_price_cents, p_addon_price_cents,
        p_standalone_enabled, p_addon_enabled, p_sort_order
      );
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Slug "%" is already in use.', p_slug;
    END;

    RETURN p_product_id;

  ELSE -- update
    IF p_product_id IS NULL THEN
      RAISE EXCEPTION 'Product ID is required for update';
    END IF;
    SELECT name INTO v_product_name FROM inventory_products WHERE id = p_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product with ID % not found', p_product_id;
    END IF;

    -- Dependency enforcement: check if making product unusable publicly
    -- while it's used by active public packages
    IF p_active = false OR p_public_visible = false OR p_category_id IS NULL THEN
      SELECT string_agg(pb.name, ', ')
      INTO v_affected_packages
      FROM product_bundle_components pbc
      JOIN product_bundles pb ON pb.id = pbc.bundle_id
      WHERE pbc.product_id = p_product_id
        AND pb.active = true
        AND pb.public_visible = true;

      IF v_affected_packages IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot make product "%" unusable because it is used by active public package(s): %',
          COALESCE(p_name, v_product_name), v_affected_packages;
      END IF;
    END IF;

    -- Check if category is being changed to inactive/hidden
    IF p_category_id IS NOT NULL THEN
      IF v_category_active = false OR v_category_visible = false THEN
        SELECT string_agg(pb.name, ', ')
        INTO v_affected_packages
        FROM product_bundle_components pbc
        JOIN product_bundles pb ON pb.id = pbc.bundle_id
        WHERE pbc.product_id = p_product_id
          AND pb.active = true
          AND pb.public_visible = true;

        IF v_affected_packages IS NOT NULL THEN
          RAISE EXCEPTION 'Cannot make product "%" unusable because it is used by active public package(s): %',
            COALESCE(p_name, v_product_name), v_affected_packages;
        END IF;
      END IF;
    END IF;

    BEGIN
      UPDATE inventory_products
      SET slug = p_slug,
          name = p_name,
          description = p_description,
          image_url = p_image_url,
          total_quantity = p_total_quantity,
          temp_unavailable_qty = p_temp_unavailable_qty,
          active = p_active,
          public_visible = p_public_visible,
          category_id = p_category_id,
          sort_order = p_sort_order
      WHERE id = p_product_id;

      -- Upsert pricing row
      INSERT INTO product_pricing (
        product_id, standalone_price_cents, addon_price_cents,
        standalone_enabled, addon_enabled, sort_order
      )
      VALUES (
        p_product_id, p_standalone_price_cents, p_addon_price_cents,
        p_standalone_enabled, p_addon_enabled, p_sort_order
      )
      ON CONFLICT (product_id) DO UPDATE
      SET standalone_price_cents = EXCLUDED.standalone_price_cents,
          addon_price_cents = EXCLUDED.addon_price_cents,
          standalone_enabled = EXCLUDED.standalone_enabled,
          addon_enabled = EXCLUDED.addon_enabled,
          sort_order = EXCLUDED.sort_order;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Slug "%" is already in use.', p_slug;
    END;

    RETURN p_product_id;
  END IF;
END;
$function$;

-- ===========================================================================
-- RPC 2: save_product_bundle
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.save_product_bundle(
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
  p_components jsonb
)
RETURNS uuid
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

  -- Components validation
  IF p_components IS NULL THEN
    RAISE EXCEPTION 'Components must be a JSON array';
  END IF;
  IF jsonb_typeof(p_components) != 'array' THEN
    RAISE EXCEPTION 'Components must be a JSON array';
  END IF;

  -- Publishing validation (applies to both create and update)
  IF p_active = true AND p_public_visible = true THEN
    IF jsonb_array_length(p_components) = 0 THEN
      RAISE EXCEPTION 'Cannot publish a package with no components';
    END IF;
  END IF;

  -- Parse and validate each component
  v_idx := 0;
  FOR v_component IN SELECT * FROM jsonb_array_elements(p_components)
  LOOP
    v_idx := v_idx + 1;

    -- Verify it's a JSON object
    IF jsonb_typeof(v_component) != 'object' THEN
      RAISE EXCEPTION 'Component % must be a JSON object', v_idx;
    END IF;

    -- Verify product_id is present
    IF NOT (v_component ? 'product_id') THEN
      RAISE EXCEPTION 'Component % is missing product_id', v_idx;
    END IF;
    v_component_product_id := v_component ->> 'product_id';
    IF v_component_product_id IS NULL OR btrim(v_component_product_id) = '' THEN
      RAISE EXCEPTION 'Component % is missing product_id', v_idx;
    END IF;

    -- Verify UUID format (controlled error, not raw cast)
    IF v_component_product_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid product ID in components: %', v_component_product_id;
    END IF;
    v_product_id := v_component_product_id::uuid;

    -- Verify quantity is present
    IF NOT (v_component ? 'quantity_per_bundle') THEN
      RAISE EXCEPTION 'Component for product % is missing quantity_per_bundle', v_component_product_id;
    END IF;
    v_component_qty := (v_component ->> 'quantity_per_bundle')::numeric;

    -- Verify quantity is a positive integer
    IF v_component_qty IS NULL THEN
      RAISE EXCEPTION 'Quantity for product % is required', v_component_product_id;
    END IF;
    IF v_component_qty != floor(v_component_qty) THEN
      RAISE EXCEPTION 'Quantity for product % must be a whole number', v_component_product_id;
    END IF;
    IF v_component_qty < 1 THEN
      RAISE EXCEPTION 'Quantity for product % must be a positive integer', v_component_product_id;
    END IF;

    -- Duplicate product ID check
    IF array_position(v_seen_product_ids, v_component_product_id) IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate product in components: %', v_component_product_id;
    END IF;
    v_seen_product_ids := array_append(v_seen_product_ids, v_component_product_id);
    v_product_ids := array_append(v_product_ids, v_product_id);
  END LOOP;

  -- Verify every referenced product exists
  SELECT count(*) INTO v_count FROM inventory_products WHERE id = ANY(v_product_ids);
  IF v_count != array_length(v_product_ids, 1) THEN
    SELECT array_agg(ip.id::text) INTO v_missing_products
    FROM unnest(v_product_ids) AS ip_id
    LEFT JOIN inventory_products ip ON ip.id = ip_id
    WHERE ip.id IS NULL;
    RAISE EXCEPTION 'Product not found: %', array_to_string(v_missing_products, ', ');
  END IF;

  -- Publishing validation: check each component product state
  IF p_active = true AND p_public_visible = true THEN
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

      -- Check category state
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

  -- Operation-specific logic
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
        active, public_visible, menu_visible, featured, sort_order
      )
      VALUES (
        p_bundle_id, p_slug, p_name, p_description, p_image_url,
        p_standalone_price_cents, p_addon_price_cents,
        p_standalone_enabled, p_addon_enabled,
        p_active, p_public_visible, p_menu_visible, p_featured, p_sort_order
      );

      -- Insert components
      FOR v_component IN SELECT * FROM jsonb_array_elements(p_components)
      LOOP
        v_product_id := (v_component ->> 'product_id')::uuid;
        v_component_qty := (v_component ->> 'quantity_per_bundle')::numeric;
        INSERT INTO product_bundle_components (bundle_id, product_id, quantity_per_bundle)
        VALUES (p_bundle_id, v_product_id, v_component_qty::integer);
      END LOOP;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Slug "%" is already in use.', p_slug;
    END;

    RETURN p_bundle_id;

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
          sort_order = p_sort_order
      WHERE id = p_bundle_id;

      -- Atomic component replacement: delete all, then insert all
      DELETE FROM product_bundle_components WHERE bundle_id = p_bundle_id;

      FOR v_component IN SELECT * FROM jsonb_array_elements(p_components)
      LOOP
        v_product_id := (v_component ->> 'product_id')::uuid;
        v_component_qty := (v_component ->> 'quantity_per_bundle')::numeric;
        INSERT INTO product_bundle_components (bundle_id, product_id, quantity_per_bundle)
        VALUES (p_bundle_id, v_product_id, v_component_qty::integer);
      END LOOP;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Slug "%" is already in use.', p_slug;
    END;

    RETURN p_bundle_id;
  END IF;
END;
$function$;

-- ===========================================================================
-- RPC 3: save_product_category
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.save_product_category(
  p_operation text,
  p_category_id uuid,
  p_slug text,
  p_name text,
  p_sort_order integer,
  p_active boolean,
  p_public_visible boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_exists boolean;
  v_category_name text;
  v_current_active boolean;
  v_current_visible boolean;
  v_affected_packages text;
  v_new_id uuid;
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
    RAISE EXCEPTION 'Category name is required';
  END IF;
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'Slug is required';
  END IF;
  IF p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Slug must be lowercase, alphanumeric, hyphen-separated';
  END IF;

  IF p_operation = 'create' THEN
    IF p_category_id IS NOT NULL THEN
      RAISE EXCEPTION 'Category ID must be null for create';
    END IF;

    BEGIN
      v_new_id := gen_random_uuid();
      INSERT INTO product_categories (id, slug, name, sort_order, active, public_visible)
      VALUES (v_new_id, p_slug, p_name, p_sort_order, p_active, p_public_visible);
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Slug "%" is already in use.', p_slug;
    END;

    RETURN v_new_id;

  ELSE -- update
    IF p_category_id IS NULL THEN
      RAISE EXCEPTION 'Category ID is required for update';
    END IF;
    SELECT name, active, public_visible
    INTO v_category_name, v_current_active, v_current_visible
    FROM product_categories WHERE id = p_category_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Category with ID % not found', p_category_id;
    END IF;

    -- Dependency enforcement: blocking hide or deactivate
    IF (p_active = false AND v_current_active = true)
       OR (p_public_visible = false AND v_current_visible = true) THEN
      SELECT string_agg(DISTINCT pb.name, ', ')
      INTO v_affected_packages
      FROM product_bundle_components pbc
      JOIN inventory_products ip ON ip.id = pbc.product_id
      JOIN product_bundles pb ON pb.id = pbc.bundle_id
      WHERE ip.category_id = p_category_id
        AND pb.active = true
        AND pb.public_visible = true;

      IF v_affected_packages IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot hide or deactivate category "%" because its products are used by active public package(s): %',
          COALESCE(p_name, v_category_name), v_affected_packages;
      END IF;
    END IF;

    BEGIN
      UPDATE product_categories
      SET slug = p_slug,
          name = p_name,
          sort_order = p_sort_order,
          active = p_active,
          public_visible = p_public_visible
      WHERE id = p_category_id;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Slug "%" is already in use.', p_slug;
    END;

    RETURN p_category_id;
  END IF;
END;
$function$;

-- ===========================================================================
-- RPC 4: reorder_product_categories
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.reorder_product_categories(
  p_ordered_category_ids uuid[]
)
RETURNS TABLE(id uuid, slug text, name text, sort_order integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_count integer;
  v_missing_ids text[];
  v_cat_id uuid;
  v_new_sort integer;
BEGIN
  -- Authorization
  v_role := public.get_user_role(auth.uid());
  IF v_role NOT IN ('admin', 'master') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Validation: non-null, non-empty
  IF p_ordered_category_ids IS NULL OR array_length(p_ordered_category_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Category IDs are required';
  END IF;

  -- Validation: no duplicates
  IF array_length(p_ordered_category_ids, 1) != (
    SELECT count(DISTINCT id) FROM unnest(p_ordered_category_ids) AS t(id)
  ) THEN
    RAISE EXCEPTION 'Duplicate category IDs detected';
  END IF;

  -- Validation: all IDs exist
  SELECT count(*) INTO v_count
  FROM product_categories WHERE id = ANY(p_ordered_category_ids);
  IF v_count != array_length(p_ordered_category_ids, 1) THEN
    SELECT array_agg(t.id::text) INTO v_missing_ids
    FROM unnest(p_ordered_category_ids) AS t(id)
    LEFT JOIN product_categories pc ON pc.id = t.id
    WHERE pc.id IS NULL;
    RAISE EXCEPTION 'Category IDs not found: %', array_to_string(v_missing_ids, ', ');
  END IF;

  -- Atomic reorder: assign sort_order = 10, 20, 30...
  v_new_sort := 10;
  FOR v_cat_id IN SELECT id FROM unnest(p_ordered_category_ids) AS t(id)
  LOOP
    UPDATE product_categories
    SET sort_order = v_new_sort
    WHERE id = v_cat_id;
    v_new_sort := v_new_sort + 10;
  END LOOP;

  -- Return reordered categories
  RETURN QUERY
  SELECT pc.id, pc.slug, pc.name, pc.sort_order
  FROM product_categories pc
  WHERE pc.id = ANY(p_ordered_category_ids)
  ORDER BY pc.sort_order ASC, pc.name ASC;
END;
$function$;

-- ===========================================================================
-- Revoke public access and grant authenticated execute only
-- ===========================================================================

REVOKE ALL ON FUNCTION public.save_inventory_product(text, uuid, text, text, text, text, integer, integer, boolean, boolean, uuid, integer, integer, integer, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_inventory_product(text, uuid, text, text, text, text, integer, integer, boolean, boolean, uuid, integer, integer, integer, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.save_product_bundle(text, uuid, text, text, text, text, integer, integer, boolean, boolean, boolean, boolean, boolean, boolean, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_product_bundle(text, uuid, text, text, text, text, integer, integer, boolean, boolean, boolean, boolean, boolean, boolean, integer, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.save_product_category(text, uuid, text, text, integer, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_product_category(text, uuid, text, text, integer, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.reorder_product_categories(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_product_categories(uuid[]) TO authenticated;
