import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  BookmarkPlus,
  BookmarkCheck,
  Image,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { AdminPhoto, PhotoSource } from '../../../hooks/useAdminPhotos';
import { PromoteToUnitModal } from './PromoteToUnitModal';
import { PromoteToCarouselModal } from './PromoteToCarouselModal';

interface PhotoDetailModalProps {
  photo: AdminPhoto | null;
  photos: AdminPhoto[];
  onClose: () => void;
  onNavigate: (photo: AdminPhoto) => void;
  onPhotoSaved?: () => void;
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

// Sources eligible for promotion to unit gallery / carousel
const PROMOTABLE_SOURCES: PhotoSource[] = ['lot', 'order', 'delivery'];

function isPromotable(source: PhotoSource): boolean {
  return PROMOTABLE_SOURCES.includes(source);
}

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
    const [year, month, day] = isoString.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return isoString;
  }
}

export function PhotoDetailModal({ photo, photos, onClose, onNavigate, onPhotoSaved }: PhotoDetailModalProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'already_saved' | 'error' | null>(null);
  const [showPromoteUnit, setShowPromoteUnit] = useState(false);
  const [showPromoteCarousel, setShowPromoteCarousel] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset state when switching photos
  useEffect(() => {
    setShowSaveConfirm(false);
    setSaveResult(null);
    setShowPromoteUnit(false);
    setShowPromoteCarousel(false);
  }, [photo?.id]);

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

    const url = photo.public_url;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // Fall through to legacy approach
      }
    }

    // Legacy fallback for iOS Safari
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      window.open(photo.public_url, '_blank', 'noopener');
    } finally {
      setDownloading(false);
    }
  }

  async function handleSaveToAddress() {
    if (!photo || saving) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const { error } = await supabase.rpc('save_lot_picture_to_address', {
        p_order_lot_picture_id: photo.id,
      });
      if (error) {
        if (error.message?.includes('already') || error.code === '23505') {
          setSaveResult('already_saved');
        } else {
          setSaveResult('error');
        }
      } else {
        setSaveResult('success');
        setShowSaveConfirm(false);
        onPhotoSaved?.();
      }
    } catch {
      setSaveResult('error');
    } finally {
      setSaving(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  if (!photo) return null;

  const isProtected = photo.is_protected_evidence;
  const canPromote = isPromotable(photo.source);

  return (
    <>
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

          {hasNext && (
            <button
              onClick={goNext}
              className="absolute right-2 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
              aria-label="Next photo"
            >
              <ChevronRight className="w-7 h-7" />
            </button>
          )}

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
            {/* Evidence warning — delivery photos now show a softer note that promotion is still possible */}
            {isProtected && photo.source === 'delivery' && (
              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-amber-200 text-xs leading-snug">
                  Delivery proof photo — operational record. Promotion to marketing areas requires
                  extra review. Confirm no private details are visible before promoting.
                </p>
              </div>
            )}
            {isProtected && photo.source !== 'delivery' && (
              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-amber-200 text-xs leading-snug">
                  This is a protected evidence photo. It cannot be deleted, archived, or used for marketing.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {photo.customer_name && (
                <MetaRow
                  icon={<User className="w-3.5 h-3.5" />}
                  label="Customer"
                  value={photo.customer_name}
                  onClick={() => {
                    onClose();
                    navigate('/admin?tab=contacts');
                  }}
                />
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
                  onClick={() => {
                    onClose();
                    navigate(`/admin?tab=orders&orderId=${photo.order_id}`);
                  }}
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

          {/* Save to Address confirmation panel */}
          {showSaveConfirm && photo.source === 'lot' && photo.address_line1 && (
            <div className="mx-4 mb-3 bg-amber-500/10 border border-amber-400/30 rounded-xl p-3">
              <p className="text-amber-100 text-sm font-semibold mb-0.5">Save this lot photo to:</p>
              <p className="text-white text-sm font-bold mb-1">{photo.address_line1}</p>
              <p className="text-white/60 text-xs mb-3">
                This photo will appear on future orders for this same address.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSaveConfirm(false)}
                  className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveToAddress}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold transition-colors disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save to Address'}
                </button>
              </div>
            </div>
          )}

          {/* Save result feedback */}
          {saveResult === 'success' && (
            <div className="mx-4 mb-3 flex items-center gap-2 bg-green-500/15 border border-green-400/30 rounded-xl px-3 py-2.5">
              <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
              <p className="text-green-200 text-xs">Photo saved to address successfully.</p>
            </div>
          )}
          {saveResult === 'already_saved' && (
            <div className="mx-4 mb-3 flex items-center gap-2 bg-blue-500/15 border border-blue-400/30 rounded-xl px-3 py-2.5">
              <BookmarkCheck className="w-4 h-4 text-blue-300 flex-shrink-0" />
              <p className="text-blue-200 text-xs">This photo is already saved to this address.</p>
            </div>
          )}
          {saveResult === 'error' && (
            <div className="mx-4 mb-3 flex items-center gap-2 bg-red-500/15 border border-red-400/30 rounded-xl px-3 py-2.5">
              <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-200 text-xs">Failed to save photo. You may not have permission.</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 px-4 pb-4 pt-2 flex-wrap">
            <button
              onClick={handleCopyLink}
              className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors active:scale-95"
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
              className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download className={`w-4 h-4 ${downloading ? 'animate-bounce' : ''}`} />
              {downloading ? 'Saving...' : 'Download'}
            </button>

            {/* Save to Address — lot photos only */}
            {photo.source === 'lot' && photo.order_id && photo.address_line1 && (
              <button
                onClick={() => {
                  if (photo.is_saved_to_address) {
                    setSaveResult('already_saved');
                  } else {
                    setSaveResult(null);
                    setShowSaveConfirm(true);
                  }
                }}
                className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors active:scale-95 ${
                  photo.is_saved_to_address
                    ? 'bg-green-500/20 text-green-300 cursor-default'
                    : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300'
                }`}
              >
                {photo.is_saved_to_address ? (
                  <>
                    <BookmarkCheck className="w-4 h-4" />
                    Saved to Address
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="w-4 h-4" />
                    Save to Address
                  </>
                )}
              </button>
            )}

            {/* Phase 3 — Promote to Unit Gallery */}
            {canPromote && (
              <button
                onClick={() => setShowPromoteUnit(true)}
                className="flex-1 min-w-[130px] flex items-center justify-center gap-2 py-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-sm font-semibold transition-colors active:scale-95"
              >
                <Package className="w-4 h-4" />
                Add to Unit Gallery
              </button>
            )}

            {/* Phase 3 — Promote to Carousel */}
            {canPromote && (
              <button
                onClick={() => setShowPromoteCarousel(true)}
                className="flex-1 min-w-[130px] flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-sm font-semibold transition-colors active:scale-95"
              >
                <Image className="w-4 h-4" />
                Add to Carousel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Promotion modals — rendered outside the photo overlay so they stack on top (z-[60]) */}
      {showPromoteUnit && (
        <PromoteToUnitModal
          photo={photo}
          onClose={() => setShowPromoteUnit(false)}
          onSuccess={() => {
            setShowPromoteUnit(false);
            onPhotoSaved?.();
          }}
        />
      )}

      {showPromoteCarousel && (
        <PromoteToCarouselModal
          photo={photo}
          onClose={() => setShowPromoteCarousel(false)}
          onSuccess={() => {
            setShowPromoteCarousel(false);
            onPhotoSaved?.();
          }}
        />
      )}
    </>
  );
}

interface MetaRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
}

function MetaRow({ icon, label, value, onClick }: MetaRowProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-white/40 flex-shrink-0">{icon}</span>
      <span className="text-white/50 flex-shrink-0">{label}:</span>
      {onClick ? (
        <button
          onClick={onClick}
          className="text-blue-300 hover:text-blue-200 underline underline-offset-2 truncate text-left transition-colors active:opacity-70"
        >
          {value}
        </button>
      ) : (
        <span className="text-white/90 truncate">{value}</span>
      )}
    </div>
  );
}
