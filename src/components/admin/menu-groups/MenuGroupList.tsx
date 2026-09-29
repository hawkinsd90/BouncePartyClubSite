import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { MenuGroup, AdminProductCategory } from './useMenuGroupsData';

interface MenuGroupListProps {
  groups: MenuGroup[];
  categories: AdminProductCategory[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (group: MenuGroup) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
}

export function MenuGroupList({
  groups,
  categories,
  loading,
  onCreate,
  onEdit,
  onDelete,
  onMove,
}: MenuGroupListProps) {
  const categoryNameMap = new Map(categories.map((c) => [c.id, c.name]));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Menu Groups</h2>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Menu Group
        </button>
      </div>

      <p className="text-sm text-slate-600">
        Configure customer-facing navigation groups based on Event Essentials categories.
        Groups appear in the public navigation when their categories contain qualifying
        inventory (more than 1 unit).
      </p>

      {groups.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <p className="text-slate-600 mb-1">No menu groups configured yet.</p>
          <p className="text-sm text-slate-500">
            Create a group to add dynamic navigation items for your customers.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group, index) => {
            const catNames = group.category_ids
              .map((id) => categoryNameMap.get(id))
              .filter(Boolean) as string[];

            return (
              <div
                key={group.id}
                className={`bg-white rounded-xl shadow-sm border p-5 transition-shadow ${
                  group.is_enabled
                    ? 'border-slate-200 hover:shadow-md'
                    : 'border-slate-200 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold text-slate-900">{group.title}</h3>
                      {!group.is_enabled && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {catNames.length === 0 ? (
                        <span className="text-sm text-slate-400">No categories selected</span>
                      ) : (
                        catNames.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-xs text-slate-700"
                          >
                            {name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => onMove(group.id, 'up')}
                      disabled={index === 0}
                      className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(group.id, 'down')}
                      disabled={index === groups.length - 1}
                      className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(group)}
                      className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(group.id)}
                      className="w-8 h-8 rounded-lg border border-red-200 flex items-center justify-center text-red-600 hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
