import { Search, ArrowDownNarrowWide, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { PhotoSource } from '../../../hooks/useAdminPhotos';

export type SortOrder = 'newest' | 'oldest' | 'source-az' | 'customer-az' | 'unit-az';
export type DateRangeFilter = 'all' | '7d' | '30d' | '90d';
export type EvidenceFilter = 'all' | 'protected' | 'non-evidence';
export type SavedAddressFilter = 'all' | 'saved' | 'not-saved';
export type DisplayStatusFilter = 'all' | 'unit-gallery' | 'carousel';
export type GroupByMode = 'flat' | 'source' | 'order' | 'unit' | 'address';

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

const SORT_OPTIONS: Array<{ value: SortOrder; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'source-az', label: 'Source A–Z' },
  { value: 'customer-az', label: 'Customer A–Z' },
  { value: 'unit-az', label: 'Unit A–Z' },
];

const DATE_RANGE_OPTIONS: Array<{ value: DateRangeFilter; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const GROUP_OPTIONS: Array<{ value: GroupByMode; label: string }> = [
  { value: 'flat', label: 'Flat grid' },
  { value: 'source', label: 'Group by source' },
  { value: 'order', label: 'Group by order' },
  { value: 'unit', label: 'Group by unit' },
  { value: 'address', label: 'Group by address' },
];

export interface PhotoFilterBarProps {
  activeFilter: PhotoSource | 'all';
  onFilterChange: (filter: PhotoSource | 'all') => void;
  sortOrder: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  dateRange: DateRangeFilter;
  onDateRangeChange: (range: DateRangeFilter) => void;
  evidenceFilter: EvidenceFilter;
  onEvidenceFilterChange: (f: EvidenceFilter) => void;
  savedAddressFilter: SavedAddressFilter;
  onSavedAddressFilterChange: (f: SavedAddressFilter) => void;
  displayStatusFilter: DisplayStatusFilter;
  onDisplayStatusFilterChange: (f: DisplayStatusFilter) => void;
  groupBy: GroupByMode;
  onGroupByChange: (g: GroupByMode) => void;
}

function hasActiveAdvanced(
  dateRange: DateRangeFilter,
  evidenceFilter: EvidenceFilter,
  savedAddressFilter: SavedAddressFilter,
  displayStatusFilter: DisplayStatusFilter,
): boolean {
  return dateRange !== 'all' || evidenceFilter !== 'all' || savedAddressFilter !== 'all' || displayStatusFilter !== 'all';
}

export function PhotoFilterBar({
  activeFilter,
  onFilterChange,
  sortOrder,
  onSortChange,
  searchQuery,
  onSearchChange,
  dateRange,
  onDateRangeChange,
  evidenceFilter,
  onEvidenceFilterChange,
  savedAddressFilter,
  onSavedAddressFilterChange,
  displayStatusFilter,
  onDisplayStatusFilterChange,
  groupBy,
  onGroupByChange,
}: PhotoFilterBarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeAdvanced = hasActiveAdvanced(dateRange, evidenceFilter, savedAddressFilter, displayStatusFilter);

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

      {/* Filter chips + controls row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 pb-1">
            {FILTER_CHIPS.map(({ key, label, activeClass }) => {
              const isActive = activeFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => onFilterChange(key)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                    isActive ? activeClass : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Advanced filters toggle */}
        <button
          onClick={() => setAdvancedOpen(v => !v)}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all shadow-sm ${
            activeAdvanced
              ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeAdvanced && <span className="text-xs bg-white/30 rounded-full px-1.5 font-bold">ON</span>}
          {advancedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* Sort select */}
        <div className="flex-shrink-0 relative">
          <select
            value={sortOrder}
            onChange={(e) => onSortChange(e.target.value as SortOrder)}
            className="appearance-none pl-3 pr-8 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ArrowDownNarrowWide className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Advanced filters panel */}
      {advancedOpen && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Date range */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Date Range</label>
              <div className="flex flex-col gap-1">
                {DATE_RANGE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => onDateRangeChange(o.value)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      dateRange === o.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Evidence filter */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Evidence Status</label>
              <div className="flex flex-col gap-1">
                {([['all', 'All photos'], ['protected', 'Protected evidence'], ['non-evidence', 'Non-evidence']] as const).map(([val, lbl]) => (
                  <button
                    key={val}
                    onClick={() => onEvidenceFilterChange(val)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      evidenceFilter === val
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Saved address filter */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Address Save Status</label>
              <div className="flex flex-col gap-1">
                {([['all', 'All photos'], ['saved', 'Saved to address'], ['not-saved', 'Not saved yet']] as const).map(([val, lbl]) => (
                  <button
                    key={val}
                    onClick={() => onSavedAddressFilterChange(val)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      savedAddressFilter === val
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Display status filter */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Display Status</label>
              <div className="flex flex-col gap-1">
                {([['all', 'All photos'], ['unit-gallery', 'In unit gallery'], ['carousel', 'In carousel']] as const).map(([val, lbl]) => (
                  <button
                    key={val}
                    onClick={() => onDisplayStatusFilterChange(val)}
                    className={`text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      displayStatusFilter === val
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Group by */}
          <div className="pt-3 border-t border-slate-200">
            <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">View / Group By</label>
            <div className="flex flex-wrap gap-2">
              {GROUP_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => onGroupByChange(o.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    groupBy === o.value
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {activeAdvanced && (
            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                onClick={() => {
                  onDateRangeChange('all');
                  onEvidenceFilterChange('all');
                  onSavedAddressFilterChange('all');
                  onDisplayStatusFilterChange('all');
                }}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                Reset advanced filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
