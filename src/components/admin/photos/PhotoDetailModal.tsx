import { useEffect, useRef, useState, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Copy,
  Check,
  ShieldAlert,
  Calendar,
  MapPin,
  User,
  Package,
  ExternalLink,
} from 'lucide-react';
import type { AdminPhoto, PhotoSource } from '../../../hooks/useAdminPhotos';

interface PhotoDetailModalProps {
  photo: AdminPhoto | null;
  photos: AdminPhoto[];
  onClose: () => void;
  onNavigate: (photo: AdminPhoto) => void;
}

const SOURCE_LABELS: Record<PhotoSource, string> = {
  lot: 'Lot Photo',
  order: 'Order Photo',
  delivery: 'Delivery Proof',
  damage: 'Damage Photo',
  unit: 'Unit Image',
  carousel: 'Carousel Image',
};

const SOURCE_COLORS: Record<PhotoSource, string> = {
  lot: 'bg-amber-100 text-amber-800 border-amber-200',
  order: 'bg-blue-100 text-blue-800 border-blue-200',
  delivery: 'bg-green-100 text-green-800 border-green-200',
  damage: 'bg-red-100 text-red-800 border-red-200',
  unit: 'bg-sky-100 text-sky-800 border-sky-200',
  carousel: 'bg-rose-100 text-rose-800 border-rose-200',
};

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function formatEventDate(isoString: string): string {
  try {
    // event_date is typically YYYY-MM-DD (date only, no time zone)
    const [year, month, day] = isoString.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return isoString;
  }
}

export function PhotoDetailModal({ photo, photos, onClose, onNavigate }: PhotoDetailModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const currentIndex = photo ? photos.findIndex(p => p.id === photo.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;

  const goNext = useCallback(() => {
    if (hasNext) onNavigate(photos[currentIndex + 1]);
  }, [hasNext, currentIndex, photos, onNavigate]);

  const goPrev = useCallback(() => {
    if (hasPrev) onNavigate(photos[currentIndex - 1]);
  }, [hasPrev, currentIndex, photos, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    if (!photo) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [photo, onClose, goNext, goPrev]);

  // Lock body scroll while open
  useEffect(() => {
    if (!photo) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [photo]);

  // Touch swipe
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta < -50) goNext();
    else if (delta > 50) goPrev();
  }

  async function handleCopyLink() {
    if (!photo) return;
    try {
      await navigator.clipboard.writeText(photo.public_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const input = document.createElement('input');
      input.value = photo.public_url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleDownload() {
    if (!photo || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(photo.public_url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = photo.file_name || 'photo.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback: open in new tab
      window.open(photo.public_url, '_blank', 'noopener');
    } finally {
      setDownloading(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  if (!photo) return null;

  const isProtected = photo.is_protected_evidence;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      {/* Header bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-black/60 backdrop-blur-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-bold border ${SOURCE_COLORS[photo.source]}`}
          >
            {SOURCE_LABELS[photo.source]}
          </span>
          {isProtected && (
            <span className="flex items-center gap-1 bg-amber-500/20 border border-amber-400/40 text-amber-300 text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
              <ShieldAlert className="w-3 h-3" />
              Protected Evidence
            </span>
          )}
        </div>

        <button
          onClick={onClose}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors ml-2"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main image area with nav arrows */}
      <div
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Prev arrow */}
        {hasPrev && (
          <button
            onClick={goPrev}
            className="absolute left-2 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-7 h-7" />
          </button>
        )}

        <img
          key={photo.id}
          src={photo.public_url}
          alt={photo.file_name}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={goNext}
            className="absolute right-2 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
            aria-label="Next photo"
          >
            <ChevronRight className="w-7 h-7" />
          </button>
        )}

        {/* Position indicator */}
        {photos.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full">
            {currentIndex + 1} / {photos.length}
          </div>
        )}
      </div>

      {/* Metadata + action panel */}
      <div className="flex-shrink-0 bg-black/70 backdrop-blur-sm border-t border-white/10">
        {/* Metadata rows */}
        <div className="px-4 pt-4 pb-2 space-y-2">
          {/* Evidence warning */}
          {isProtected && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-200 text-xs leading-snug">
                This is an operational proof/evidence photo. It cannot be deleted, archived, or used for marketing.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {photo.customer_name && (
              <MetaRow icon={<User className="w-3.5 h-3.5" />} label="Customer" value={photo.customer_name} />
            )}
            {photo.order_event_date && (
              <MetaRow
                icon={<Calendar className="w-3.5 h-3.5" />}
                label="Event Date"
                value={formatEventDate(photo.order_event_date)}
              />
            )}
            {photo.address_line1 && (
              <MetaRow icon={<MapPin className="w-3.5 h-3.5" />} label="Address" value={photo.address_line1} />
            )}
            {photo.unit_name && (
              <MetaRow icon={<Package className="w-3.5 h-3.5" />} label="Unit" value={photo.unit_name} />
            )}
            {photo.order_id && (
              <MetaRow
                icon={<ExternalLink className="w-3.5 h-3.5" />}
                label="Order"
                value={photo.order_id.slice(0, 8).toUpperCase()}
              />
            )}
            <MetaRow
              icon={<Calendar className="w-3.5 h-3.5" />}
              label="Uploaded"
              value={formatDate(photo.created_at)}
            />
          </div>

          {photo.notes && (
            <p className="text-white/60 text-xs px-0.5 italic">&ldquo;{photo.notes}&rdquo;</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 px-4 pb-4 pt-2">
          <button
            onClick={handleCopyLink}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors active:scale-95"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy Link
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Download className={`w-4 h-4 ${downloading ? 'animate-bounce' : ''}`} />
            {downloading ? 'Saving...' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface MetaRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function MetaRow({ icon, label, value }: MetaRowProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-white/40 flex-shrink-0">{icon}</span>
      <span className="text-white/50 flex-shrink-0">{label}:</span>
      <span className="text-white/90 truncate">{value}</span>
    </div>
  );
}
