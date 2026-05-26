import { Search, Dessert as SortDesc, Import as SortAsc } from 'lucide-react';
import type { PhotoSource } from '../../../hooks/useAdminPhotos';

export type SortOrder = 'newest' | 'oldest';

interface FilterChip {
  key: PhotoSource | 'all';
  label: string;
  activeClass: string;
}

const FILTER_CHIPS: FilterChip[] = [
  { key: 'all', label: 'All', activeClass: 'bg-slate-800 text-white' },
  { key: 'lot', label: 'Lot', activeClass: 'bg-amber-600 text-white' },
  { key: 'order', label: 'Order', activeClass: 'bg-blue-600 text-white' },
  { key: 'delivery', label: 'Delivery', activeClass: 'bg-green-600 text-white' },
  { key: 'damage', label: 'Damage', activeClass: 'bg-red-600 text-white' },
  { key: 'unit', label: 'Unit', activeClass: 'bg-sky-600 text-white' },
  { key: 'carousel', label: 'Carousel', activeClass: 'bg-rose-600 text-white' },
];

interface PhotoFilterBarProps {
  activeFilter: PhotoSource | 'all';
  onFilterChange: (filter: PhotoSource | 'all') => void;
  sortOrder: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function PhotoFilterBar({
  activeFilter,
  onFilterChange,
  sortOrder,
  onSortChange,
  searchQuery,
  onSearchChange,
}: PhotoFilterBarProps) {
  return (
    <div className="space-y-3 mb-5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="search"
          placeholder="Search by order, customer, address, or unit..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
        />
      </div>

      {/* Filter chips + sort toggle row */}
      <div className="flex items-center gap-3">
        {/* Horizontal scroll chips */}
        <div className="flex-1 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 pb-1">
            {FILTER_CHIPS.map(({ key, label, activeClass }) => {
              const isActive = activeFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => onFilterChange(key)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                    isActive
                      ? activeClass
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sort toggle */}
        <button
          onClick={() => onSortChange(sortOrder === 'newest' ? 'oldest' : 'newest')}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
          title={sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
        >
          {sortOrder === 'newest' ? (
            <SortDesc className="w-4 h-4" />
          ) : (
            <SortAsc className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">{sortOrder === 'newest' ? 'Newest' : 'Oldest'}</span>
        </button>
      </div>
    </div>
  );
}
