/*
# Fix reorder_product_categories remaining ambiguous column references

The RETURNS TABLE(id uuid, ...) variable also conflicts with bare `id`
references in the existence-check query and the RETURN QUERY output column.
Qualify all `id` references as `product_categories.id` or alias the
RETURN QUERY columns explicitly.
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

  -- Validation: no duplicates
  IF array_length(p_ordered_category_ids, 1) != (
    SELECT count(DISTINCT t.id) FROM unnest(p_ordered_category_ids) AS t(id)
  ) THEN
    RAISE EXCEPTION 'Duplicate category IDs detected';
  END IF;

  -- Validation: all IDs exist (qualify table column)
  SELECT count(*) INTO v_count
  FROM product_categories pc
  WHERE pc.id = ANY(p_ordered_category_ids);
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
    WHERE product_categories.id = v_cat_id;
    v_new_sort := v_new_sort + 10;
  END LOOP;

  -- Return reordered categories (alias output columns to avoid ambiguity)
  RETURN QUERY
  SELECT pc.id AS out_id, pc.slug AS out_slug, pc.name AS out_name, pc.sort_order AS out_sort_order
  FROM product_categories pc
  WHERE pc.id = ANY(p_ordered_category_ids)
  ORDER BY pc.sort_order ASC, pc.name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.reorder_product_categories(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_product_categories(uuid[]) TO authenticated;
