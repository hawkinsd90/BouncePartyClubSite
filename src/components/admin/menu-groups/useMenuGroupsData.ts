import { useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { notifyError, showConfirm } from '../../../lib/notifications';
import { clearPublicMenuGroupsCache } from '../../../lib/adminSettingsCache';

const menuGroupsDb = supabase as any;

export interface MenuGroup {
  id: string;
  title: string;
  is_enabled: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  category_ids: string[];
}

export interface AdminProductCategory {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  active: boolean;
  public_visible: boolean;
}

export function useMenuGroupsData() {
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [categories, setCategories] = useState<AdminProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [groupsRes, catsRes] = await Promise.all([
        menuGroupsDb
          .from('public_menu_groups')
          .select('*')
          .order('display_order'),
        menuGroupsDb
          .from('product_categories')
          .select('id, slug, name, sort_order, active, public_visible')
          .order('sort_order'),
      ]);

      if (groupsRes.error) throw groupsRes.error;
      if (catsRes.error) throw catsRes.error;

      const groupRows = groupsRes.data ?? [];
      const catRows = catsRes.data ?? [];

      const groupIds = groupRows.map((g: { id: string }) => g.id);
      let associations: { menu_group_id: string; category_id: string }[] = [];
      if (groupIds.length > 0) {
        const assocRes = await menuGroupsDb
          .from('public_menu_group_categories')
          .select('menu_group_id, category_id')
          .in('menu_group_id', groupIds);
        if (assocRes.error) throw assocRes.error;
        associations = assocRes.data ?? [];
      }

      const assocMap = new Map<string, string[]>();
      for (const a of associations) {
        const existing = assocMap.get(a.menu_group_id) ?? [];
        existing.push(a.category_id);
        assocMap.set(a.menu_group_id, existing);
      }

      const merged: MenuGroup[] = groupRows.map((g: any) => ({
        id: g.id,
        title: g.title,
        is_enabled: g.is_enabled,
        display_order: g.display_order,
        created_at: g.created_at,
        updated_at: g.updated_at,
        category_ids: assocMap.get(g.id) ?? [],
      }));

      setGroups(merged);
      setCategories(catRows as AdminProductCategory[]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveGroup = useCallback(async (
    id: string | null,
    title: string,
    categoryIds: string[],
    isEnabled: boolean
  ): Promise<boolean> => {
    try {
      const { data, error: rpcError } = await menuGroupsDb.rpc('save_menu_group', {
        p_group_id: id,
        p_title: title,
        p_category_ids: categoryIds,
        p_is_enabled: isEnabled,
      });

      if (rpcError) throw rpcError;
      if (!data) throw new Error('Failed to save menu group');

      clearPublicMenuGroupsCache();
      await loadData();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyError('Failed to save menu group: ' + msg);
      return false;
    }
  }, [loadData]);

  const deleteGroup = useCallback(async (id: string): Promise<boolean> => {
    if (!await showConfirm('Are you sure you want to delete this menu group?')) return false;

    try {
      const { error } = await menuGroupsDb
        .from('public_menu_groups')
        .delete()
        .eq('id', id);
      if (error) throw error;

      clearPublicMenuGroupsCache();
      await loadData();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyError('Failed to delete menu group: ' + msg);
      return false;
    }
  }, [loadData]);

  const moveGroup = useCallback(async (id: string, direction: 'up' | 'down'): Promise<void> => {
    const currentIndex = groups.findIndex((g) => g.id === id);
    if (currentIndex < 0) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= groups.length) return;

    const targetGroup = groups[targetIndex];

    try {
      const { error: rpcError } = await menuGroupsDb.rpc('reorder_menu_group', {
        p_group_id: id,
        p_swap_group_id: targetGroup.id,
      });

      if (rpcError) throw rpcError;

      clearPublicMenuGroupsCache();
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyError('Failed to reorder menu group: ' + msg);
      await loadData();
    }
  }, [groups, loadData]);

  return {
    groups,
    categories,
    loading,
    error,
    loadData,
    saveGroup,
    deleteGroup,
    moveGroup,
  };
}
