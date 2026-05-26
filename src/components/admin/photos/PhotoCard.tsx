import { ShieldAlert, Image } from 'lucide-react';
import type { AdminPhoto, PhotoSource } from '../../../hooks/useAdminPhotos';

interface PhotoCardProps {
  photo: AdminPhoto;
  onClick: (photo: AdminPhoto) => void;
}

const SOURCE_LABELS: Record<PhotoSource, string> = {
  lot: 'Lot',
  order: 'Order',
  delivery: 'Delivery',
  damage: 'Damage',
  unit: 'Unit',
  carousel: 'Carousel',
};

const SOURCE_BADGE_COLORS: Record<PhotoSource, string> = {
  lot: 'bg-amber-500 text-white',
  order: 'bg-blue-500 text-white',
  delivery: 'bg-green-600 text-white',
  damage: 'bg-red-600 text-white',
  unit: 'bg-sky-500 text-white',
  carousel: 'bg-rose-500 text-white',
};

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function PhotoCard({ photo, onClick }: PhotoCardProps) {
  const isProtected = photo.is_protected_evidence;

  return (
    <button
      onClick={() => onClick(photo)}
      className="group relative w-full aspect-square rounded-xl overflow-hidden bg-slate-100 shadow-sm hover:shadow-md active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      aria-label={`View ${SOURCE_LABELS[photo.source]} photo${photo.customer_name ? ` for ${photo.customer_name}` : ''}`}
    >
      {/* Photo */}
      <img
        src={photo.public_url}
        alt={photo.file_name}
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        onError={(e) => {
          const target = e.currentTarget;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent) {
            parent.classList.add('bg-slate-200');
            const fallback = parent.querySelector('[data-fallback]') as HTMLElement | null;
            if (fallback) fallback.style.display = 'flex';
          }
        }}
      />

      {/* Fallback icon (hidden by default, shown on img error) */}
      <div
        data-fallback
        className="absolute inset-0 items-center justify-center bg-slate-200 hidden"
      >
        <Image className="w-10 h-10 text-slate-400" />
      </div>

      {/* Top row: source badge + evidence shield */}
      <div className="absolute top-2 left-2 right-2 flex items-start justify-between pointer-events-none">
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-bold shadow ${SOURCE_BADGE_COLORS[photo.source]}`}
        >
          {SOURCE_LABELS[photo.source]}
        </span>

        {isProtected && (
          <span className="flex items-center gap-1 bg-black/70 text-amber-300 text-xs font-bold px-2 py-0.5 rounded-full shadow">
            <ShieldAlert className="w-3 h-3" />
            <span>Evidence</span>
          </span>
        )}
      </div>

      {/* Bottom gradient + metadata */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-6 pb-2 px-2 pointer-events-none">
        {photo.customer_name && (
          <p className="text-white text-xs font-semibold truncate leading-tight">
            {photo.customer_name}
          </p>
        )}
        {photo.unit_name && !photo.customer_name && (
          <p className="text-white text-xs font-semibold truncate leading-tight">
            {photo.unit_name}
          </p>
        )}
        <p className="text-white/70 text-xs truncate leading-tight">
          {formatDate(photo.created_at)}
        </p>
      </div>
    </button>
  );
}
