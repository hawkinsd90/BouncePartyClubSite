import { useState, useEffect } from 'react';
import { useMenuGroupsData, type MenuGroup } from './useMenuGroupsData';
import { MenuGroupList } from './MenuGroupList';
import { MenuGroupForm } from './MenuGroupForm';

export function MenuGroupsTab() {
  const { groups, categories, loading, loadData, createGroup, updateGroup, deleteGroup, moveGroup } = useMenuGroupsData();
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<MenuGroup | null>(null);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleCreate() {
    setEditingGroup(null);
    setShowForm(true);
  }

  function handleEdit(group: MenuGroup) {
    setEditingGroup(group);
    setShowForm(true);
  }

  async function handleSave(title: string, categoryIds: string[], isEnabled: boolean) {
    if (editingGroup) {
      return updateGroup(editingGroup.id, title, categoryIds, isEnabled);
    }
    return createGroup(title, categoryIds, isEnabled);
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
      <MenuGroupList
        groups={groups}
        categories={categories}
        loading={loading}
        onCreate={handleCreate}
        onEdit={handleEdit}
        onDelete={deleteGroup}
        onMove={moveGroup}
      />
      {showForm && (
        <MenuGroupForm
          group={editingGroup}
          categories={categories}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditingGroup(null);
          }}
        />
      )}
    </div>
  );
}
