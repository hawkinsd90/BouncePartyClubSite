import { useState, useMemo } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useAdminPhotos, type AdminPhoto, type PhotoSource } from '../../hooks/useAdminPhotos';
import { PhotoFilterBar, type SortOrder } from './photos/PhotoFilterBar';
import { PhotoStatsBar } from './photos/PhotoStatsBar';
import { PhotoGrid } from './photos/PhotoGrid';
import { PhotoDetailModal } from './photos/PhotoDetailModal';

export function PhotosTab() {
  const { photos, loading, error, refetch, counts } = useAdminPhotos();

  const [activeFilter, setActiveFilter] = useState<PhotoSource | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<AdminPhoto | null>(null);

  // Apply filter + sort + search over the normalized photo list
  const filteredPhotos = useMemo(() => {
    let result = photos;

    // Filter by source type
    if (activeFilter !== 'all') {
      result = result.filter(p => p.source === activeFilter);
    }

    // Search across order_id (prefix), customer_name, address_line1, unit_name
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(p => {
        if (p.order_id && p.order_id.toLowerCase().startsWith(q)) return true;
        if (p.customer_name && p.customer_name.toLowerCase().includes(q)) return true;
        if (p.address_line1 && p.address_line1.toLowerCase().includes(q)) return true;
        if (p.unit_name && p.unit_name.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    // Sort
    const sorted = [...result];
    if (sortOrder === 'newest') {
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else {
      sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }

    return sorted;
  }, [photos, activeFilter, sortOrder, searchQuery]);

  function handlePhotoClick(photo: AdminPhoto) {
    setSelectedPhoto(photo);
  }

  function handleModalClose() {
    setSelectedPhoto(null);
  }

  function handleModalNavigate(photo: AdminPhoto) {
    setSelectedPhoto(photo);
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl border-2 border-slate-100">
      {/* Page header */}
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
        {/* Error state */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Failed to load photos</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Stats bar */}
        <PhotoStatsBar counts={counts} activeFilter={activeFilter} />

        {/* Filter + search */}
        <PhotoFilterBar
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {/* Result count when searching */}
        {searchQuery.trim() && !loading && (
          <p className="text-sm text-slate-500 mb-3">
            {filteredPhotos.length === 0
              ? 'No photos match your search.'
              : `${filteredPhotos.length} photo${filteredPhotos.length === 1 ? '' : 's'} found`}
          </p>
        )}

        {/* Grid */}
        <PhotoGrid
          photos={filteredPhotos}
          loading={loading}
          activeFilter={activeFilter}
          onPhotoClick={handlePhotoClick}
        />
      </div>

      {/* Lightbox */}
      <PhotoDetailModal
        photo={selectedPhoto}
        photos={filteredPhotos}
        onClose={handleModalClose}
        onNavigate={handleModalNavigate}
      />
    </div>
  );
}
