import { useState, useRef, useCallback } from 'react';
import { X, Save, AlertCircle, Plus, Trash2 } from 'lucide-react';
import {
  saveProductBundleV2,
  buildSaveProductBundleV2Params,
  parsePrice,
  priceErrorMessage,
  centsToDollars,
  parseStoragePath,
  bundleToFormData,
  generateSlugFromName,
} from '../../../lib/queries/products';
import {
  notifySuccess,
  notifyError,
  notifyWarning,
} from '../../../lib/notifications';
import { supabase } from '../../../lib/supabase';
import type {
  ProductBundleWithConfiguration,
  InventoryProductWithPricing,
  ProductCategory,
  PackageAdminFormData,
  PackageComponentFormRow,
  PackageInflatableComponentFormRow,
  InflatableEligibilityMode,
  PackageInflatableSelectionMode,
  AdminInflatableUnit,
} from '../../../types';
import {
  AdminImageUpload,
  type AdminImageUploadHandle,
  type UploadedImage,
} from './AdminImageUpload';

const MAX_INT = 2147483647;
const QTY_REGEX = /^[0-9]+$/;

interface EditableComponentRow {
  product_id: string;
  quantity_input: string;
}

interface EditableInflatableRow {
  unit_id: string;
  quantity_input: string;
  selection_mode: PackageInflatableSelectionMode;
}

type PackageFormState = Omit<PackageAdminFormData, 'components' | 'inflatable_components'> & {
  components: EditableComponentRow[];
  inflatable_components: EditableInflatableRow[];
};

interface PackageFormProps {
  bundle: ProductBundleWithConfiguration | null;
  products: InventoryProductWithPricing[];
  categories: ProductCategory[];
  units: AdminInflatableUnit[];
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}

function deriveAvailable(bundle: ProductBundleWithConfiguration | null): boolean {
  if (!bundle) return true;
  return bundle.active && bundle.public_visible;
}

