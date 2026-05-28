import { useState, useMemo, useEffect } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useAdminPhotos, type AdminPhoto, type PhotoSource } from '../../hooks/useAdminPhotos';
import {
  PhotoFilterBar,
  type SortOrder,
  type DateRangeFilter,
  type EvidenceFilter,
  type SavedAddressFilter,
  type DisplayStatusFilter,
  type GroupByMode,
} from './photos/PhotoFilterBar';
import { PhotoStatsBar } from './photos/PhotoStatsBar';
import { PhotoGrid, PAGE_SIZE } from './photos/PhotoGrid';
import { PhotoGroupView } from './photos/PhotoGroupView';
import { PhotoDetailModal } from './photos/PhotoDetailModal';
import { PhotoMediaHealthPanel } from './photos/PhotoMediaHealthPanel';

function cutoffDate(range: DateRangeFilter): Date | null {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function sortPhotos(photos: AdminPhoto[], sortOrder: SortOrder): AdminPhoto[] {
  const sorted = [...photos];
  switch (sortOrder) {
    case 'newest':
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      break;
    case 'oldest':
      sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      break;
    case 'source-az':
      sorted.sort((a, b) => a.source.localeCompare(b.source, undefined, { sensitivity: 'base' }));
      break;
    case 'customer-az':
      sorted.sort((a, b) => (a.customer_name ?? '\uFFFF').localeCompare(b.customer_name ?? '\uFFFF', undefined, { sensitivity: 'base' }));
      break;
    case 'unit-az':
      sorted.sort((a, b) => (a.unit_name ?? '\uFFFF').localeCompare(b.unit_name ?? '\uFFFF', undefined, { sensitivity: 'base' }));
      break;
  }
  return sorted;
}

export function PhotosTab() {
  const { photos, loading, error, refetch, counts } = useAdminPhotos();

  const [activeFilter, setActiveFilter] = useState<PhotoSource | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all');
  const [savedAddressFilter, setSavedAddressFilter] = useState<SavedAddressFilter>('all');
  const [displayStatusFilter, setDisplayStatusFilter] = useState<DisplayStatusFilter>('all');
  const [groupBy, setGroupBy] = useState<GroupByMode>('flat');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedPhoto, setSelectedPhoto] = useState<AdminPhoto | null>(null);

  // Reset pagination on any filter/sort/group change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeFilter, sortOrder, searchQuery, dateRange, evidenceFilter, savedAddressFilter, displayStatusFilter, groupBy]);

  const filteredPhotos = useMemo(() => {
    let result = photos;

    if (activeFilter !== 'all') {
      result = result.filter(p => p.source === activeFilter);
    }

    const cutoff = cutoffDate(dateRange);
    if (cutoff) {
      result = result.filter(p => new Date(p.created_at) >= cutoff);
    }

    if (evidenceFilter === 'protected') {
      result = result.filter(p => p.is_protected_evidence);
    } else if (evidenceFilter === 'non-evidence') {
      result = result.filter(p => !p.is_protected_evidence);
    }

    if (savedAddressFilter === 'saved') {
      result = result.filter(p => p.is_saved_to_address === true);
    } else if (savedAddressFilter === 'not-saved') {
      result = result.filter(p => p.is_saved_to_address !== true);
    }

    if (displayStatusFilter === 'unit-gallery') {
      result = result.filter(p => p.source === 'unit');
    } else if (displayStatusFilter === 'carousel') {
      result = result.filter(p => p.source === 'carousel');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(p =>
        (p.order_id && p.order_id.toLowerCase().includes(q)) ||
        (p.customer_name && p.customer_name.toLowerCase().includes(q)) ||
        (p.address_line1 && p.address_line1.toLowerCase().includes(q)) ||
        (p.unit_name && p.unit_name.toLowerCase().includes(q))
      );
    }

    return sortPhotos(result, sortOrder);
  }, [photos, activeFilter, sortOrder, searchQuery, dateRange, evidenceFilter, savedAddressFilter, displayStatusFilter]);

  const isGrouped = groupBy !== 'flat';
  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    dateRange !== 'all' ||
    evidenceFilter !== 'all' ||
    savedAddressFilter !== 'all' ||
    displayStatusFilter !== 'all';

  return (
    <div className="bg-white rounded-2xl shadow-xl border-2 border-slate-100">
      <div className="px-4 sm:px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Media Library</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              All photos from lot pictures, deliveries, orders, units, and carousel
            </p>
          </div>
          <button
            onClick={refetch}
            disabled={loading}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
            aria-label="Refresh photos"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-5 pb-6">
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Failed to load photos</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {!loading && <PhotoMediaHealthPanel allPhotos={photos} />}

        <PhotoStatsBar counts={counts} activeFilter={activeFilter} photos={photos} />

        <PhotoFilterBar
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          evidenceFilter={evidenceFilter}
          onEvidenceFilterChange={setEvidenceFilter}
          savedAddressFilter={savedAddressFilter}
          onSavedAddressFilterChange={setSavedAddressFilter}
          displayStatusFilter={displayStatusFilter}
          onDisplayStatusFilterChange={setDisplayStatusFilter}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
        />

        {hasActiveFilters && !loading && (
          <p className="text-sm text-slate-500 mb-3">
            {filteredPhotos.length === 0
              ? 'No photos match your filters.'
              : `${filteredPhotos.length} photo${filteredPhotos.length === 1 ? '' : 's'} match`}
          </p>
        )}

        {isGrouped ? (
          <PhotoGroupView
            photos={filteredPhotos}
            groupBy={groupBy}
            onPhotoClick={setSelectedPhoto}
          />
        ) : (
          <PhotoGrid
            photos={filteredPhotos}
            loading={loading}
            activeFilter={activeFilter}
            onPhotoClick={setSelectedPhoto}
            visibleCount={visibleCount}
            onLoadMore={() => setVisibleCount(c => c + PAGE_SIZE)}
          />
        )}
      </div>

      <PhotoDetailModal
        photo={selectedPhoto}
        photos={filteredPhotos}
        onClose={() => setSelectedPhoto(null)}
        onNavigate={setSelectedPhoto}
        onPhotoSaved={refetch}
      />
    </div>
  );
}
