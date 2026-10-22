import { LayoutGrid } from 'lucide-react';
import type { ProductCategory } from '../../types';

interface Props {
  visibleCategories: ProductCategory[];
  selectedCategoryKeys: string[];
  onToggle: (category: ProductCategory | null) => void;
}

// Display only. EventEssentialsCatalog owns the selection, toggleCategory and the URL sync.
// The parent decides when to render this (visibleCategories.length > 0 || nothing selected).
export function CatalogCategoryTabs({ visibleCategories, selectedCategoryKeys, onToggle }: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <div className="flex flex-wrap gap-2">
        <button
          key="all"
          type="button"
          onClick={() => onToggle(null)}
          className={`flex items-center gap-1.5 px-4 min-h-[44px] py-2 rounded-full text-sm font-semibold transition-colors ${
            selectedCategoryKeys.length === 0
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          All
        </button>
        {visibleCategories.map((category) => {
          const isSelected = selectedCategoryKeys.includes(category.id);
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onToggle(category)}
              className={`px-4 min-h-[44px] py-2 rounded-full text-sm font-semibold transition-colors ${
                isSelected
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {category.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
