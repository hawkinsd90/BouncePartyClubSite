// Inflatable component rows for the package form (unit select, quantity, mode,
// remove). Presentational: rows and handlers are owned by PackageForm. Rows keep
// key={index}, as before.

import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import type { AdminInflatableUnit, PackageInflatableSelectionMode } from '../../../../types';
import {
  unitSupportsWater,
  unitSupportsBoth,
  unitStatus,
  type EditableInflatableRow,
  type PackageFormState,
} from './packageFormModel';

interface InflatableComponentsEditorProps {
  formData: Pick<PackageFormState, 'inflatable_components'>;
  errors: Record<string, string>;
  units: AdminInflatableUnit[];
  selectedUnitIds: Set<string>;
  isBusy: boolean;
  addInflatableComponent: () => void;
  updateInflatableComponent: (index: number, patch: Partial<EditableInflatableRow>) => void;
  removeInflatableComponent: (index: number) => void;
}

export function InflatableComponentsEditor({
  formData,
  errors,
  units,
  selectedUnitIds,
  isBusy,
  addInflatableComponent,
  updateInflatableComponent,
  removeInflatableComponent,
}: InflatableComponentsEditorProps) {
  return (
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
  );
}
