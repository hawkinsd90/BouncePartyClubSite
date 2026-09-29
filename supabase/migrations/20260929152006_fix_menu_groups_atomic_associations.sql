/* Fix atomic menu-group association insertion and tolerate existing role casing. */

CREATE OR REPLACE FUNCTION public.save_menu_group(
  p_group_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_category_ids uuid[] DEFAULT NULL,
  p_is_enabled boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_is_admin boolean;
  v_next_order integer;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized to manage menu groups';
  END IF;

  IF p_category_ids IS NULL OR cardinality(p_category_ids) = 0 THEN
    RAISE EXCEPTION 'At least one category is required';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'Title is required';
  END IF;

  IF p_group_id IS NULL THEN
    SELECT COALESCE(MAX(display_order), -1) + 1
    INTO v_next_order
    FROM public_menu_groups;

    INSERT INTO public_menu_groups (title, is_enabled, display_order)
    VALUES (btrim(p_title), p_is_enabled, v_next_order)
    RETURNING id INTO v_group_id;
  ELSE
    v_group_id := p_group_id;

    UPDATE public_menu_groups
    SET title = btrim(p_title), is_enabled = p_is_enabled
    WHERE id = v_group_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu group not found';
    END IF;
  END IF;

  DELETE FROM public_menu_group_categories
  WHERE menu_group_id = v_group_id;

  INSERT INTO public_menu_group_categories (menu_group_id, category_id)
  SELECT v_group_id, category_id
  FROM unnest(p_category_ids) AS category_id
  ON CONFLICT DO NOTHING;

  RETURN v_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_menu_group(
  p_group_id uuid,
  p_swap_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_order1 integer;
  v_order2 integer;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized to reorder menu groups';
  END IF;

  SELECT display_order INTO v_order1
  FROM public_menu_groups
  WHERE id = p_group_id;

  SELECT display_order INTO v_order2
  FROM public_menu_groups
  WHERE id = p_swap_group_id;

  IF v_order1 IS NULL OR v_order2 IS NULL THEN
    RAISE EXCEPTION 'One or both menu groups not found';
  END IF;

  UPDATE public_menu_groups SET display_order = v_order2 WHERE id = p_group_id;
  UPDATE public_menu_groups SET display_order = v_order1 WHERE id = p_swap_group_id;
END;
$$;
