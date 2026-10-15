// Event Essential component rows for the package form (product select, quantity,
// remove). Presentational: rows and handlers are owned by PackageForm. Rows keep
// key={index}, as before.

import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import type { InventoryProductWithPricing } from '../../../../../types';
import type { EditableComponentRow, PackageFormState } from './packageFormModel';

interface ProductComponentsEditorProps {
  formData: Pick<PackageFormState, 'components'>;
  errors: Record<string, string>;
  products: InventoryProductWithPricing[];
  categoryMap: Map<string, string>;
  selectedProductIds: Set<string>;
  isBusy: boolean;
  addComponent: () => void;
  updateComponent: (index: number, patch: Partial<EditableComponentRow>) => void;
  removeComponent: (index: number) => void;
}

export function ProductComponentsEditor({
  formData,
  errors,
  products,
  categoryMap,
  selectedProductIds,
  isBusy,
  addComponent,
  updateComponent,
  removeComponent,
}: ProductComponentsEditorProps) {
  return (
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
  );
}
