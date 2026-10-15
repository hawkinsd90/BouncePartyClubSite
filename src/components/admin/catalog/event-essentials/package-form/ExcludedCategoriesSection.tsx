// Checklist of product categories excluded from a package's qualifying subtotal.
// Presentational: selection state and the toggle handler are owned by PackageForm.

import type { ProductCategory } from '../../../../../types';
import type { PackageFormState } from './packageFormModel';

interface ExcludedCategoriesSectionProps {
  formData: Pick<PackageFormState, 'addon_enabled' | 'excluded_category_ids'>;
  categories: ProductCategory[];
  toggleExcludedCategory: (categoryId: string) => void;
}

export function ExcludedCategoriesSection({
  formData,
  categories,
  toggleExcludedCategory,
}: ExcludedCategoriesSectionProps) {
  return (
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
  );
}
