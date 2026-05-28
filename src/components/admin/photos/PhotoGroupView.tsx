import { ChevronDown, ChevronRight, Image } from 'lucide-react';
import { useState } from 'react';
import type { AdminPhoto, PhotoSource } from '../../../hooks/useAdminPhotos';
import type { GroupByMode } from './PhotoFilterBar';
import { PhotoCard } from './PhotoCard';

interface PhotoGroupViewProps {
  photos: AdminPhoto[];
  groupBy: GroupByMode;
  onPhotoClick: (photo: AdminPhoto) => void;
  pageSize?: number;
}

const SOURCE_GROUP_LABELS: Record<PhotoSource, string> = {
  lot: 'Lot Photos',
  order: 'Order Photos',
  delivery: 'Delivery Proof',
  damage: 'Damage Photos',
  unit: 'Unit Images',
  carousel: 'Carousel Images',
};

function groupKey(photo: AdminPhoto, groupBy: GroupByMode): string {
  switch (groupBy) {
    case 'source': return photo.source;
    case 'order': return photo.order_id ?? '__none__';
    case 'unit': return photo.unit_id ?? '__none__';
    case 'address': return photo.address_id ?? '__none__';
    default: return '__all__';
  }
}

function groupLabel(key: string, groupBy: GroupByMode, sample: AdminPhoto): string {
  if (key === '__none__' || key === '__all__') {
    if (groupBy === 'order') return 'No Order';
    if (groupBy === 'unit') return 'No Unit';
    if (groupBy === 'address') return 'No Address';
    return 'Other';
  }
  switch (groupBy) {
    case 'source':
      return SOURCE_GROUP_LABELS[key as PhotoSource] ?? key;
    case 'order': {
      const name = sample.customer_name ? `${sample.customer_name} — ${key.slice(0, 8).toUpperCase()}` : key.slice(0, 8).toUpperCase();
      const date = sample.order_event_date
        ? new Date(sample.order_event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null;
      return date ? `${name} · ${date}` : name;
    }
    case 'unit': return sample.unit_name ?? key;
    case 'address': return sample.address_line1 ?? key;
    default: return key;
  }
}

interface PhotoGroupSection {
  key: string;
  label: string;
  photos: AdminPhoto[];
}

function buildGroups(photos: AdminPhoto[], groupBy: GroupByMode): PhotoGroupSection[] {
  const map = new Map<string, AdminPhoto[]>();
  for (const p of photos) {
    const k = groupKey(p, groupBy);
    const arr = map.get(k) ?? [];
    arr.push(p);
    map.set(k, arr);
  }
  const sections: PhotoGroupSection[] = [];
  map.forEach((arr, key) => {
    sections.push({ key, label: groupLabel(key, groupBy, arr[0]), photos: arr });
  });
  sections.sort((a, b) => {
    if (a.key === '__none__') return 1;
    if (b.key === '__none__') return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  return sections;
}

const DEFAULT_PAGE_SIZE = 24;

function GroupSection({ section, onPhotoClick, pageSize }: { section: PhotoGroupSection; onPhotoClick: (p: AdminPhoto) => void; pageSize: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);

  const visible = section.photos.slice(0, visibleCount);
  const hasMore = visibleCount < section.photos.length;

  return (
    <div className="mb-6">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 mb-3 group text-left"
      >
        <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
        <h3 className="font-semibold text-slate-800 text-sm">{section.label}</h3>
        <span className="ml-1 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
          {section.photos.length}
        </span>
      </button>

      {!collapsed && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visible.map(photo => (
              <PhotoCard key={photo.id} photo={photo} onClick={onPhotoClick} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-3 text-center">
              <button
                onClick={() => setVisibleCount(c => c + pageSize)}
                className="px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
              >
                Show more ({section.photos.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PhotoGroupView({ photos, groupBy, onPhotoClick, pageSize = DEFAULT_PAGE_SIZE }: PhotoGroupViewProps) {
  const sections = buildGroups(photos, groupBy);

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Image className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-700 mb-1">No photos match your filters</h3>
        <p className="text-sm text-slate-500 max-w-xs">Try adjusting your filters or search query.</p>
      </div>
    );
  }

  return (
    <div>
      {sections.map(section => (
        <GroupSection key={section.key} section={section} onPhotoClick={onPhotoClick} pageSize={pageSize} />
      ))}
    </div>
  );
}
