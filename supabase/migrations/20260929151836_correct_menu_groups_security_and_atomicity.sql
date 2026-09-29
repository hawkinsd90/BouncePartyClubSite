/*
# Corrective migration for Menu Groups feature

1. Adds save_menu_group RPC for atomic create/update with category associations
2. Adds reorder_menu_group RPC for atomic swap-based reorder
3. Removes public SELECT policies on public_menu_groups and
   public_menu_group_categories — public access is via the
   get_public_nav_menu_groups() SECURITY DEFINER RPC only
4. Grants EXECUTE on new RPCs to authenticated only (admin-only operations)
*/

-- 1. Atomic save RPC (create or update a menu group + its category associations)
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
  -- Authorization: only ADMIN or MASTER
  SELECT EXISTS(
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role IN ('ADMIN', 'MASTER')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized to manage menu groups';
  END IF;

  -- Validate at least one category
  IF p_category_ids IS NULL OR array_length(p_category_ids, 1) IS NULL OR array_length(p_category_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one category is required';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'Title is required';
  END IF;

  IF p_group_id IS NULL THEN
    -- Create: compute next display_order as max + 1
    SELECT COALESCE(MAX(display_order), -1) + 1 INTO v_next_order
    FROM public_menu_groups;

    INSERT INTO public_menu_groups (title, is_enabled, display_order)
    VALUES (btrim(p_title), p_is_enabled, v_next_order)
    RETURNING id INTO v_group_id;
  ELSE
    -- Update
    v_group_id := p_group_id;

    UPDATE public_menu_groups
    SET title = btrim(p_title), is_enabled = p_is_enabled
    WHERE id = v_group_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu group not found';
    END IF;
  END IF;

  -- Replace category associations atomically
  DELETE FROM public_menu_group_categories WHERE menu_group_id = v_group_id;

  INSERT INTO public_menu_group_categories (menu_group_id, category_id)
    SELECT v_group_id, unnest(p_category_ids)
    WHERE NOT EXISTS (
      SELECT 1 FROM public_menu_group_categories
      WHERE menu_group_id = v_group_id AND category_id = unnest(p_category_ids)
    )
    ON CONFLICT DO NOTHING;

  RETURN v_group_id;
END;
$$;

-- 2. Atomic reorder RPC (swap display_order between two groups)
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
    AND user_roles.role IN ('ADMIN', 'MASTER')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized to reorder menu groups';
  END IF;

  SELECT display_order INTO v_order1 FROM public_menu_groups WHERE id = p_group_id;
  SELECT display_order INTO v_order2 FROM public_menu_groups WHERE id = p_swap_group_id;

  IF v_order1 IS NULL OR v_order2 IS NULL THEN
    RAISE EXCEPTION 'One or both menu groups not found';
  END IF;

  UPDATE public_menu_groups SET display_order = v_order2 WHERE id = p_group_id;
  UPDATE public_menu_groups SET display_order = v_order1 WHERE id = p_swap_group_id;
END;
$$;

-- Grant execute on admin RPCs to authenticated only
REVOKE EXECUTE ON FUNCTION public.save_menu_group(uuid, text, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_menu_group(uuid, text, uuid[], boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reorder_menu_group(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_menu_group(uuid, uuid) TO authenticated;

-- 3. Remove public SELECT policies — public access is via RPC only
DROP POLICY IF EXISTS "Public can read enabled menu groups" ON public_menu_groups;
DROP POLICY IF EXISTS "Public can read menu group categories" ON public_menu_group_categories;
