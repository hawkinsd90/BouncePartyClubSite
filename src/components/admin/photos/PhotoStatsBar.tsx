import { ShieldAlert, MapPin } from 'lucide-react';
import type { AdminPhoto, PhotoCounts, PhotoSource } from '../../../hooks/useAdminPhotos';

interface PhotoStatsBarProps {
  counts: PhotoCounts;
  activeFilter: PhotoSource | 'all';
  photos: AdminPhoto[];
}

const STAT_ITEMS: Array<{ key: PhotoSource | 'all'; label: string; color: string }> = [
  { key: 'all', label: 'Total', color: 'bg-slate-100 text-slate-700' },
  { key: 'lot', label: 'Lot', color: 'bg-amber-100 text-amber-800' },
  { key: 'order', label: 'Order', color: 'bg-blue-100 text-blue-800' },
  { key: 'delivery', label: 'Delivery', color: 'bg-green-100 text-green-800' },
  { key: 'damage', label: 'Damage', color: 'bg-red-100 text-red-800' },
  { key: 'unit', label: 'Unit', color: 'bg-sky-100 text-sky-800' },
  { key: 'carousel', label: 'Carousel', color: 'bg-rose-100 text-rose-800' },
];

function getCount(counts: PhotoCounts, key: PhotoSource | 'all'): number {
  if (key === 'all') return counts.total;
  return counts[key];
}

export function PhotoStatsBar({ counts, activeFilter, photos }: PhotoStatsBarProps) {
  const savedToAddressCount = photos.filter(p => p.is_saved_to_address === true).length;
  const protectedCount = photos.filter(p => p.is_protected_evidence).length;

  return (
    <div className="space-y-2 mb-4">
      <div className="flex flex-wrap gap-2">
        {STAT_ITEMS.map(({ key, label, color }) => {
          const count = getCount(counts, key);
          const isActive = activeFilter === key;
          return (
            <div
              key={key}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${color} ${
                isActive ? 'ring-2 ring-offset-1 ring-slate-400 font-bold' : 'opacity-80'
              }`}
            >
              <span>{label}</span>
              <span className="font-bold tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200">
          <MapPin className="w-3 h-3" />
          <span>{savedToAddressCount} saved to address</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <ShieldAlert className="w-3 h-3" />
          <span>{protectedCount} protected evidence</span>
        </div>
      </div>
    </div>
  );
}
