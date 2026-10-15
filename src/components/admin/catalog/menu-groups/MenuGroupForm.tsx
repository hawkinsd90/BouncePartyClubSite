import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import type { MenuGroup, AdminProductCategory } from './useMenuGroupsData';

interface MenuGroupFormProps {
  group: MenuGroup | null;
  categories: AdminProductCategory[];
  onSave: (title: string, categoryIds: string[], isEnabled: boolean) => Promise<boolean>;
  onCancel: () => void;
}

export function MenuGroupForm({ group, categories, onSave, onCancel }: MenuGroupFormProps) {
  const [title, setTitle] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (group) {
      setTitle(group.title);
      setSelectedCategoryIds(group.category_ids);
      setIsEnabled(group.is_enabled);
    } else {
      setTitle('');
      setSelectedCategoryIds([]);
      setIsEnabled(true);
    }
  }, [group]);

  function toggleCategory(id: string) {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || selectedCategoryIds.length === 0) return;
    setSaving(true);
    const ok = await onSave(title.trim(), selectedCategoryIds, isEnabled);
    setSaving(false);
    if (ok) onCancel();
  }

  const selectableCategories = categories.filter((c) => c.active && c.public_visible);
  const selectedButInactive = categories.filter(
    (c) => selectedCategoryIds.includes(c.id) && (!c.active || !c.public_visible)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">
            {group ? 'Edit Menu Group' : 'New Menu Group'}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Menu Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Tables & Chairs"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Event Essential Categories
            </label>
            <p className="text-xs text-slate-500 mb-3">
              Select one or more categories. Products assigned to these categories will
              appear under this menu group.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-200 rounded-lg p-3">
              {selectableCategories.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">
                  No active categories available. Create categories in the Inventory tab first.
                </p>
              )}
              {selectableCategories.map((cat) => {
                const selected = selectedCategoryIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                      selected
                        ? 'bg-blue-50 text-blue-800 border border-blue-300'
                        : 'bg-slate-50 text-slate-700 border border-transparent hover:bg-slate-100'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                      selected ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                    }`}>
                      {selected && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                    {cat.name}
                    <span className="text-xs text-slate-400 ml-auto">{cat.slug}</span>
                  </button>
                );
              })}
              {selectedButInactive.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-amber-50 border border-amber-200"
                >
                  <div className="w-5 h-5 rounded border bg-amber-400 border-amber-400 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-amber-800 font-medium">{cat.name}</span>
                  <span className="text-xs text-amber-600 ml-auto">
                    {!cat.active ? 'Inactive' : 'Hidden'}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className="text-amber-600 hover:text-amber-800 text-xs font-medium ml-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-slate-700">Enabled</span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-slate-700 font-medium rounded-lg hover:bg-slate-100 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || selectedCategoryIds.length === 0 || saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : group ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
