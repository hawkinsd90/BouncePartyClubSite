import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import {
  saveInventoryProduct,
  type SaveInventoryProductParams,
} from '../../../lib/queries/products';
import {
  notifySuccess,
  notifyError,
  notifyWarning,
} from '../../../lib/notifications';
import { supabase } from '../../../lib/supabase';
import { parseStoragePath } from '../../../lib/queries/products';
import type {
  InventoryProductWithPricing,
  ProductCategory,
  ProductAdminFormData,
} from '../../../types';
import {
  AdminImageUpload,
  type AdminImageUploadHandle,
  type UploadedImage,
} from './AdminImageUpload';

interface ProductFormProps {
  product: InventoryProductWithPricing | null;
  categories: ProductCategory[];
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PRICE_REGEX = /^\d+(\.\d{1,2})?$/;

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Strict currency string validation. Never throws.
 * Returns { valid: true, cents: number | null } for valid input.
 * Returns { valid: false, cents: null } for invalid input.
 * Blank string is valid and returns cents: null.
 */
function parsePrice(dollars: string): { valid: boolean; cents: number | null } {
  const trimmed = dollars.trim();
  if (trimmed === '') return { valid: true, cents: null };
  if (!PRICE_REGEX.test(trimmed)) return { valid: false, cents: null };
  const cents = Math.round(parseFloat(trimmed) * 100);
  return { valid: true, cents };
}

function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

export function ProductForm({
  product,
  categories,
  nextSortOrder,
  onClose,
  onSaved,
}: ProductFormProps) {
  const isEdit = product !== null;
  const slugManuallyEdited = useRef(false);

  const productIdRef = useRef<string>(product?.id || crypto.randomUUID());

  const [formData, setFormData] = useState<ProductAdminFormData>(() => {
    if (product) {
      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description || '',
        image_url: product.image_url,
        total_quantity: product.total_quantity,
        temp_unavailable_qty: product.temp_unavailable_qty,
        active: product.active,
        public_visible: product.public_visible,
        category_id: product.category_id,
        sort_order: product.sort_order,
        standalone_enabled: product.pricing?.standalone_enabled ?? false,
        standalone_price_cents: product.pricing?.standalone_price_cents ?? null,
        addon_enabled: product.pricing?.addon_enabled ?? false,
        addon_price_cents: product.pricing?.addon_price_cents ?? null,
      };
    }
    return {
      id: null,
      slug: '',
      name: '',
      description: '',
      image_url: null,
      total_quantity: 0,
      temp_unavailable_qty: 0,
      active: true,
      public_visible: false,
      category_id: null,
      sort_order: nextSortOrder,
      standalone_enabled: false,
      standalone_price_cents: null,
      addon_enabled: false,
      addon_price_cents: null,
    };
  });

  const [standalonePriceDisplay, setStandalonePriceDisplay] = useState(() =>
    centsToDollars(product?.pricing?.standalone_price_cents)
  );
  const [addonPriceDisplay, setAddonPriceDisplay] = useState(() =>
    centsToDollars(product?.pricing?.addon_price_cents)
  );

