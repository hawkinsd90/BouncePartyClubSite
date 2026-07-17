import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Save, AlertCircle, Plus, Trash2 } from 'lucide-react';
import {
  saveProductBundle,
  buildSaveBundleParams,
  parsePrice,
  priceErrorMessage,
  centsToDollars,
  parseStoragePath,
  bundleToFormData,
} from '../../../lib/queries/products';
import {
  notifySuccess,
  notifyError,
  notifyWarning,
} from '../../../lib/notifications';
import { supabase } from '../../../lib/supabase';
import type {
  ProductBundleWithComponents,
  InventoryProductWithPricing,
  ProductCategory,
  PackageAdminFormData,
  PackageComponentFormRow,
} from '../../../types';
import {
  AdminImageUpload,
  type AdminImageUploadHandle,
  type UploadedImage,
} from './AdminImageUpload';

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_INT = 2147483647;
const QTY_REGEX = /^[0-9]+$/;

interface EditableComponentRow {
  product_id: string;
  quantity_input: string;
}

type PackageFormState = Omit<PackageAdminFormData, 'components'> & {
  components: EditableComponentRow[];
};

interface PackageFormProps {
  bundle: ProductBundleWithComponents | null;
  products: InventoryProductWithPricing[];
  categories: ProductCategory[];
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function initialFormData(
  bundle: ProductBundleWithComponents | null,
  nextSortOrder: number,
): PackageFormState {
  if (bundle) {
    const base = bundleToFormData(bundle);
    return {
      ...base,
      components: base.components.map((c) => ({
        product_id: c.product_id,
        quantity_input: String(c.quantity_per_bundle),
      })),
    };
  }
  return {
    id: null,
    slug: '',
    name: '',
    description: '',
    image_url: null,
    standalone_enabled: false,
    standalone_price_cents: null,
    addon_enabled: false,
    addon_price_cents: null,
    active: true,
    public_visible: false,
    menu_visible: false,
    featured: false,
    sort_order: nextSortOrder,
    components: [],
  };
}

export function PackageForm({
  bundle,
  products,
  categories,
  nextSortOrder,
  onClose,
  onSaved,
}: PackageFormProps) {
  const isEdit = bundle !== null;
  const slugManuallyEdited = useRef(false);
  const bundleIdRef = useRef<string>(bundle?.id || crypto.randomUUID());

  const [formData, setFormData] = useState<PackageFormState>(() =>
    initialFormData(bundle, nextSortOrder),
  );
  const [standalonePriceDisplay, setStandalonePriceDisplay] = useState(() =>
    centsToDollars(bundle?.standalone_price_cents),
  );
  const [addonPriceDisplay, setAddonPriceDisplay] = useState(() =>
    centsToDollars(bundle?.addon_price_cents),
  );

  const [imageAction, setImageAction] = useState<'upload' | 'remove' | 'none'>('none');
  const [newUploadedImage, setNewUploadedImage] = useState<UploadedImage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rpcError, setRpcError] = useState<string | null>(null);

