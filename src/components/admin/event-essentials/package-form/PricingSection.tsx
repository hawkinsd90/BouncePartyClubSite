// Standalone and add-on pricing fields for the Event Essentials package form.
// Presentational: all state and handlers are owned by PackageForm.

import type { PackageFormState } from './packageFormModel';

type FieldChangeHandler = <K extends keyof PackageFormState>(
  field: K,
  value: PackageFormState[K],
) => void;

interface PricingSectionProps {
  formData: Pick<PackageFormState, 'standalone_enabled' | 'addon_enabled'>;
  errors: Record<string, string>;
  standalonePriceDisplay: string;
  setStandalonePriceDisplay: (value: string) => void;
  addonPriceDisplay: string;
  setAddonPriceDisplay: (value: string) => void;
  addonThresholdDisplay: string;
  setAddonThresholdDisplay: (value: string) => void;
  handleFieldChange: FieldChangeHandler;
}

export function PricingSection({
  formData,
  errors,
  standalonePriceDisplay,
  setStandalonePriceDisplay,
  addonPriceDisplay,
  setAddonPriceDisplay,
  addonThresholdDisplay,
  setAddonThresholdDisplay,
  handleFieldChange,
}: PricingSectionProps) {
  return (
    <>
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
    </>
  );
}