  const [imageAction, setImageAction] = useState<'upload' | 'remove' | 'none'>('none');
  const [newUploadedImage, setNewUploadedImage] = useState<UploadedImage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rpcError, setRpcError] = useState<string | null>(null);

  const imageUploadRef = useRef<AdminImageUploadHandle>(null);
  const prevImageUrl = useRef<string | null>(product?.image_url ?? null);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!isEdit && !slugManuallyEdited.current) {
      setFormData((prev) => ({ ...prev, slug: generateSlug(prev.name) }));
    }
  }, [formData.name, isEdit]);

  const handleFieldChange = useCallback(
    <K extends keyof ProductAdminFormData>(field: K, value: ProductAdminFormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      if (field === 'slug') slugManuallyEdited.current = true;
    },
    []
  );

  const handleImageChange = useCallback(
    (image: UploadedImage | null, action: 'upload' | 'remove' | 'none') => {
      setNewUploadedImage(image);
      setImageAction(action);
    },
    []
  );

  const handleUploadStateChange = useCallback((busy: boolean) => {
    setIsUploading(busy);
  }, []);

  const isBusy = isSaving || isUploading;

  async function cleanupPendingUpload(): Promise<void> {
    const img = imageUploadRef.current?.getUploadedImage();
    if (img) {
      await imageUploadRef.current?.deleteNewlyUploaded();
    }
    setNewUploadedImage(null);
    setImageAction('none');
  }

  async function handleClose(): Promise<void> {
    if (closedRef.current) return;
    if (isBusy) return;
    closedRef.current = true;
    await cleanupPendingUpload();
    onClose();
  }

  function validate(): boolean {
    const e: Record<string, string> = {};

    if (!formData.name.trim()) e.name = 'Name is required';
    if (!formData.slug.trim()) e.slug = 'Slug is required';
    else if (!SLUG_REGEX.test(formData.slug))
      e.slug = 'Slug must be lowercase, alphanumeric, hyphen-separated';

    if (!Number.isInteger(formData.total_quantity) || formData.total_quantity < 0)
      e.total_quantity = 'Must be a whole number >= 0';
    if (!Number.isInteger(formData.temp_unavailable_qty) || formData.temp_unavailable_qty < 0)
      e.temp_unavailable_qty = 'Must be a whole number >= 0';
    if (formData.temp_unavailable_qty > formData.total_quantity)
      e.temp_unavailable_qty = 'Cannot exceed total inventory';

    // Standalone price: strict validation, no parseFloat exceptions
    const standaloneTrimmed = standalonePriceDisplay.trim();
    const standaloneParsed = parsePrice(standalonePriceDisplay);
    if (formData.standalone_enabled && standaloneTrimmed === '') {
      e.standalone_price = 'Required when standalone is enabled';
    } else if (standaloneTrimmed !== '' && !standaloneParsed.valid) {
      e.standalone_price = 'Enter a valid dollar amount (e.g. 12, 12.50)';
    }

    // Add-on price: strict validation, no parseFloat exceptions
    const addonTrimmed = addonPriceDisplay.trim();
    const addonParsed = parsePrice(addonPriceDisplay);
    if (formData.addon_enabled && addonTrimmed === '') {
      e.addon_price = 'Required when add-on is enabled';
    } else if (addonTrimmed !== '' && !addonParsed.valid) {
      e.addon_price = 'Enter a valid dollar amount (e.g. 12, 12.50)';
    }

    if (formData.category_id) {
      const cat = categories.find((c) => c.id === formData.category_id);
      if (!cat) e.category_id = 'Selected category does not exist';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function deleteStorageFile(url: string): Promise<boolean> {
    const path = parseStoragePath(url);
    if (!path) return true;
    try {
      const { error } = await supabase.storage.from('event-essentials-media').remove([path]);
      if (error) {
        console.error('Failed to delete old storage file:', path, error.message);
        notifyWarning(
          'The product was saved, but the old image file could not be deleted. Manual cleanup may be needed.'
        );
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to delete old storage file:', path, err);
      notifyWarning(
        'The product was saved, but the old image file could not be deleted. Manual cleanup may be needed.'
      );
      return false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRpcError(null);

    if (!validate()) return;

    const standaloneParsed = parsePrice(standalonePriceDisplay);
    const addonParsed = parsePrice(addonPriceDisplay);
    const standaloneCents = standaloneParsed.cents;
    const addonCents = addonParsed.cents;

    let imageUrl = formData.image_url;

    if (imageAction === 'remove') {
      imageUrl = null;
    } else if (imageAction === 'upload' && newUploadedImage) {
      imageUrl = newUploadedImage.url;
    }

    const productId = productIdRef.current;

    const params: SaveInventoryProductParams = {
      p_operation: isEdit ? 'update' : 'create',
      p_product_id: productId,
      p_slug: formData.slug,
      p_name: formData.name.trim(),
      p_description: formData.description.trim() || null,
      p_image_url: imageUrl,
      p_total_quantity: formData.total_quantity,
      p_temp_unavailable_qty: formData.temp_unavailable_qty,
      p_active: formData.active,
      p_public_visible: formData.public_visible,
      p_category_id: formData.category_id,
      p_sort_order: formData.sort_order,
      p_standalone_price_cents: standaloneCents,
      p_addon_price_cents: addonCents,
      p_standalone_enabled: formData.standalone_enabled,
      p_addon_enabled: formData.addon_enabled,
    };

    setIsSaving(true);

    try {
      const { error } = await saveInventoryProduct(params);

      if (error) {
        const msg = error.message || 'Failed to save product';
        setRpcError(msg);
        notifyError(msg);

        if (imageAction === 'upload') {
          const deleted = await imageUploadRef.current?.deleteNewlyUploaded();
          if (deleted) {
            // Cleanup succeeded — reset state so second submit won't send deleted URL
            setNewUploadedImage(null);
            setImageAction('none');
            imageUploadRef.current?.resetToCurrentImage();
          } else {
            // Cleanup failed — retain pending reference for retry
            // Don't reset state; second submit will attempt cleanup again
          }
        }
        return;
      }

      // RPC succeeded — commit the pending upload so close cleanup won't delete it
      if (imageAction === 'upload') {
        imageUploadRef.current?.commitUploadedImage();
      }

      // Delete prior saved image only after RPC success
      if (imageAction === 'upload' && newUploadedImage && prevImageUrl.current) {
        await deleteStorageFile(prevImageUrl.current);
      }

      if (imageAction === 'remove' && prevImageUrl.current) {
        await deleteStorageFile(prevImageUrl.current);
      }

      notifySuccess(isEdit ? 'Product updated successfully' : 'Product created successfully');
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save product';
      setRpcError(msg);
      notifyError(msg);

      if (imageAction === 'upload') {
        const deleted = await imageUploadRef.current?.deleteNewlyUploaded();
        if (deleted) {
          setNewUploadedImage(null);
          setImageAction('none');
          imageUploadRef.current?.resetToCurrentImage();
        }
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <h3 className="text-xl font-bold text-slate-900">
            {isEdit ? 'Edit Product' : 'Add Product'}
          </h3>
          <button
            onClick={handleClose}
            disabled={isBusy}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={isBusy ? 'Please wait...' : 'Close'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-5">
          {rpcError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{rpcError}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Product Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              placeholder="e.g. Six-foot Rectangular Table"
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
              onChange={(e) => handleFieldChange('slug', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm font-mono"
              placeholder="auto-generated-from-name"
            />
            {errors.slug && <p className="mt-1 text-xs text-red-600">{errors.slug}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Category</label>
            <select
              value={formData.category_id || ''}
              onChange={(e) => handleFieldChange('category_id', e.target.value || null)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
            >
              <option value="">— No category (hidden publicly) —</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            {errors.category_id && <p className="mt-1 text-xs text-red-600">{errors.category_id}</p>}
            {!formData.category_id && (
              <p className="mt-1 text-xs text-amber-600">
                Products without a category are hidden from the public catalog.
              </p>
            )}
          </div>

          <AdminImageUpload
            ref={imageUploadRef}
            folder="products"
            ownerId={productIdRef.current}
            currentImageUrl={formData.image_url}
            onImageChange={handleImageChange}
            onUploadStateChange={handleUploadStateChange}
            label="Product Image"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Total Inventory <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={formData.total_quantity}
                onChange={(e) =>
                  handleFieldChange('total_quantity', Math.max(0, Math.floor(Number(e.target.value))))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              />
              {errors.total_quantity && (
                <p className="mt-1 text-xs text-red-600">{errors.total_quantity}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Temp. Unavailable <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={formData.temp_unavailable_qty}
                onChange={(e) =>
                  handleFieldChange(
                    'temp_unavailable_qty',
                    Math.max(0, Math.floor(Number(e.target.value)))
                  )
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              />
              {errors.temp_unavailable_qty && (
                <p className="mt-1 text-xs text-red-600">{errors.temp_unavailable_qty}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Sort Order</label>
              <input
                type="number"
                step={1}
                value={formData.sort_order}
                onChange={(e) => handleFieldChange('sort_order', Math.floor(Number(e.target.value)))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-sm font-bold text-slate-700 mb-3">Standalone Pricing</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.standalone_enabled}
                  onChange={(e) => handleFieldChange('standalone_enabled', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">Enable standalone purchase</span>
              </label>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Standalone Price ($)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={standalonePriceDisplay}
                  onChange={(e) => setStandalonePriceDisplay(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  placeholder="0.00"
                />
                {errors.standalone_price && (
                  <p className="mt-1 text-xs text-red-600">{errors.standalone_price}</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-sm font-bold text-slate-700 mb-3">Add-on Pricing</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.addon_enabled}
                  onChange={(e) => handleFieldChange('addon_enabled', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">Enable as add-on</span>
              </label>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Add-on Price ($)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={addonPriceDisplay}
                  onChange={(e) => setAddonPriceDisplay(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  placeholder="0.00"
                />
                {errors.addon_price && (
                  <p className="mt-1 text-xs text-red-600">{errors.addon_price}</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => handleFieldChange('active', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700">Active</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.public_visible}
                onChange={(e) => handleFieldChange('public_visible', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700">Public Visible</span>
            </label>
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={handleClose}
              disabled={isBusy}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isBusy ? 'Please wait...' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
