/*
# Fix reorder_product_categories ambiguous column reference

The RETURNS TABLE(id uuid, ...) declaration creates a PL/pgSQL variable
named `id` that conflicts with the bare `id` column from
`unnest(...) AS t(id)` in the duplicate-check query.

Fix: qualify all unnest column references as `t.id` explicitly.
*/

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

  -- Validation: no duplicates (qualify t.id to avoid ambiguity with RETURNS TABLE variable)
  IF array_length(p_ordered_category_ids, 1) != (
    SELECT count(DISTINCT t.id) FROM unnest(p_ordered_category_ids) AS t(id)
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
  FOR v_cat_id IN SELECT t.id FROM unnest(p_ordered_category_ids) AS t(id)
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

REVOKE ALL ON FUNCTION public.reorder_product_categories(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_product_categories(uuid[]) TO authenticated;
