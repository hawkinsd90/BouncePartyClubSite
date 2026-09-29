// Inflatable requirement radios and the eligible-inflatables checklist for the
// package form. Presentational: mode, selection and handlers are owned by PackageForm.

import type { AdminInflatableUnit, InflatableEligibilityMode } from '../../../../types';
import { unitSupportsWater, type PackageFormState } from './packageFormModel';

interface InflatableRequirementSectionProps {
  formData: Pick<PackageFormState, 'inflatable_eligibility_mode' | 'eligible_unit_ids'>;
  errors: Record<string, string>;
  units: AdminInflatableUnit[];
  handleEligibilityModeChange: (mode: InflatableEligibilityMode) => void;
  toggleEligibleUnit: (unitId: string) => void;
}

export function InflatableRequirementSection({
  formData,
  errors,
  units,
  handleEligibilityModeChange,
  toggleEligibleUnit,
}: InflatableRequirementSectionProps) {
  return (
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
  );
}