function initialFormData(
  bundle: ProductBundleWithConfiguration | null,
  nextSortOrder: number,
): PackageFormState {
  const available = deriveAvailable(bundle);
  if (bundle) {
    const base = bundleToFormData(bundle);
    return {
      ...base,
      active: available,
      public_visible: available,
      menu_visible: available,
      components: base.components.map((c) => ({
        product_id: c.product_id,
        quantity_input: String(c.quantity_per_bundle),
      })),
      inflatable_components: base.inflatable_components.map((c) => ({
        unit_id: c.unit_id,
        quantity_input: String(c.quantity_per_bundle),
        selection_mode: c.selection_mode,
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
    active: available,
    public_visible: available,
    menu_visible: available,
    featured: false,
    sort_order: nextSortOrder,
    components: [],
    addon_qualifying_threshold_cents: null,
    inflatable_eligibility_mode: 'none',
    excluded_category_ids: [],
    eligible_unit_ids: [],
    inflatable_components: [],
  };
}

function unitSupportsWater(unit: AdminInflatableUnit): boolean {
  return unit.price_water_cents !== null && unit.price_water_cents !== undefined;
}

function unitSupportsBoth(unit: AdminInflatableUnit): boolean {
  return unitSupportsWater(unit) && unit.price_dry_cents !== null;
}

function unitStatus(unit: AdminInflatableUnit): string {
  return unit.active ? '' : ' (Inactive)';
}

export function PackageForm({
  bundle,
  products,
  categories,
  units,
  nextSortOrder,
  onClose,
  onSaved,
}: PackageFormProps) {
  const isEdit = bundle !== null;
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
  const [addonThresholdDisplay, setAddonThresholdDisplay] = useState(() =>
    centsToDollars(bundle?.addon_qualifying_threshold_cents),
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

  const handleFieldChange = useCallback(
    <K extends keyof PackageFormState>(field: K, value: PackageFormState[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleAvailabilityChange = useCallback((checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      active: checked,
      public_visible: checked,
      menu_visible: checked,
    }));
  }, []);

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

  // --- Event Essential component editor helpers ---

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

  // --- Inflatable component editor helpers ---

  const addInflatableComponent = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      inflatable_components: [
        ...prev.inflatable_components,
        { unit_id: '', quantity_input: '1', selection_mode: 'dry' },
      ],
    }));
  }, []);

  const removeInflatableComponent = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      inflatable_components: prev.inflatable_components.filter((_, i) => i !== index),
    }));
  }, []);

  const updateInflatableComponent = useCallback(
    (index: number, patch: Partial<EditableInflatableRow>) => {
      setFormData((prev) => ({
        ...prev,
        inflatable_components: prev.inflatable_components.map((c, i) =>
          i === index ? { ...c, ...patch } : c,
        ),
      }));
    },
    [],
  );

  // --- Eligibility helpers ---

  const handleEligibilityModeChange = useCallback((mode: InflatableEligibilityMode) => {
    setFormData((prev) => ({
      ...prev,
      inflatable_eligibility_mode: mode,
      // Clear eligible units for none/any — v2 RPC atomic-replaces rows,
      // so the submitted payload must reflect the current mode.
      eligible_unit_ids: mode === 'selected' ? prev.eligible_unit_ids : [],
    }));
  }, []);

  const toggleEligibleUnit = useCallback((unitId: string) => {
    setFormData((prev) => {
      const has = prev.eligible_unit_ids.includes(unitId);
      return {
        ...prev,
        eligible_unit_ids: has
          ? prev.eligible_unit_ids.filter((id) => id !== unitId)
          : [...prev.eligible_unit_ids, unitId],
      };
    });
  }, []);

  // --- Excluded categories helpers ---

  const toggleExcludedCategory = useCallback((categoryId: string) => {
    setFormData((prev) => {
      const has = prev.excluded_category_ids.includes(categoryId);
      return {
        ...prev,
        excluded_category_ids: has
          ? prev.excluded_category_ids.filter((id) => id !== categoryId)
          : [...prev.excluded_category_ids, categoryId],
      };
    });
  }, []);

  // --- Validation ---

  function validate(): boolean {
    const e: Record<string, string> = {};

    if (!formData.name.trim()) e.name = 'Name is required';

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

    // Add-on qualifying threshold
    const thresholdTrimmed = addonThresholdDisplay.trim();
    const thresholdParsed = parsePrice(addonThresholdDisplay);
    if (formData.addon_enabled && thresholdTrimmed === '') {
      e.addon_threshold = 'Required when add-on is enabled';
    } else if (thresholdTrimmed !== '' && !thresholdParsed.valid) {
      e.addon_threshold = priceErrorMessage(thresholdParsed.reason);
    } else if (
      thresholdParsed.valid &&
      thresholdParsed.cents !== null &&
      thresholdParsed.cents > MAX_INT
    ) {
      e.addon_threshold = 'Value is too large';
    }

    // Event Essential components validation
    const componentErrors: string[] = [];
    const seenProductIds = new Set<string>();
    const productNameById = (productId: string): string => {
      const p = products.find((pr) => pr.id === productId);
      return p?.name ?? 'Unknown Product';
    };

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

    // Inflatable components validation
    const inflatableErrors: string[] = [];
    const seenUnitIds = new Set<string>();
    const unitById = (unitId: string): AdminInflatableUnit | undefined =>
      units.find((u) => u.id === unitId);

    for (let i = 0; i < formData.inflatable_components.length; i++) {
      const comp = formData.inflatable_components[i];
      if (!comp.unit_id) {
        inflatableErrors.push(`Inflatable ${i + 1}: Select a unit.`);
      } else {
        if (seenUnitIds.has(comp.unit_id)) {
          const u = unitById(comp.unit_id);
          inflatableErrors.push(
            `Inflatable ${i + 1}: Duplicate unit — ${u?.name ?? 'Unknown'} is already selected. Use one row per unit.`,
          );
        }
        seenUnitIds.add(comp.unit_id);
        const u = unitById(comp.unit_id);
        if (!u) {
          inflatableErrors.push(`Inflatable ${i + 1}: Selected unit no longer exists.`);
        } else if (comp.selection_mode === 'water' && !unitSupportsWater(u)) {
          inflatableErrors.push(
            `Inflatable ${i + 1}: ${u.name} does not support water mode.`,
          );
        } else if (comp.selection_mode === 'customer_choice' && !unitSupportsBoth(u)) {
          inflatableErrors.push(
            `Inflatable ${i + 1}: ${u.name} does not support both dry and water; customer choice is unavailable.`,
          );
        }
      }

      const qStr = comp.quantity_input.trim();
      if (qStr === '') {
        inflatableErrors.push(`Inflatable ${i + 1}: Quantity is required.`);
      } else if (!QTY_REGEX.test(qStr)) {
        inflatableErrors.push(`Inflatable ${i + 1}: Quantity must be a whole positive number.`);
      } else {
        const q = Number(qStr);
        if (q < 1) {
          inflatableErrors.push(`Inflatable ${i + 1}: Quantity must be at least 1.`);
        } else if (q > MAX_INT) {
          inflatableErrors.push(`Inflatable ${i + 1}: Quantity is too large.`);
        }
      }
    }

    // Eligibility validation — selected requires at least one unit
    if (
      formData.inflatable_eligibility_mode === 'selected' &&
      formData.eligible_unit_ids.length === 0
    ) {
      e.eligibility = 'Select at least one eligible inflatable when mode is "Only selected".';
    }

    // Available package must have at least one total component (product + inflatable)
    const totalComponents = formData.components.length + formData.inflatable_components.length;
    if (formData.active && totalComponents === 0) {
      const bothEmpty = componentErrors.length === 0 && inflatableErrors.length === 0;
      if (bothEmpty) {
        e.components = 'An available package must have at least one component (Event Essential or Inflatable).';
      }
    }

    if (componentErrors.length > 0) {
      e.components = componentErrors.join(' ');
    }
    if (inflatableErrors.length > 0) {
      e.inflatable_components = inflatableErrors.join(' ');
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
    const thresholdParsed = parsePrice(addonThresholdDisplay);
    if (!standaloneParsed.valid || !addonParsed.valid || !thresholdParsed.valid) return;

    const validatedComponents: PackageComponentFormRow[] = formData.components.map(
      (comp) => ({
        product_id: comp.product_id,
        quantity_per_bundle: Number(comp.quantity_input),
      }),
    );

    const validatedInflatableComponents: PackageInflatableComponentFormRow[] =
      formData.inflatable_components.map((comp) => ({
        unit_id: comp.unit_id,
        quantity_per_bundle: Number(comp.quantity_input),
        selection_mode: comp.selection_mode,
      }));

    const slug = isEdit
      ? bundle?.slug ?? formData.slug
      : generateSlugFromName(formData.name.trim());

    // Threshold: NULL when add-on disabled or field blank; else parsed cents
    const thresholdCents =
      formData.addon_enabled && thresholdParsed.cents !== null
        ? thresholdParsed.cents
        : null;

    // Eligible units: empty array for none/any
    const eligibleUnitIds =
      formData.inflatable_eligibility_mode === 'selected'
        ? formData.eligible_unit_ids
        : [];

    const updatedData: PackageAdminFormData = {
      ...formData,
      slug,
      name: formData.name.trim(),
      standalone_price_cents: standaloneParsed.cents,
      addon_price_cents: addonParsed.cents,
      components: validatedComponents,
      addon_qualifying_threshold_cents: thresholdCents,
      eligible_unit_ids: eligibleUnitIds,
      inflatable_components: validatedInflatableComponents,
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
    const params = buildSaveProductBundleV2Params(
      isEdit ? 'update' : 'create',
      bundleId,
      updatedData,
      imageUrl,
    );

    setIsSaving(true);

    try {
      const { error: rpcErrorResult } = await saveProductBundleV2(params);

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

  const selectedUnitIds = new Set(
    formData.inflatable_components.map((c) => c.unit_id).filter(Boolean),
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
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Add-on Qualifying Subtotal ($)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={addonThresholdDisplay}
                  onChange={(e) => setAddonThresholdDisplay(e.target.value)}
                  disabled={!formData.addon_enabled}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                  placeholder="0.00"
                />
                <p className="mt-1 text-xs text-slate-500">
                  The add-on package price becomes available after the customer reaches this qualifying subtotal using eligible cart items.
                </p>
                {errors.addon_threshold && (
                  <p className="mt-1 text-xs text-red-600">{errors.addon_threshold}</p>
                )}
              </div>
            </div>
          </div>

          {/* Categories Excluded From Qualifying Subtotal */}
          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-sm font-bold text-slate-700 mb-1">
              Categories Excluded From Qualifying Subtotal
            </h4>
            <p className="text-xs text-slate-500 mb-3">
              Spending in these categories will not count toward unlocking this package's add-on price.
            </p>
            <div
              className={`grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-lg border border-slate-200 ${
                !formData.addon_enabled ? 'bg-slate-50 opacity-60' : 'bg-white'
              }`}
            >
              {categories.length === 0 ? (
                <p className="text-xs text-slate-500 col-span-2">No categories available.</p>
              ) : (
                categories.map((cat) => {
                  const checked = formData.excluded_category_ids.includes(cat.id);
                  const statusParts: string[] = [];
                  if (!cat.active) statusParts.push('Inactive');
                  if (!cat.public_visible) statusParts.push('Hidden');
                  const statusLabel =
                    statusParts.length > 0 ? ` (${statusParts.join(', ')})` : '';
                  return (
                    <label
                      key={cat.id}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExcludedCategory(cat.id)}
                        disabled={!formData.addon_enabled}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                      />
                      <span>
                        {cat.name}
                        {statusLabel && (
                          <span className="text-amber-600 text-xs">{statusLabel}</span>
                        )}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {formData.excluded_category_ids.length} categor
              {formData.excluded_category_ids.length === 1 ? 'y' : 'ies'} excluded.
              Selections are preserved even when add-on pricing is disabled.
            </p>
          </div>

          {/* Inflatable Requirement */}
          <div className="border-t border-slate-200 pt-4">
            <h4 className="text-sm font-bold text-slate-700 mb-1">Inflatable Requirement</h4>
            <p className="text-xs text-slate-500 mb-3">
              This controls whether the customer must already have an inflatable in their cart before
              selecting this package. It does not add an inflatable to the package.
            </p>
            <div className="flex flex-col gap-2">
              {(
                [
                  { value: 'none', label: 'No inflatable required' },
                  { value: 'any', label: 'Any inflatable required' },
                  { value: 'selected', label: 'Only selected inflatables qualify' },
                ] as { value: InflatableEligibilityMode; label: string }[]
              ).map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="inflatable_eligibility_mode"
                    checked={formData.inflatable_eligibility_mode === opt.value}
                    onChange={() => handleEligibilityModeChange(opt.value)}
                    className="w-4 h-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {errors.eligibility && (
              <p className="mt-1 text-xs text-red-600">{errors.eligibility}</p>
            )}

            {formData.inflatable_eligibility_mode === 'selected' && (
              <div className="mt-3 p-3 border border-slate-200 rounded-lg bg-slate-50">
                <h5 className="text-sm font-semibold text-slate-700 mb-2">Eligible Inflatables</h5>
                {units.length === 0 ? (
                  <p className="text-xs text-slate-500">No inflatable units available.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {units.map((u) => {
                      const checked = formData.eligible_unit_ids.includes(u.id);
                      const water = unitSupportsWater(u);
                      const supports = [`Dry${water ? ' / Water' : ''}`].join(', ');
                      return (
                        <label
                          key={u.id}
                          className="flex items-center gap-2 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEligibleUnit(u.id)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>
                            {u.name}
                            {!u.active && (
                              <span className="text-amber-600 text-xs"> (Inactive)</span>
                            )}
                            <span className="text-xs text-slate-400"> — {supports}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Availability */}
          <div className="border-t border-slate-200 pt-4">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => handleAvailabilityChange(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-slate-700 font-medium">Available</span>
                <p className="text-xs text-slate-500">
                  Available packages are shown to customers. Unavailable packages remain in Admin but are hidden from the Event Essentials page.
                </p>
              </div>
            </label>
          </div>

          {/* Event Essential Components */}
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-700">Event Essential Components</h4>
              <button
                type="button"
                onClick={addComponent}
                disabled={isBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Product
              </button>
            </div>

            {formData.components.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center bg-slate-50 rounded-lg">
                No Event Essential components yet.
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
            {errors.components && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                <AlertCircle className="w-4 h-4 inline mr-1 flex-shrink-0" />
                {errors.components}
              </div>
            )}
          </div>

          {/* Inflatable Components */}
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-bold text-slate-700">Inflatable Components</h4>
              <button
                type="button"
                onClick={addInflatableComponent}
                disabled={isBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Inflatable
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Inflatables added here are included inside the package. They are different from the inflatable requirement above.
            </p>

            {formData.inflatable_components.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center bg-slate-50 rounded-lg">
                No inflatable components yet.
              </p>
            ) : (
              <div className="space-y-2">
                {formData.inflatable_components.map((comp, index) => {
                  const selectedUnit = comp.unit_id
                    ? units.find((u) => u.id === comp.unit_id)
                    : null;
                  const isSelectedElsewhere =
                    comp.unit_id &&
                    formData.inflatable_components.some(
                      (c, i) => i !== index && c.unit_id === comp.unit_id,
                    );
                  const water = selectedUnit ? unitSupportsWater(selectedUnit) : false;
                  const both = selectedUnit ? unitSupportsBoth(selectedUnit) : false;
                  return (
                    <div
                      key={index}
                      className="flex flex-col gap-2 p-2 bg-slate-50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <select
                            value={comp.unit_id}
                            onChange={(e) =>
                              updateInflatableComponent(index, {
                                unit_id: e.target.value,
                                // Reset to dry if current mode incompatible with new unit
                                selection_mode:
                                  e.target.value
                                    ? (() => {
                                        const u = units.find((x) => x.id === e.target.value);
                                        if (!u) return 'dry' as const;
                                        if (comp.selection_mode === 'water' && !unitSupportsWater(u))
                                          return 'dry' as const;
                                        if (
                                          comp.selection_mode === 'customer_choice' &&
                                          !unitSupportsBoth(u)
                                        )
                                          return 'dry' as const;
                                        return comp.selection_mode;
                                      })()
                                    : 'dry' as const,
                              })
                            }
                            className="w-full px-2.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm bg-white"
                          >
                            <option value="">— Select an inflatable —</option>
                            {units.map((u) => {
                              const statusLabel = unitStatus(u);
                              return (
                                <option
                                  key={u.id}
                                  value={u.id}
                                  disabled={
                                    selectedUnitIds.has(u.id) && u.id !== comp.unit_id
                                  }
                                >
                                  {u.name}
                                  {statusLabel}
                                </option>
                              );
                            })}
                          </select>
                          {isSelectedElsewhere && (
                            <p className="mt-1 text-xs text-red-600">
                              This inflatable is selected in another component.
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeInflatableComponent(index)}
                          disabled={isBusy}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Remove inflatable component"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={comp.quantity_input}
                          onChange={(e) =>
                            updateInflatableComponent(index, { quantity_input: e.target.value })
                          }
                          className="w-20 px-2.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm text-center"
                          placeholder="Qty"
                        />
                        <span className="text-xs text-slate-500">per package</span>
                        <select
                          value={comp.selection_mode}
                          onChange={(e) =>
                            updateInflatableComponent(index, {
                              selection_mode: e.target.value as PackageInflatableSelectionMode,
                            })
                          }
                          className="flex-1 px-2.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm bg-white"
                        >
                          <option value="dry">Dry only</option>
                          <option value="water" disabled={!water}>
                            Water only{!water ? ' (not supported)' : ''}
                          </option>
                          <option value="customer_choice" disabled={!both}>
                            Customer chooses{!both ? ' (requires dry + water)' : ''}
                          </option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {errors.inflatable_components && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                <AlertCircle className="w-4 h-4 inline mr-1 flex-shrink-0" />
                {errors.inflatable_components}
              </div>
            )}
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
