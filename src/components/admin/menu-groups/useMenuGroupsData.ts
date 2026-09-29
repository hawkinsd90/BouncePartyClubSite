import { useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { notifyError, showConfirm } from '../../../lib/notifications';
import { clearPublicMenuGroupsCache } from '../../../lib/adminSettingsCache';

export interface MenuGroup {
  id: string;
  title: string;
  is_enabled: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  category_ids: string[];
}

export interface MenuGroupCategory {
  menu_group_id: string;
  category_id: string;
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
        supabase
          .from('public_menu_groups')
          .select('*')
          .order('display_order'),
        supabase
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
        const assocRes = await supabase
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

  const createGroup = useCallback(async (title: string, categoryIds: string[], isEnabled: boolean): Promise<boolean> => {
    try {
      const { data, error: insertError } = await supabase
        .from('public_menu_groups')
        .insert({
          title,
          is_enabled: isEnabled,
          display_order: groups.length,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      if (!data?.id) throw new Error('Failed to create menu group');

      if (categoryIds.length > 0) {
        const assocRows = categoryIds.map((cid) => ({
          menu_group_id: data.id,
          category_id: cid,
        }));
        const { error: assocError } = await supabase
          .from('public_menu_group_categories')
          .insert(assocRows);
        if (assocError) throw assocError;
      }

      clearPublicMenuGroupsCache();
      await loadData();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyError('Failed to create menu group: ' + msg);
      return false;
    }
  }, [groups.length, loadData]);

  const updateGroup = useCallback(async (
    id: string,
    title: string,
    categoryIds: string[],
    isEnabled: boolean
  ): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('public_menu_groups')
        .update({ title, is_enabled: isEnabled })
        .eq('id', id);
      if (updateError) throw updateError;

      const { error: deleteError } = await supabase
        .from('public_menu_group_categories')
        .delete()
        .eq('menu_group_id', id);
      if (deleteError) throw deleteError;

      if (categoryIds.length > 0) {
        const assocRows = categoryIds.map((cid) => ({
          menu_group_id: id,
          category_id: cid,
        }));
        const { error: assocError } = await supabase
          .from('public_menu_group_categories')
          .insert(assocRows);
        if (assocError) throw assocError;
      }

      clearPublicMenuGroupsCache();
      await loadData();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyError('Failed to update menu group: ' + msg);
      return false;
    }
  }, [loadData]);

  const deleteGroup = useCallback(async (id: string): Promise<boolean> => {
    if (!await showConfirm('Are you sure you want to delete this menu group?')) return false;

    try {
      const { error } = await supabase
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

  const moveGroup = useCallback(async (id: string, direction: 'up' | 'down') => {
    const current = groups.find((g) => g.id === id);
    if (!current) return;

    const targetOrder = direction === 'up'
      ? current.display_order - 1
      : current.display_order + 1;

    const target = groups.find((g) => g.display_order === targetOrder);
    if (!target) return;

    await supabase
      .from('public_menu_groups')
      .update({ display_order: targetOrder })
      .eq('id', current.id);
    await supabase
      .from('public_menu_groups')
      .update({ display_order: current.display_order })
      .eq('id', target.id);

    clearPublicMenuGroupsCache();
    await loadData();
  }, [groups, loadData]);

  return {
    groups,
    categories,
    loading,
    error,
    loadData,
    createGroup,
    updateGroup,
    deleteGroup,
    moveGroup,
  };
}
