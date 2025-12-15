import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { ChevronLeft, ChevronRight, Plus, Trash2, Edit2, Save, X, MoveUp, MoveDown, Upload, Link as LinkIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { notifyError, showConfirm } from '../../lib/notifications';

interface CarouselMedia {
  id: string;
  image_url: string;
  media_type: 'image' | 'video';
  storage_path: string | null;
  title: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

interface HeroCarouselProps {
  adminControls?: React.ReactNode;
}

export function HeroCarousel({ adminControls }: HeroCarouselProps) {
  const { isAdmin } = useAuth();
  const [media, setMedia] = useState<CarouselMedia[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingMedia, setEditingMedia] = useState<CarouselMedia | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadMethod, setUploadMethod] = useState<'file' | 'url'>('file');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newMedia, setNewMedia] = useState({
    file: null as File | null,
    url: '',
    title: '',
    description: '',
    mediaType: 'image' as 'image' | 'video',
  });

  useEffect(() => {
    loadMedia();
  }, []);

  useEffect(() => {
    if (media.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % media.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [media.length]);

  async function loadMedia() {
    try {
      setLoading(true);
      setError(null);
      console.log('[Carousel] Loading media...');
      console.log('[Carousel] Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
      console.log('[Carousel] Has anon key:', !!import.meta.env.VITE_SUPABASE_ANON_KEY);

      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/hero_carousel_images?is_active=eq.true&order=display_order`;
      console.log('[Carousel] Trying direct fetch to:', url);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout after 10 seconds')), 10000)
      );

      const fetchPromise = fetch(url, {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      }).then(res => {
        console.log('[Carousel] Fetch response status:', res.status);
        return res.json();
      });

      const data = await Promise.race([fetchPromise, timeoutPromise]) as any;

      console.log('[Carousel] Query result:', { data });

      const error = null;

      if (error) {
        console.error('[Carousel] Error loading carousel:', error);
        setError(`Error: ${(error as any)?.message || 'Unknown error'}`);
        setMedia([]);
        setLoading(false);
        return;
      }

      if (data) {
        console.log(`[Carousel] Found ${data.length} items`);
        const mediaWithUrls = await Promise.all(
          data.map(async (item: any) => {
            if (item.storage_path) {
              const { data: urlData } = supabase.storage
                .from('carousel-media')
                .getPublicUrl(item.storage_path);
              return { ...item, image_url: urlData.publicUrl };
            }
            return item;
          })
        );
        setMedia(mediaWithUrls);
        console.log('[Carousel] Media loaded successfully');
      }
      setLoading(false);
    } catch (err) {
      console.error('[Carousel] Exception loading carousel:', err);
      setError(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      setMedia([]);
      setLoading(false);
    }
  }

  async function handleFileUpload() {
    if (!newMedia.file) return;

    setUploading(true);
    const fileExt = newMedia.file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('carousel-media')
      .upload(filePath, newMedia.file);

    if (uploadError) {
      notifyError('Failed to upload file: ' + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from('carousel-media')
      .getPublicUrl(filePath);

    await addMediaToDatabase(urlData.publicUrl, filePath);
    setUploading(false);
  }

  async function addMediaToDatabase(url: string, storagePath: string | null = null) {
    const maxOrder = media.length > 0 ? Math.max(...media.map(m => m.display_order)) : 0;

    const { error } = await supabase
      .from('hero_carousel_images')
      .insert({
        image_url: url,
        media_type: newMedia.mediaType,
        storage_path: storagePath,
        title: newMedia.title || null,
        description: newMedia.description || null,
        display_order: maxOrder + 1,
        is_active: true,
      });

    if (!error) {
      setNewMedia({ file: null, url: '', title: '', description: '', mediaType: 'image' });
      setShowAddForm(false);
      loadMedia();
    } else {
      notifyError('Failed to add media: ' + error.message);
    }
  }

  async function handleAddMedia() {
    if (uploadMethod === 'file') {
      await handleFileUpload();
    } else {
      if (!newMedia.url.trim()) {
        notifyError('Please enter a URL');
        return;
      }
      await addMediaToDatabase(newMedia.url);
    }
  }

  async function updateMedia() {
    if (!editingMedia) return;

    const { error } = await supabase
      .from('hero_carousel_images')
      .update({
        title: editingMedia.title || null,
        description: editingMedia.description || null,
      })
      .eq('id', editingMedia.id);

    if (!error) {
      setEditingMedia(null);
      loadMedia();
    }
  }

  async function deleteMedia(id: string, storagePath: string | null) {
    if (!await showConfirm('Are you sure you want to delete this media?')) return;

    if (storagePath) {
      await supabase.storage
        .from('carousel-media')
        .remove([storagePath]);
    }

    const { error } = await supabase
      .from('hero_carousel_images')
      .delete()
      .eq('id', id);

    if (!error) {
      loadMedia();
      if (currentIndex >= media.length - 1) {
        setCurrentIndex(0);
      }
    }
  }

  async function moveMedia(id: string, direction: 'up' | 'down') {
    const currentMedia = media.find(m => m.id === id);
    if (!currentMedia) return;

    const targetOrder = direction === 'up'
      ? currentMedia.display_order - 1
      : currentMedia.display_order + 1;

    const targetMedia = media.find(m => m.display_order === targetOrder);
    if (!targetMedia) return;

    await supabase
      .from('hero_carousel_images')
      .update({ display_order: targetOrder })
      .eq('id', currentMedia.id);

    await supabase
      .from('hero_carousel_images')
      .update({ display_order: currentMedia.display_order })
      .eq('id', targetMedia.id);

    loadMedia();
  }

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? media.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % media.length);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    setNewMedia({
      ...newMedia,
      file,
      mediaType: isVideo ? 'video' : 'image',
    });
  };

  if (loading) {
    return (
      <div className="w-full h-96 bg-slate-200 animate-pulse flex items-center justify-center">
        <p className="text-slate-500">Loading carousel...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-96 bg-red-50 flex items-center justify-center">
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
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-slate-100 rounded-lg p-8 text-center">
            <p className="text-slate-600 mb-4">No carousel media yet. Add your first image or video!</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add First Media
            </button>
          </div>
        </section>
      );
    }
    return null;
  }

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <div className="relative">
        {isAdmin && (
          <div className="flex flex-wrap justify-end gap-2 mb-4">
            {adminControls}
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className="bg-slate-600 hover:bg-slate-700 text-white px-3 sm:px-4 py-2 rounded-lg inline-flex items-center gap-2 text-xs sm:text-sm"
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

        <div className="relative rounded-xl overflow-hidden shadow-2xl">
          <div className="relative h-96 sm:h-[500px]">
            {media.map((item, index) => (
              <div
                key={item.id}
                className={`absolute inset-0 transition-opacity duration-1000 ${
                  index === currentIndex ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {item.media_type === 'video' ? (
                  <video
                    src={item.image_url}
                    className="w-full h-full object-cover"
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                ) : (
                  <img
                    src={item.image_url}
                    alt={item.title || 'Carousel media'}
                    className="w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                {(item.title || item.description) && (
                  <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 text-white">
                    {item.title && (
                      <h3 className="text-2xl sm:text-4xl font-bold mb-2">{item.title}</h3>
                    )}
                    {item.description && (
                      <p className="text-lg sm:text-xl text-white/90">{item.description}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {media.length > 1 && (
            <>
              <button
                onClick={goToPrevious}
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white text-slate-900 p-2 rounded-full transition-all"
                aria-label="Previous slide"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                onClick={goToNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white text-slate-900 p-2 rounded-full transition-all"
                aria-label="Next slide"
              >
                <ChevronRight className="w-6 h-6" />
              </button>

              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                {media.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => goToSlide(index)}
                    className={`w-2 h-2 rounded-full transition-all ${
                      index === currentIndex
                        ? 'bg-white w-8'
                        : 'bg-white/50 hover:bg-white/75'
                    }`}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {isEditMode && (
          <div className="mt-4 space-y-2">
            {media.map((item, index) => (
              <div key={item.id} className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4">
                {item.media_type === 'video' ? (
                  <video
                    src={item.image_url}
                    className="w-24 h-16 object-cover rounded"
                    muted
                  />
                ) : (
                  <img
                    src={item.image_url}
                    alt={item.title || 'Carousel media'}
                    className="w-24 h-16 object-cover rounded"
                  />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{item.title || 'Untitled'}</p>
                    <span className="text-xs px-2 py-0.5 bg-slate-100 rounded">
                      {item.media_type}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">{item.description || 'No description'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => moveMedia(item.id, 'up')}
                    disabled={index === 0}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MoveUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveMedia(item.id, 'down')}
                    disabled={index === media.length - 1}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MoveDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setEditingMedia(item)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteMedia(item.id, item.storage_path)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">Add Carousel Media</h3>
            <div className="space-y-4">
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setUploadMethod('file')}
                  className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 ${
                    uploadMethod === 'file'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  Upload File
                </button>
                <button
                  onClick={() => setUploadMethod('url')}
                  className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 ${
                    uploadMethod === 'url'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <LinkIcon className="w-4 h-4" />
                  Use URL
                </button>
              </div>

              {uploadMethod === 'file' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Upload Image or Video
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileSelect}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                  {newMedia.file && (
                    <p className="text-sm text-slate-600 mt-2">
                      Selected: {newMedia.file.name} ({newMedia.mediaType})
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Media Type
                    </label>
                    <select
                      value={newMedia.mediaType}
                      onChange={(e) => setNewMedia({ ...newMedia, mediaType: e.target.value as 'image' | 'video' })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    >
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {newMedia.mediaType === 'video' ? 'Video URL' : 'Image URL'}
                    </label>
                    <input
                      type="text"
                      value={newMedia.url}
                      onChange={(e) => setNewMedia({ ...newMedia, url: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      placeholder={
                        newMedia.mediaType === 'video'
                          ? 'https://example.com/video.mp4'
                          : 'https://images.pexels.com/...'
                      }
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  value={newMedia.title}
                  onChange={(e) => setNewMedia({ ...newMedia, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="Birthday Parties"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={newMedia.description}
                  onChange={(e) => setNewMedia({ ...newMedia, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="Make your celebration unforgettable"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddMedia}
                  disabled={uploading || (uploadMethod === 'file' && !newMedia.file) || (uploadMethod === 'url' && !newMedia.url)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg"
                >
                  {uploading ? 'Uploading...' : 'Add Media'}
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewMedia({ file: null, url: '', title: '', description: '', mediaType: 'image' });
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingMedia && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Edit Carousel Media</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  value={editingMedia.title || ''}
                  onChange={(e) => setEditingMedia({ ...editingMedia, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={editingMedia.description || ''}
                  onChange={(e) => setEditingMedia({ ...editingMedia, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={updateMedia}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
                <button
                  onClick={() => setEditingMedia(null)}
                  className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
