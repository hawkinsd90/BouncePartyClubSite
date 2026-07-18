import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Eye, EyeOff, Power, AlertCircle, Package } from 'lucide-react';
import { formatCurrency } from '../../../lib/pricing';
import { notifySuccess, notifyError, showConfirm } from '../../../lib/notifications';
import {
  fetchAdminProductsWithPricing,
  fetchAdminProductCategories,
  saveInventoryProductV2,
  buildSaveInventoryProductV2Params,
  checkProductInUseByBundles,
} from '../../../lib/queries/products';
import type {
  InventoryProductWithPricing,
  ProductCategory,
} from '../../../types';
import { ProductForm } from './ProductForm';
import { LoadingSpinner } from '../../common/LoadingSpinner';

export function ProductManager() {
  const [products, setProducts] = useState<InventoryProductWithPricing[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<InventoryProductWithPricing | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [productsResult, categoriesResult] = await Promise.all([
      fetchAdminProductsWithPricing(),
      fetchAdminProductCategories(),
    ]);

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

    setProducts(productsResult.data || []);
    setCategories(categoriesResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const nextSortOrder = products.length > 0
    ? Math.max(...products.map((p) => p.sort_order)) + 10
    : 10;

  function handleAddProduct() {
    setEditingProduct(null);
    setShowForm(true);
  }

  function handleEditProduct(product: InventoryProductWithPricing) {
    setEditingProduct(product);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingProduct(null);
  }

  async function handleFormSaved() {
    setShowForm(false);
    setEditingProduct(null);
    await loadData();
  }

  async function toggleProductField(
    product: InventoryProductWithPricing,
    field: 'active' | 'public_visible' | 'category_id',
    newValue: boolean | null,
    label: string
  ) {
    const existingUsage = await checkProductInUseByBundles(product.id);
    if (existingUsage.data && existingUsage.data.length > 0 && !newValue) {
      const bundleNames = existingUsage.data.map((b) => b.name).join(', ');
      const blocked = await showConfirm(
        `This product is used by active public package(s): ${bundleNames}.\n\nChanging ${label} may be blocked by the server. Continue anyway?`,
        { confirmText: 'Continue', type: 'warning' }
      );
      if (!blocked) return;
    }

    setActionLoading(product.id);

    try {
      const params = buildSaveInventoryProductV2Params(
        'update',
        product.id,
        {
          id: product.id,
          slug: product.slug,
          name: product.name,
          description: product.description ?? '',
          image_url: product.image_url,
          total_quantity: product.total_quantity,
          temp_unavailable_qty: product.temp_unavailable_qty,
          active: field === 'active' ? (newValue as boolean) : product.active,
          public_visible:
            field === 'public_visible' ? (newValue as boolean) : product.public_visible,
          category_id:
            field === 'category_id' ? (newValue as string | null) : product.category_id,
          sort_order: product.sort_order,
          standalone_enabled: product.pricing?.standalone_enabled ?? false,
          standalone_price_cents: product.pricing?.standalone_price_cents ?? null,
          addon_enabled: product.pricing?.addon_enabled ?? false,
          addon_price_cents: product.pricing?.addon_price_cents ?? null,
          addon_qualifying_threshold_cents:
            product.pricing?.addon_qualifying_threshold_cents ?? null,
        },
        product.image_url,
        product.pricing?.addon_qualifying_threshold_cents ?? null,
      );

      const { error: rpcError } = await saveInventoryProductV2(params);

      if (rpcError) {
        notifyError(rpcError.message || `Failed to update ${label}`);
      } else {
        notifySuccess(`${label} updated successfully`);
        await loadData();
      }
    } finally {
      setActionLoading(null);
    }
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
        <h3 className="text-lg font-bold text-slate-900">Products</h3>
        <button
          onClick={handleAddProduct}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

      {products.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No products yet. Click "Add Product" to create one.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto bg-white rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Available</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Standalone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Add-on</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {products.map((product) => {
                  const available = product.total_quantity - product.temp_unavailable_qty;
                  const isLoading = actionLoading === product.id;
                  return (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {product.image_url ? (
                            <img src={product.image_url} alt="" className="w-10 h-10 object-cover rounded-lg flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Package className="w-5 h-5 text-slate-400" />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium text-slate-900">{product.name}</div>
                            <div className="text-xs text-slate-500">Sort: {product.sort_order}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {product.category_name || <span className="text-amber-600">Uncategorized</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <span className="font-medium">{available}</span>
                        <span className="text-slate-400"> / {product.total_quantity}</span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {product.pricing?.standalone_enabled ? (
                          <span className="font-medium text-slate-900">{formatCurrency(product.pricing.standalone_price_cents || 0)}</span>
                        ) : (
                          <span className="text-slate-400">Disabled</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {product.pricing?.addon_enabled ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-slate-900">{formatCurrency(product.pricing.addon_price_cents || 0)}</span>
                            {product.pricing.addon_qualifying_threshold_cents === null ? (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                <AlertCircle className="w-3 h-3" />
                                Threshold not configured
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500">
                                Qualifies at {formatCurrency(product.pricing.addon_qualifying_threshold_cents)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">Disabled</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded w-fit ${product.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                            {product.active ? 'Available' : 'Unavailable'}
                          </span>
                          <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded w-fit ${product.public_visible ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                            {product.public_visible ? 'Website: Shown' : 'Website: Hidden'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleEditProduct(product)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleProductField(product, 'active', !product.active, 'availability')}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                            title={product.active ? 'Mark Unavailable' : 'Mark Available'}
                          >
                            <Power className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleProductField(product, 'public_visible', !product.public_visible, 'website visibility')}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                            title={product.public_visible ? 'Hide from Website' : 'Show on Website'}
                          >
                            {product.public_visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
            {products.map((product) => {
              const available = product.total_quantity - product.temp_unavailable_qty;
              const isLoading = actionLoading === product.id;
              return (
                <div key={product.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start gap-3 mb-3">
                    {product.image_url ? (
                      <img src={product.image_url} alt="" className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{product.name}</div>
                      <div className="text-xs text-slate-500">
                        {product.category_name || <span className="text-amber-600">Uncategorized</span>}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div className="text-slate-500">
                      Available: <span className="font-medium text-slate-900">{available}/{product.total_quantity}</span>
                    </div>
                    <div className="text-slate-500">
                      Sort: <span className="font-medium text-slate-900">{product.sort_order}</span>
                    </div>
                    <div className="text-slate-500">
                      Standalone: {product.pricing?.standalone_enabled
                        ? <span className="font-medium text-slate-900">{formatCurrency(product.pricing.standalone_price_cents || 0)}</span>
                        : <span className="text-slate-400">Off</span>}
                    </div>
                    <div className="text-slate-500">
                      Add-on: {product.pricing?.addon_enabled
                        ? (
                          <span>
                            <span className="font-medium text-slate-900">{formatCurrency(product.pricing.addon_price_cents || 0)}</span>
                            {product.pricing.addon_qualifying_threshold_cents === null
                              ? <span className="block text-amber-600">Threshold not configured</span>
                              : <span className="block text-slate-500">Qualifies at {formatCurrency(product.pricing.addon_qualifying_threshold_cents)}</span>}
                          </span>
                        )
                        : <span className="text-slate-400">Off</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded ${product.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                      {product.active ? 'Available' : 'Unavailable'}
                    </span>
                    <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded ${product.public_visible ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                      {product.public_visible ? 'Website: Shown' : 'Website: Hidden'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditProduct(product)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => toggleProductField(product, 'active', !product.active, 'availability')}
                      disabled={isLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Power className="w-3.5 h-3.5" />
                      {product.active ? 'Unavailable' : 'Available'}
                    </button>
                    <button
                      onClick={() => toggleProductField(product, 'public_visible', !product.public_visible, 'website visibility')}
                      disabled={isLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {product.public_visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {product.public_visible ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {showForm && (
        <ProductForm
          product={editingProduct}
          categories={categories}
          nextSortOrder={nextSortOrder}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  );
}
