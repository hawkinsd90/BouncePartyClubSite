import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Edit2, Power, AlertCircle, Package,
} from 'lucide-react';
import { formatCurrency } from '../../../lib/pricing';
import { notifySuccess, notifyError } from '../../../lib/notifications';
import {
  fetchAdminProductBundles,
  fetchAdminProductsWithPricing,
  fetchAdminProductCategories,
  saveProductBundle,
  buildSaveBundleParams,
} from '../../../lib/queries/products';
import type {
  ProductBundleWithComponents,
  InventoryProductWithPricing,
  ProductCategory,
  PackageAdminFormData,
} from '../../../types';
import { PackageForm } from './PackageForm';
import { LoadingSpinner } from '../../common/LoadingSpinner';

export function PackageManager() {
  const [bundles, setBundles] = useState<ProductBundleWithComponents[]>([]);
  const [products, setProducts] = useState<InventoryProductWithPricing[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingBundle, setEditingBundle] = useState<ProductBundleWithComponents | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [bundlesResult, productsResult, categoriesResult] = await Promise.all([
      fetchAdminProductBundles(),
      fetchAdminProductsWithPricing(),
      fetchAdminProductCategories(),
    ]);

    if (bundlesResult.error) {
      setError(bundlesResult.error.message || 'Failed to load packages');
      setLoading(false);
      return;
    }
    if (productsResult.error) {
      setError(productsResult.error.message || 'Failed to load products');
      setLoading(false);
      return;
    }
    if (categoriesResult.error) {
      setError(categoriesResult.error.message || 'Failed to load categories');
      setLoading(false);
      return;
    }

    setBundles(bundlesResult.data || []);
    setProducts(productsResult.data || []);
    setCategories(categoriesResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const nextSortOrder = useMemo(
    () => (bundles.length > 0 ? Math.max(...bundles.map((b) => b.sort_order)) + 10 : 10),
    [bundles],
  );

  function handleAddPackage() {
    setEditingBundle(null);
    setShowForm(true);
  }

  function handleEditPackage(bundle: ProductBundleWithComponents) {
    setEditingBundle(bundle);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingBundle(null);
  }

  async function handleFormSaved() {
    setShowForm(false);
    setEditingBundle(null);
    await loadData();
  }

  async function toggleBundleAvailability(
    bundle: ProductBundleWithComponents,
    makeAvailable: boolean,
  ) {
    setActionLoading(bundle.id);

    const formData: PackageAdminFormData = {
      id: bundle.id,
      slug: bundle.slug,
      name: bundle.name,
      description: bundle.description || '',
      image_url: bundle.image_url,
      standalone_enabled: bundle.standalone_enabled,
      standalone_price_cents: bundle.standalone_price_cents,
      addon_enabled: bundle.addon_enabled,
      addon_price_cents: bundle.addon_price_cents,
      active: makeAvailable,
      public_visible: makeAvailable,
      menu_visible: makeAvailable,
      featured: bundle.featured,
      sort_order: bundle.sort_order,
      components: bundle.product_bundle_components.map((c) => ({
        product_id: c.product_id,
        quantity_per_bundle: c.quantity_per_bundle,
      })),
    };

    const params = buildSaveBundleParams('update', bundle.id, formData, bundle.image_url);

    const { error: rpcError } = await saveProductBundle(params);

    if (rpcError) {
      notifyError(rpcError.message || 'Failed to update availability');
    } else {
      notifySuccess(makeAvailable ? 'Package marked available' : 'Package marked unavailable');
      await loadData();
    }

    setActionLoading(null);
  }

  function componentSummary(bundle: ProductBundleWithComponents): string {
    if (bundle.product_bundle_components.length === 0) return 'No components';
    return bundle.product_bundle_components
      .map((c) => {
        const name = c.inventory_products?.name ?? 'Unknown Product';
        return `${c.quantity_per_bundle} × ${name}`;
      })
      .join(', ');
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
        <button
          onClick={loadData}
          className="px-4 py-2 text-sm font-medium text-blue-600 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-slate-900">Packages</h3>
        <button
          onClick={handleAddPackage}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Package
        </button>
      </div>

      {bundles.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">
            No packages yet. Click "Add Package" to create one.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto bg-white rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Package</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Components</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Standalone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Add-on</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {bundles.map((bundle) => {
                  const isLoading = actionLoading === bundle.id;
                  return (
                    <tr key={bundle.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {bundle.image_url ? (
                            <img src={bundle.image_url} alt="" className="w-10 h-10 object-cover rounded-lg flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Package className="w-5 h-5 text-slate-400" />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium text-slate-900">{bundle.name}</div>
                            <div className="text-xs text-slate-500">Sort: {bundle.sort_order}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 max-w-xs">
                        <div className="truncate" title={componentSummary(bundle)}>
                          {componentSummary(bundle)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {bundle.standalone_enabled ? (
                          <span className="font-medium text-slate-900">{formatCurrency(bundle.standalone_price_cents || 0)}</span>
                        ) : (
                          <span className="text-slate-400">Disabled</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {bundle.addon_enabled ? (
                          <span className="font-medium text-slate-900">{formatCurrency(bundle.addon_price_cents || 0)}</span>
                        ) : (
                          <span className="text-slate-400">Disabled</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded ${bundle.active && bundle.public_visible ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                          {bundle.active && bundle.public_visible ? 'Available' : 'Unavailable'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleEditPackage(bundle)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleBundleAvailability(bundle, !(bundle.active && bundle.public_visible))}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                            title={bundle.active && bundle.public_visible ? 'Mark Unavailable' : 'Mark Available'}
                          >
                            <Power className="w-4 h-4" />
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
          <div className="lg:hidden space-y-3">
            {bundles.map((bundle) => {
              const isLoading = actionLoading === bundle.id;
              return (
                <div key={bundle.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start gap-3 mb-3">
                    {bundle.image_url ? (
                      <img src={bundle.image_url} alt="" className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{bundle.name}</div>
                      <div className="text-xs text-slate-500">Sort: {bundle.sort_order}</div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 mb-2 break-words">
                    {componentSummary(bundle)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div className="text-slate-500">
                      Standalone: {bundle.standalone_enabled
                        ? <span className="font-medium text-slate-900">{formatCurrency(bundle.standalone_price_cents || 0)}</span>
                        : <span className="text-slate-400">Off</span>}
                    </div>
                    <div className="text-slate-500">
                      Add-on: {bundle.addon_enabled
                        ? <span className="font-medium text-slate-900">{formatCurrency(bundle.addon_price_cents || 0)}</span>
                        : <span className="text-slate-400">Off</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded ${bundle.active && bundle.public_visible ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                      {bundle.active && bundle.public_visible ? 'Available' : 'Unavailable'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => handleEditPackage(bundle)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => toggleBundleAvailability(bundle, !(bundle.active && bundle.public_visible))}
                      disabled={isLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Power className="w-3.5 h-3.5" />
                      {bundle.active && bundle.public_visible ? 'Unavailable' : 'Available'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {showForm && (
        <PackageForm
          bundle={editingBundle}
          products={products}
          categories={categories}
          nextSortOrder={nextSortOrder}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  );
}
