/*
# Phase 3B Stage 2 Precondition: save_product_bundle integer overflow guard

## Bug: Integer overflow leaks raw PostgreSQL error

After the Stage 1 correction, quantities are validated as digits-only positive
integers and cast to numeric. However, a value larger than 2147483647 survives
all validation and then produces a raw "integer out of range" error when the
component is inserted into product_bundle_components.quantity_per_bundle
(which is type integer).

Fix: after the existing positive-integer validation and numeric cast, but
before any integer cast or component insert, reject values exceeding
2147483647 with a controlled error that names the affected product.

This check is placed in the common component-validation pass so it protects
both create and update operations.

No business maximum smaller than the integer limit is introduced.
*/

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

    -- Controlled quantity validation: read raw text, validate before casting
    v_component_qty_text := v_component ->> 'quantity_per_bundle';
    IF v_component_qty_text IS NULL OR btrim(v_component_qty_text) = '' THEN
      RAISE EXCEPTION 'Quantity for product % is required', v_component_product_id;
    END IF;

    -- Reject anything that is not a positive whole integer.
    -- Regex allows optional leading zeros but requires at least one digit,
    -- no decimal point, no sign, no text.
    IF btrim(v_component_qty_text) !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Quantity for product % must be a positive whole integer', v_component_product_id;
    END IF;

    -- Safe to cast now — input is guaranteed to be digits-only
    v_component_qty := btrim(v_component_qty_text)::numeric;

    -- Reject zero (regex above allows "0")
    IF v_component_qty < 1 THEN
      RAISE EXCEPTION 'Quantity for product % must be a positive integer', v_component_product_id;
    END IF;

    -- Reject values exceeding the PostgreSQL integer limit to prevent
    -- a raw "integer out of range" error during component insert.
    IF v_component_qty > 2147483647 THEN
      RAISE EXCEPTION 'Quantity for product % is too large', v_component_product_id;
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
    -- Aggregate the unnest value (t.ip_id), not ip.id which is NULL for missing rows
    SELECT array_agg(t.ip_id::text) INTO v_missing_products
    FROM unnest(v_product_ids) AS t(ip_id)
    LEFT JOIN inventory_products ip ON ip.id = t.ip_id
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
        v_component_qty_text := v_component ->> 'quantity_per_bundle';
        v_component_qty := btrim(v_component_qty_text)::numeric;
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
        v_component_qty_text := v_component ->> 'quantity_per_bundle';
        v_component_qty := btrim(v_component_qty_text)::numeric;
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

REVOKE ALL ON FUNCTION public.save_product_bundle(text,uuid,text,text,text,text,integer,integer,boolean,boolean,boolean,boolean,boolean,boolean,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_product_bundle(text,uuid,text,text,text,text,integer,integer,boolean,boolean,boolean,boolean,boolean,boolean,integer,jsonb) TO authenticated;