  const imageUploadRef = useRef<AdminImageUploadHandle>(null);
  const prevImageUrl = useRef<string | null>(bundle?.image_url ?? null);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!isEdit && !slugManuallyEdited.current) {
      setFormData((prev) => ({ ...prev, slug: generateSlug(prev.name) }));
    }
  }, [formData.name, isEdit]);

  const handleFieldChange = useCallback(
    <K extends keyof PackageFormState>(field: K, value: PackageFormState[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      if (field === 'slug') slugManuallyEdited.current = true;
    },
    [],
  );

  const handleImageChange = useCallback(
    (image: UploadedImage | null, action: 'upload' | 'remove' | 'none') => {
      setNewUploadedImage(image);
      setImageAction(action);
    },
    [],
  );

  const handleUploadStateChange = useCallback((busy: boolean) => {
    setIsUploading(busy);
  }, []);

  const isBusy = isSaving || isUploading;

  async function cleanupPendingUpload(): Promise<boolean> {
    const img = imageUploadRef.current?.getUploadedImage();
    if (!img) {
      setNewUploadedImage(null);
      setImageAction('none');
      return true;
    }
    const deleted = await imageUploadRef.current?.deleteNewlyUploaded();
    if (deleted) {
      setNewUploadedImage(null);
      setImageAction('none');
      return true;
    }
    const current = imageUploadRef.current?.getUploadedImage();
    if (current) {
      setNewUploadedImage(current);
      setImageAction('upload');
    }
    notifyWarning(
      'Could not delete the pending image. The form will stay open so you can retry.',
    );
    return false;
  }

  async function handleClose(): Promise<void> {
    if (closedRef.current) return;
    if (isBusy) return;
    const cleaned = await cleanupPendingUpload();
    if (!cleaned) return;
    closedRef.current = true;
    onClose();
  }

  // --- Component editor helpers ---

  const addComponent = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      components: [...prev.components, { product_id: '', quantity_input: '1' }],
    }));
  }, []);

  const removeComponent = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== index),
    }));
  }, []);

  const updateComponent = useCallback(
    (index: number, patch: Partial<EditableComponentRow>) => {
      setFormData((prev) => ({
        ...prev,
        components: prev.components.map((c, i) =>
          i === index ? { ...c, ...patch } : c,
        ),
      }));
    },
    [],
  );

  const productNameById = useCallback(
    (productId: string): string => {
      const p = products.find((pr) => pr.id === productId);
      return p?.name ?? 'Unknown Product';
    },
    [products],
  );

  // --- Validation ---

  function validate(): boolean {
    const e: Record<string, string> = {};

    if (!formData.name.trim()) e.name = 'Name is required';
    if (!formData.slug.trim()) e.slug = 'Slug is required';
    else if (!SLUG_REGEX.test(formData.slug))
      e.slug = 'Slug must be lowercase, alphanumeric, hyphen-separated';

    if (!Number.isInteger(formData.sort_order))
      e.sort_order = 'Sort order must be a whole integer';

    const standaloneTrimmed = standalonePriceDisplay.trim();
    const standaloneParsed = parsePrice(standalonePriceDisplay);
    if (formData.standalone_enabled && standaloneTrimmed === '') {
      e.standalone_price = 'Required when standalone is enabled';
    } else if (standaloneTrimmed !== '' && !standaloneParsed.valid) {
      e.standalone_price = priceErrorMessage(standaloneParsed.reason);
    }

    const addonTrimmed = addonPriceDisplay.trim();
    const addonParsed = parsePrice(addonPriceDisplay);
    if (formData.addon_enabled && addonTrimmed === '') {
      e.addon_price = 'Required when add-on is enabled';
    } else if (addonTrimmed !== '' && !addonParsed.valid) {
      e.addon_price = priceErrorMessage(addonParsed.reason);
    }

    // Components validation
    const componentErrors: string[] = [];
    const seenProductIds = new Set<string>();

    for (let i = 0; i < formData.components.length; i++) {
      const comp = formData.components[i];
      if (!comp.product_id) {
        componentErrors.push(`Component ${i + 1}: Select a product.`);
      } else {
        if (seenProductIds.has(comp.product_id)) {
          componentErrors.push(
            `Component ${i + 1}: Duplicate product — ${productNameById(comp.product_id)} is already selected.`,
          );
        }
        seenProductIds.add(comp.product_id);
        const exists = products.some((p) => p.id === comp.product_id);
        if (!exists) {
          componentErrors.push(`Component ${i + 1}: Selected product no longer exists.`);
        }
      }

      const qStr = comp.quantity_input.trim();
      if (qStr === '') {
        componentErrors.push(`Component ${i + 1}: Quantity is required.`);
      } else if (!QTY_REGEX.test(qStr)) {
        componentErrors.push(`Component ${i + 1}: Quantity must be a whole positive number.`);
      } else {
        const q = Number(qStr);
        if (q < 1) {
          componentErrors.push(`Component ${i + 1}: Quantity must be at least 1.`);
        } else if (q > MAX_INT) {
          componentErrors.push(`Component ${i + 1}: Quantity is too large.`);
        }
      }
    }

    // Available + Shown package requires at least one component
    if (formData.active && formData.public_visible && formData.components.length === 0) {
      componentErrors.push(
        'A package that is Available for Use and Shown on Website must have at least one component.',
      );
    }

    if (componentErrors.length > 0) {
      e.components = componentErrors.join(' ');
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
          'The package was saved, but the old image file could not be deleted. Manual cleanup may be needed.',
        );
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to delete old storage file:', path, err);
      notifyWarning(
        'The package was saved, but the old image file could not be deleted. Manual cleanup may be needed.',
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
    if (!standaloneParsed.valid || !addonParsed.valid) return;

    const validatedComponents: PackageComponentFormRow[] = formData.components.map(
      (comp) => ({
        product_id: comp.product_id,
        quantity_per_bundle: Number(comp.quantity_input),
      }),
    );

    const updatedData: PackageAdminFormData = {
      ...formData,
      name: formData.name.trim(),
      standalone_price_cents: standaloneParsed.cents,
      addon_price_cents: addonParsed.cents,
      components: validatedComponents,
    };

    // Sync parent image state with child pending state before save.
    const childPending = imageUploadRef.current?.getUploadedImage() ?? null;
    let effectiveAction = imageAction;
    let effectiveImage = newUploadedImage;
    if (childPending && (!newUploadedImage || newUploadedImage.url !== childPending.url)) {
      effectiveImage = childPending;
      effectiveAction = 'upload';
      setNewUploadedImage(childPending);
      setImageAction('upload');
    }

    let imageUrl = formData.image_url;
    if (effectiveAction === 'remove') {
      imageUrl = null;
    } else if (effectiveAction === 'upload' && effectiveImage) {
      imageUrl = effectiveImage.url;
    }

    const bundleId = bundleIdRef.current;
    const params = buildSaveBundleParams(
      isEdit ? 'update' : 'create',
      bundleId,
      updatedData,
      imageUrl,
    );

    setIsSaving(true);

    try {
      const { error: rpcErrorResult } = await saveProductBundle(params);

      if (rpcErrorResult) {
        const msg = rpcErrorResult.message || 'Failed to save package';
        setRpcError(msg);
        notifyError(msg);

        if (effectiveAction === 'upload') {
          const deleted = await imageUploadRef.current?.deleteNewlyUploaded();
          if (deleted) {
            setNewUploadedImage(null);
            setImageAction('none');
            imageUploadRef.current?.resetToCurrentImage();
          } else {
            const retained = imageUploadRef.current?.getUploadedImage();
            if (retained) {
              setNewUploadedImage(retained);
              setImageAction('upload');
            }
          }
        }
        return;
      }

      if (effectiveAction === 'upload' && effectiveImage) {
        imageUploadRef.current?.commitUploadedImage();
      }

      if (effectiveAction === 'upload' && effectiveImage && prevImageUrl.current) {
        await deleteStorageFile(prevImageUrl.current);
      }
      if (effectiveAction === 'remove' && prevImageUrl.current) {
        await deleteStorageFile(prevImageUrl.current);
      }

      notifySuccess(isEdit ? 'Package updated successfully' : 'Package created successfully');
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save package';
      setRpcError(msg);
      notifyError(msg);

      if (effectiveAction === 'upload') {
        const deleted = await imageUploadRef.current?.deleteNewlyUploaded();
        if (deleted) {
          setNewUploadedImage(null);
          setImageAction('none');
          imageUploadRef.current?.resetToCurrentImage();
        } else {
          const retained = imageUploadRef.current?.getUploadedImage();
          if (retained) {
            setNewUploadedImage(retained);
            setImageAction('upload');
          }
        }
      }
    } finally {
      setIsSaving(false);
    }
  }

  // Build product option list with category names and status labels
  const categoryMap = new Map<string, string>();
  for (const cat of categories) categoryMap.set(cat.id, cat.name);

  const selectedProductIds = new Set(
    formData.components.map((c) => c.product_id).filter(Boolean),
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <h3 className="text-xl font-bold text-slate-900">
            {isEdit ? 'Edit Package' : 'Add Package'}
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
              Package Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
              placeholder="e.g. Celebration Seating"
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

          <AdminImageUpload
            ref={imageUploadRef}
            folder="bundles"
            ownerId={bundleIdRef.current}
            currentImageUrl={formData.image_url}
            onImageChange={handleImageChange}
            onUploadStateChange={handleUploadStateChange}
            label="Package Image"
          />

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Sort Order</label>
            <input
              type="number"
              step={1}
              value={formData.sort_order}
              onChange={(e) => handleFieldChange('sort_order', Math.floor(Number(e.target.value)))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm sm:w-40"
            />
            {errors.sort_order && <p className="mt-1 text-xs text-red-600">{errors.sort_order}</p>}
          </div>

          {/* Standalone Pricing */}
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
                  Standalone Package Price ($)
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

          {/* Add-on Pricing */}
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
                  Add-on Package Price ($)
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

          {/* Visibility + Flags */}
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) => handleFieldChange('active', e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm text-slate-700 font-medium">Available for Use</span>
                  <p className="text-xs text-slate-500">
                    Allows this item to be used in Event Essentials inventory and packages.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={formData.public_visible}
                  onChange={(e) => handleFieldChange('public_visible', e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm text-slate-700 font-medium">Shown on Website</span>
                  <p className="text-xs text-slate-500">
                    Displays this item to customers when it is also available for use and properly categorized.
                  </p>
                </div>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={formData.menu_visible}
                  onChange={(e) => handleFieldChange('menu_visible', e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm text-slate-700 font-medium">Shown on Menu</span>
                  <p className="text-xs text-slate-500">
                    Includes this package in customer-facing package and menu displays that use the menu visibility setting.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={formData.featured}
                  onChange={(e) => handleFieldChange('featured', e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm text-slate-700 font-medium">Featured Package</span>
                  <p className="text-xs text-slate-500">
                    Highlights this package in customer-facing featured package sections.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Component Editor */}
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-700">Package Components</h4>
              <button
                type="button"
                onClick={addComponent}
                disabled={isBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Component
              </button>
            </div>

            {errors.components && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                <AlertCircle className="w-4 h-4 inline mr-1 flex-shrink-0" />
                {errors.components}
              </div>
            )}

            {formData.components.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center bg-slate-50 rounded-lg">
                No components yet. Click "Add Component" to add products to this package.
              </p>
            ) : (
              <div className="space-y-2">
                {formData.components.map((comp, index) => {
                  const isSelectedElsewhere =
                    comp.product_id &&
                    formData.components.some(
                      (c, i) => i !== index && c.product_id === comp.product_id,
                    );
                  return (
                    <div
                      key={index}
                      className="flex flex-col sm:flex-row gap-2 sm:items-center p-2 bg-slate-50 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <select
                          value={comp.product_id}
                          onChange={(e) =>
                            updateComponent(index, { product_id: e.target.value })
                          }
                          className="w-full px-2.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm bg-white"
                        >
                          <option value="">— Select a product —</option>
                          {products.map((p) => {
                            const catName = p.category_id
                              ? categoryMap.get(p.category_id) ?? null
                              : null;
                            const statusParts: string[] = [];
                            if (!p.active) statusParts.push('Unavailable');
                            if (!p.public_visible) statusParts.push('Website: Hidden');
                            const statusLabel =
                              statusParts.length > 0 ? ` (${statusParts.join(', ')})` : '';
                            const label = `${p.name}${catName ? ` — ${catName}` : ''}${statusLabel}`;
                            return (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={
                                  selectedProductIds.has(p.id) && p.id !== comp.product_id
                                }
                              >
                                {label}
                              </option>
                            );
                          })}
                        </select>
                        {isSelectedElsewhere && (
                          <p className="mt-1 text-xs text-red-600">
                            This product is selected in another component.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 sm:flex-shrink-0">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={comp.quantity_input}
                          onChange={(e) =>
                            updateComponent(index, { quantity_input: e.target.value })
                          }
                          className="w-20 px-2.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm text-center"
                          placeholder="Qty"
                        />
                        <span className="text-xs text-slate-500 hidden sm:inline">
                          per package
                        </span>
                        <button
                          type="button"
                          onClick={() => removeComponent(index)}
                          disabled={isBusy}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Remove component"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Each package must contain at least one component to be shown on the website.
              Duplicate products are not allowed.
            </p>
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
              {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Package'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
