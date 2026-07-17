import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Edit2, Eye, EyeOff, Power, Trash2,
  ChevronUp, ChevronDown, AlertCircle, X, Save, Tag,
} from 'lucide-react';
import { notifySuccess, notifyError, showConfirm } from '../../../lib/notifications';
import {
  fetchAdminProductCategories,
  fetchCategoryProductCounts,
  saveProductCategory,
  reorderProductCategories,
  deleteCategoryIfEmpty,
  type SaveProductCategoryParams,
} from '../../../lib/queries/products';
import type { ProductCategory, CategoryAdminFormData } from '../../../types';
import { LoadingSpinner } from '../../common/LoadingSpinner';

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function CategoryManager() {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [catResult, countResult] = await Promise.all([
      fetchAdminProductCategories(),
      fetchCategoryProductCounts(),
    ]);

    if (catResult.error) {
      setError(catResult.error.message || 'Failed to load categories');
      setLoading(false);
      return;
    }
    if (countResult.error) {
      console.error('Failed to load product counts:', countResult.error);
    }

    setCategories(catResult.data || []);
    setProductCounts(countResult.data || {});
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleAdd() {
    setEditingCategory(null);
    setShowForm(true);
  }

  function handleEdit(cat: ProductCategory) {
    setEditingCategory(cat);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingCategory(null);
  }

  async function handleFormSaved() {
    setShowForm(false);
    setEditingCategory(null);
    await loadData();
  }

  async function toggleField(
    cat: ProductCategory,
    field: 'active' | 'public_visible',
    newValue: boolean,
    label: string
  ) {
    if (!newValue) {
      const count = productCounts[cat.id] || 0;
      if (count > 0) {
        const confirmed = await showConfirm(
          `This category has ${count} product(s). Hiding or deactivating it may be blocked if those products are used by active public packages.\n\nContinue anyway?`,
          { confirmText: 'Continue', type: 'warning' }
        );
        if (!confirmed) return;
      }
    }

    setActionLoading(cat.id);

    const params: SaveProductCategoryParams = {
      p_operation: 'update',
      p_category_id: cat.id,
      p_slug: cat.slug,
      p_name: cat.name,
      p_sort_order: cat.sort_order,
      p_active: field === 'active' ? newValue : cat.active,
      p_public_visible: field === 'public_visible' ? newValue : cat.public_visible,
    };

    const { error: rpcError } = await saveProductCategory(params);

    if (rpcError) {
      notifyError(rpcError.message || `Failed to update ${label}`);
    } else {
      await loadData();
    }

    setActionLoading(null);
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;
    const orderedIds = categories.map((c) => c.id);
    [orderedIds[index - 1], orderedIds[index]] = [orderedIds[index], orderedIds[index - 1]];
    await doReorder(orderedIds);
  }

  async function handleMoveDown(index: number) {
    if (index === categories.length - 1) return;
    const orderedIds = categories.map((c) => c.id);
    [orderedIds[index], orderedIds[index + 1]] = [orderedIds[index + 1], orderedIds[index]];
    await doReorder(orderedIds);
  }

  async function doReorder(orderedIds: string[]) {
    setActionLoading('reorder');
    const { error: rpcError } = await reorderProductCategories(orderedIds);
    if (rpcError) {
      notifyError(rpcError.message || 'Failed to reorder categories');
    } else {
      await loadData();
    }
    setActionLoading(null);
  }

  async function handleDelete(cat: ProductCategory) {
    const count = productCounts[cat.id] || 0;
    if (count > 0) {
      notifyError(`Cannot delete category: ${count} product(s) are still assigned. Remove or reassign them first.`);
      return;
    }

    const confirmed = await showConfirm(
      `Are you sure you want to delete the category "${cat.name}"?\n\nOnly empty categories can be deleted.`,
      { confirmText: 'Delete', type: 'warning' }
    );
    if (!confirmed) return;

    setActionLoading(cat.id);
    const { error: rpcError } = await deleteCategoryIfEmpty(cat.id);
    if (rpcError) {
      notifyError(rpcError.message || 'Failed to delete category. It may have been assigned to a product.');
    } else {
      notifySuccess('Category deleted successfully');
      await loadData();
    }
    setActionLoading(null);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-12 gap-3">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={loadData} className="px-4 py-2 text-sm font-medium text-blue-600 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const sortedCategories = [...categories].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-slate-900">Categories</h3>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Category
        </button>
      </div>

      {sortedCategories.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg">
          <Tag className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No categories yet. Click "Add Category" to create one.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Slug</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Sort</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Products</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedCategories.map((cat, index) => {
                  const count = productCounts[cat.id] || 0;
                  const isLoading = actionLoading === cat.id;
                  return (
                    <tr key={cat.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{cat.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-slate-500">{cat.slug}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{cat.sort_order}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{count}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded w-fit ${cat.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                            {cat.active ? 'Available' : 'Unavailable'}
                          </span>
                          <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded w-fit ${cat.public_visible ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                            {cat.public_visible ? 'Website: Shown' : 'Website: Hidden'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0 || actionLoading === 'reorder'}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move up"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleMoveDown(index)}
                            disabled={index === sortedCategories.length - 1 || actionLoading === 'reorder'}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move down"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleEdit(cat)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleField(cat, 'active', !cat.active, 'availability')}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                            title={cat.active ? 'Mark Unavailable' : 'Mark Available'}
                          >
                            <Power className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleField(cat, 'public_visible', !cat.public_visible, 'website visibility')}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                            title={cat.public_visible ? 'Hide from Website' : 'Show on Website'}
                          >
                            {cat.public_visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleDelete(cat)}
                            disabled={isLoading}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Delete (only if empty)"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {sortedCategories.map((cat, index) => {
              const count = productCounts[cat.id] || 0;
              const isLoading = actionLoading === cat.id;
              return (
                <div key={cat.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{cat.name}</div>
                      <div className="text-xs font-mono text-slate-500">{cat.slug}</div>
                    </div>
                    <div className="text-xs text-slate-500 flex-shrink-0 ml-2">
                      {count} product{count !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded ${cat.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                      {cat.active ? 'Available' : 'Unavailable'}
                    </span>
                    <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded ${cat.public_visible ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                      {cat.public_visible ? 'Website: Shown' : 'Website: Hidden'}
                    </span>
                    <span className="text-xs text-slate-400">Sort: {cat.sort_order}</span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0 || actionLoading === 'reorder'}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
                    >
                      <ChevronUp className="w-3.5 h-3.5" /> Up
                    </button>
                    <button
                      onClick={() => handleMoveDown(index)}
                      disabled={index === sortedCategories.length - 1 || actionLoading === 'reorder'}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
                    >
                      <ChevronDown className="w-3.5 h-3.5" /> Down
                    </button>
                    <button
                      onClick={() => handleEdit(cat)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => toggleField(cat, 'active', !cat.active, 'availability')}
                      disabled={isLoading}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Power className="w-3.5 h-3.5" /> {cat.active ? 'Unavailable' : 'Available'}
                    </button>
                    <button
                      onClick={() => toggleField(cat, 'public_visible', !cat.public_visible, 'website visibility')}
                      disabled={isLoading}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {cat.public_visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {cat.public_visible ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => handleDelete(cat)}
                      disabled={isLoading}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {showForm && (
        <CategoryForm
          category={editingCategory}
          nextSortOrder={categories.length > 0 ? Math.max(...categories.map((c) => c.sort_order)) + 10 : 10}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  );
}

function CategoryForm({
  category,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  category: ProductCategory | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = category !== null;
  const slugManuallyEdited = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<CategoryAdminFormData>(() =>
    category
      ? {
          id: category.id,
          slug: category.slug,
          name: category.name,
          active: category.active,
          public_visible: category.public_visible,
          sort_order: category.sort_order,
        }
      : {
          id: null,
          slug: '',
          name: '',
          active: true,
          public_visible: false,
          sort_order: nextSortOrder,
        }
  );

  useEffect(() => {
    if (!isEdit && !slugManuallyEdited.current) {
      setFormData((prev) => ({ ...prev, slug: generateSlug(prev.name) }));
    }
  }, [formData.name, isEdit]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!formData.name.trim()) e.name = 'Name is required';
    if (!formData.slug.trim()) e.slug = 'Slug is required';
    else if (!SLUG_REGEX.test(formData.slug)) e.slug = 'Slug must be lowercase, alphanumeric, hyphen-separated';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRpcError(null);
    if (!validate()) return;

    setIsSaving(true);

    const params: SaveProductCategoryParams = {
      p_operation: isEdit ? 'update' : 'create',
      p_category_id: isEdit ? formData.id : null,
      p_slug: formData.slug,
      p_name: formData.name.trim(),
      p_sort_order: formData.sort_order,
      p_active: formData.active,
      p_public_visible: formData.public_visible,
    };

    const { error: rpcError } = await saveProductCategory(params);

    if (rpcError) {
      setRpcError(rpcError.message || 'Failed to save category');
      notifyError(rpcError.message || 'Failed to save category');
    } else {
      notifySuccess(isEdit ? 'Category updated successfully' : 'Category created successfully');
      onSaved();
    }

    setIsSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{isEdit ? 'Edit Category' : 'Add Category'}</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {rpcError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{rpcError}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Category Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, name: e.target.value }));
                if (!slugManuallyEdited.current) {
                  setFormData((prev) => ({ ...prev, slug: generateSlug(e.target.value) }));
                }
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              placeholder="e.g. Tables & Chairs"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.slug}
              onChange={(e) => {
                slugManuallyEdited.current = true;
                setFormData((prev) => ({ ...prev, slug: e.target.value }));
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm font-mono"
              placeholder="auto-generated-from-name"
            />
            {errors.slug && <p className="mt-1 text-xs text-red-600">{errors.slug}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => setFormData((prev) => ({ ...prev, active: e.target.checked }))}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-slate-700 font-medium">Available for Use</span>
                <p className="text-xs text-slate-500">Allows this item to be used in Event Essentials inventory and packages.</p>
              </div>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={formData.public_visible}
                onChange={(e) => setFormData((prev) => ({ ...prev, public_visible: e.target.checked }))}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-slate-700 font-medium">Shown on Website</span>
                <p className="text-xs text-slate-500">Displays this item to customers when it is also available for use and properly categorized.</p>
              </div>
            </label>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Category'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
