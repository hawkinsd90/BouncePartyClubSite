import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, CreditCard as Edit2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { notifyError } from '../../lib/notifications';
import { useCarouselData } from './carousel/useCarouselData';
import { CarouselDisplay } from './carousel/CarouselDisplay';
import { CarouselEditMode } from './carousel/CarouselEditMode';
import { CarouselAddForm } from './carousel/CarouselAddForm';
import { CarouselEditForm } from './carousel/CarouselEditForm';
import type { CarouselMedia, NewMediaState } from './carousel/carouselTypes';

interface HeroCarouselProps {
  adminControls?: React.ReactNode;
}

const EMPTY_NEW_MEDIA: NewMediaState = {
  file: null,
  url: '',
  title: '',
  description: '',
  mediaType: 'image',
};

export function HeroCarousel({ adminControls }: HeroCarouselProps) {
  const { isAdmin } = useAuth();
  const { media, loading, error, loadMedia, handleFileUpload, addMediaToDatabase, updateMedia, deleteMedia, moveMedia } = useCarouselData();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingMedia, setEditingMedia] = useState<CarouselMedia | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [uploadMethod, setUploadMethod] = useState<'file' | 'url'>('file');
  const [uploading, setUploading] = useState(false);
  const [newMedia, setNewMedia] = useState<NewMediaState>(EMPTY_NEW_MEDIA);

  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 50;

  useEffect(() => {
    loadMedia();
  }, []);

  useEffect(() => {
    if (media.length === 0) return;

    const advance = () => setCurrentIndex((prev) => (prev + 1) % media.length);

    let interval: ReturnType<typeof setInterval> | null = document.hidden
      ? null
      : setInterval(advance, 5000);

    function handleVisibilityChange() {
      if (document.hidden) {
        if (interval !== null) {
          clearInterval(interval);
          interval = null;
        }
      } else {
        interval = setInterval(advance, 5000);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (interval !== null) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [media.length]);

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? media.length - 1 : prev - 1));
  }, [media.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % media.length);
  }, [media.length]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) >= SWIPE_THRESHOLD) {
      if (diff > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  const handleAddMedia = async () => {
    setUploading(true);
    if (uploadMethod === 'file') {
      await handleFileUpload(newMedia, () => {
        setNewMedia(EMPTY_NEW_MEDIA);
        setShowAddForm(false);
      });
    } else {
      if (!newMedia.url.trim()) {
        notifyError('Please enter a URL');
        setUploading(false);
        return;
      }
      await addMediaToDatabase(newMedia, newMedia.url);
      setNewMedia(EMPTY_NEW_MEDIA);
      setShowAddForm(false);
    }
    setUploading(false);
  };

  const handleSaveEdit = async () => {
    if (!editingMedia) return;
    setUploading(true);
    const success = await updateMedia(editingMedia, newMedia);
    setUploading(false);
    if (success) {
      setEditingMedia(null);
      setNewMedia(EMPTY_NEW_MEDIA);
    }
  };

  const handleDeleteMedia = (id: string, storagePath: string | null) => {
    deleteMedia(id, storagePath, currentIndex, () => setCurrentIndex(0));
  };

  if (loading) {
    return (
      <div className="w-full aspect-[16/9] max-h-[600px] bg-slate-200 animate-pulse flex items-center justify-center">
        <p className="text-slate-500">Loading carousel...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full aspect-[16/9] max-h-[600px] bg-red-50 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-red-600 font-semibold mb-2">Failed to load carousel</p>
          <p className="text-red-500 text-sm">{error}</p>
          <button
            onClick={loadMedia}
            className="mt-4 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (media.length === 0) {
    if (isAdmin) {
      return (
        <section className="w-full sm:max-w-7xl sm:mx-auto sm:px-6 lg:px-8 py-0 sm:py-8">
          <div className="bg-slate-100 sm:rounded-lg p-8 text-center">
            <p className="text-slate-600 mb-4">No carousel media yet. Add your first image or video!</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add First Media
            </button>
          </div>
          {showAddForm && (
            <CarouselAddForm
              newMedia={newMedia}
              uploadMethod={uploadMethod}
              uploading={uploading}
              onNewMediaChange={setNewMedia}
              onUploadMethodChange={setUploadMethod}
              onSubmit={handleAddMedia}
              onCancel={() => { setShowAddForm(false); setNewMedia(EMPTY_NEW_MEDIA); }}
            />
          )}
        </section>
      );
    }
    return null;
  }

  return (
    <section className="w-full sm:max-w-7xl sm:mx-auto sm:px-6 lg:px-8 py-0 sm:py-8">
      <div className="relative">
        {isAdmin && (
          <div className="flex flex-wrap justify-end gap-2 mb-4">
            {adminControls}
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={`${isEditMode ? 'bg-slate-600 hover:bg-slate-700' : 'bg-blue-600 hover:bg-blue-700'} text-white px-3 sm:px-4 py-2 rounded-lg inline-flex items-center gap-2 text-xs sm:text-sm transition-colors`}
            >
              {isEditMode ? <X className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
              {isEditMode ? 'Exit Edit Mode' : 'Edit Carousel'}
            </button>
            {isEditMode && (
              <button
                onClick={() => setShowAddForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-2 rounded-lg inline-flex items-center gap-2 text-xs sm:text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Media
              </button>
            )}
          </div>
        )}

        <CarouselDisplay
          media={media}
          currentIndex={currentIndex}
          onPrevious={goToPrevious}
          onNext={goToNext}
          onGoToSlide={setCurrentIndex}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />

        {isEditMode && (
          <CarouselEditMode
            media={media}
            onEdit={(item) => { setEditingMedia(item); setNewMedia(EMPTY_NEW_MEDIA); }}
            onDelete={handleDeleteMedia}
            onMove={moveMedia}
          />
        )}
      </div>

      {showAddForm && (
        <CarouselAddForm
          newMedia={newMedia}
          uploadMethod={uploadMethod}
          uploading={uploading}
          onNewMediaChange={setNewMedia}
          onUploadMethodChange={setUploadMethod}
          onSubmit={handleAddMedia}
          onCancel={() => { setShowAddForm(false); setNewMedia(EMPTY_NEW_MEDIA); }}
        />
      )}

      {editingMedia && (
        <CarouselEditForm
          editingMedia={editingMedia}
          newMedia={newMedia}
          uploadMethod={uploadMethod}
          uploading={uploading}
          onEditingMediaChange={setEditingMedia}
          onNewMediaChange={setNewMedia}
          onUploadMethodChange={setUploadMethod}
          onSave={handleSaveEdit}
          onCancel={() => { setEditingMedia(null); setNewMedia(EMPTY_NEW_MEDIA); }}
        />
      )}
    </section>
  );
}
