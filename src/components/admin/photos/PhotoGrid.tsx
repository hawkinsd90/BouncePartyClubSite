import { Image } from 'lucide-react';
import type { AdminPhoto, PhotoSource } from '../../../hooks/useAdminPhotos';
import { PhotoCard } from './PhotoCard';

interface PhotoGridProps {
  photos: AdminPhoto[];
  loading: boolean;
  activeFilter: PhotoSource | 'all';
  onPhotoClick: (photo: AdminPhoto) => void;
}

const EMPTY_MESSAGES: Record<PhotoSource | 'all', { title: string; body: string }> = {
  all: {
    title: 'No photos yet',
    body: 'Photos will appear here once crews upload delivery proof, customers submit lot photos, or unit images are added.',
  },
  lot: {
    title: 'No lot photos yet',
    body: "Lot photos are uploaded by customers before their event so you can review the setup location.",
  },
  order: {
    title: 'No order photos yet',
    body: 'Order photos are submitted by customers through the customer portal.',
  },
  delivery: {
    title: 'No delivery photos yet',
    body: 'Delivery proof photos are uploaded by crew members when completing a drop-off task.',
  },
  damage: {
    title: 'No damage photos yet',
    body: 'Damage photos are uploaded by crew members during pick-up if any damage is noted.',
  },
  unit: {
    title: 'No unit images yet',
    body: 'Unit images are managed through the Inventory section.',
  },
  carousel: {
    title: 'No carousel images yet',
    body: 'Carousel images are managed through the Business Branding section.',
  },
};

function SkeletonCard() {
  return (
    <div className="aspect-square rounded-xl bg-slate-200 animate-pulse" />
  );
}

export function PhotoGrid({ photos, loading, activeFilter, onPhotoClick }: PhotoGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (photos.length === 0) {
    const { title, body } = EMPTY_MESSAGES[activeFilter];
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Image className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-700 mb-1">{title}</h3>
        <p className="text-sm text-slate-500 max-w-xs">{body}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {photos.map((photo) => (
        <PhotoCard key={photo.id} photo={photo} onClick={onPhotoClick} />
      ))}
    </div>
  );
}
