import { useState, useRef, useCallback } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import {
  saveProductBundleV2,
  buildSaveProductBundleV2Params,
  parsePrice,
  centsToDollars,
  bundleToFormData,
  generateSlugFromName,
} from '../../../lib/queries/products';
import {
  notifySuccess,
  notifyError,
} from '../../../lib/toasts';
import type {
  ProductBundleWithConfiguration,
  InventoryProductWithPricing,
  ProductCategory,
  PackageAdminFormData,
  PackageComponentFormRow,
  PackageInflatableComponentFormRow,
  InflatableEligibilityMode,
  AdminInflatableUnit,
} from '../../../types';
import { AdminImageUpload } from './AdminImageUpload';
import { useEventEssentialsImageLifecycle } from './useEventEssentialsImageLifecycle';
import {
  deriveAvailable,
  type EditableComponentRow,
  type EditableInflatableRow,
  type PackageFormState,
} from './package-form/packageFormModel';
import { validatePackageForm } from './package-form/packageFormValidation';
import { PackagePricingFields } from './package-form/PackagePricingFields';
import { ExcludedCategoriesSection } from './package-form/ExcludedCategoriesSection';
import { InflatableRequirementSection } from './package-form/InflatableRequirementSection';
import { ProductComponentsEditor } from './package-form/ProductComponentsEditor';
import { InflatableComponentsEditor } from './package-form/InflatableComponentsEditor';

interface PackageFormProps {
  bundle: ProductBundleWithConfiguration | null;
  products: InventoryProductWithPricing[];
  categories: ProductCategory[];
  units: AdminInflatableUnit[];
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
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

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rpcError, setRpcError] = useState<string | null>(null);

  const {
    imageUploadRef,
    isSaving,
    isBusy,
    handleImageChange,
    handleUploadStateChange,
    handleClose,
    prepareImageForSave,
    saveWithImage,
  } = useEventEssentialsImageLifecycle({
    entityLabel: 'package',
    initialImageUrl: bundle?.image_url ?? null,
    onClose,
  });

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
    const e = validatePackageForm({
      formData,
      standalonePriceDisplay,
      addonPriceDisplay,
      addonThresholdDisplay,
      products,
      units,
    });
    setErrors(e);
    return Object.keys(e).length === 0;
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

    // Sync parent image state with child pending state before save, then resolve the image URL to save.
    const prepared = prepareImageForSave(formData.image_url);
    const imageUrl = prepared.imageUrl;

    const bundleId = bundleIdRef.current;
    const params = buildSaveProductBundleV2Params(
      isEdit ? 'update' : 'create',
      bundleId,
      updatedData,
      imageUrl,
    );

    await saveWithImage({
      prepared,
      fallbackMessage: 'Failed to save package',
      saveEntity: () => saveProductBundleV2(params),
      onFailure: (msg) => {
        setRpcError(msg);
        notifyError(msg);
      },
      onSuccess: () => {
        notifySuccess(isEdit ? 'Package updated successfully' : 'Package created successfully');
        onSaved();
      },
    });
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
            <p className="text-xs text-slate-500 mb-1">Lower numbers appear first in the customer catalog.</p>
            <input
              type="number"
              step={1}
              value={formData.sort_order}
              onChange={(e) => handleFieldChange('sort_order', Math.floor(Number(e.target.value)))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm sm:w-40"
            />
            {errors.sort_order && <p className="mt-1 text-xs text-red-600">{errors.sort_order}</p>}
          </div>

          <PackagePricingFields
            formData={formData}
            errors={errors}
            standalonePriceDisplay={standalonePriceDisplay}
            setStandalonePriceDisplay={setStandalonePriceDisplay}
            addonPriceDisplay={addonPriceDisplay}
            setAddonPriceDisplay={setAddonPriceDisplay}
            addonThresholdDisplay={addonThresholdDisplay}
            setAddonThresholdDisplay={setAddonThresholdDisplay}
            handleFieldChange={handleFieldChange}
          />

          {/* Categories Excluded From Qualifying Subtotal */}
          <ExcludedCategoriesSection
            formData={formData}
            categories={categories}
            toggleExcludedCategory={toggleExcludedCategory}
          />

          {/* Inflatable Requirement */}
          <InflatableRequirementSection
            formData={formData}
            errors={errors}
            units={units}
            handleEligibilityModeChange={handleEligibilityModeChange}
            toggleEligibleUnit={toggleEligibleUnit}
          />

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
                  Available packages are shown to customers. Unavailable packages remain in Admin but are hidden from the Event Essentials page. Lower sort order numbers appear first.
                </p>
              </div>
            </label>
          </div>

          {/* Event Essential Components */}
          <ProductComponentsEditor
            formData={formData}
            errors={errors}
            products={products}
            categoryMap={categoryMap}
            selectedProductIds={selectedProductIds}
            isBusy={isBusy}
            addComponent={addComponent}
            updateComponent={updateComponent}
            removeComponent={removeComponent}
          />

          {/* Inflatable Components */}
          <InflatableComponentsEditor
            formData={formData}
            errors={errors}
            units={units}
            selectedUnitIds={selectedUnitIds}
            isBusy={isBusy}
            addInflatableComponent={addInflatableComponent}
            updateInflatableComponent={updateInflatableComponent}
            removeInflatableComponent={removeInflatableComponent}
          />

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
