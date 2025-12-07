import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronLeft, ChevronRight, Plus, Trash2, Edit2, Save, X, MoveUp, MoveDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface CarouselImage {
  id: string;
  image_url: string;
  title: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

export function HeroCarousel() {
  const { role } = useAuth();
  const [images, setImages] = useState<CarouselImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingImage, setEditingImage] = useState<CarouselImage | null>(null);
  const [newImage, setNewImage] = useState({ image_url: '', title: '', description: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadImages();
  }, []);

  useEffect(() => {
    if (images.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [images.length]);

  async function loadImages() {
    setLoading(true);
    const { data, error } = await supabase
      .from('hero_carousel_images')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (!error && data) {
      setImages(data);
    }
    setLoading(false);
  }

  async function addImage() {
    if (!newImage.image_url.trim()) return;

    const maxOrder = images.length > 0 ? Math.max(...images.map(img => img.display_order)) : 0;

    const { error } = await supabase
      .from('hero_carousel_images')
      .insert({
        image_url: newImage.image_url,
        title: newImage.title || null,
        description: newImage.description || null,
        display_order: maxOrder + 1,
        is_active: true,
      });

    if (!error) {
      setNewImage({ image_url: '', title: '', description: '' });
      setShowAddForm(false);
      loadImages();
    }
  }

  async function updateImage() {
    if (!editingImage) return;

    const { error } = await supabase
      .from('hero_carousel_images')
      .update({
        image_url: editingImage.image_url,
        title: editingImage.title || null,
        description: editingImage.description || null,
      })
      .eq('id', editingImage.id);

    if (!error) {
      setEditingImage(null);
      loadImages();
    }
  }

  async function deleteImage(id: string) {
    if (!confirm('Are you sure you want to delete this image?')) return;

    const { error } = await supabase
      .from('hero_carousel_images')
      .delete()
      .eq('id', id);

    if (!error) {
      loadImages();
      if (currentIndex >= images.length - 1) {
        setCurrentIndex(0);
      }
    }
  }

  async function moveImage(id: string, direction: 'up' | 'down') {
    const currentImage = images.find(img => img.id === id);
    if (!currentImage) return;

    const targetOrder = direction === 'up'
      ? currentImage.display_order - 1
      : currentImage.display_order + 1;

    const targetImage = images.find(img => img.display_order === targetOrder);
    if (!targetImage) return;

    await supabase
      .from('hero_carousel_images')
      .update({ display_order: targetOrder })
      .eq('id', currentImage.id);

    await supabase
      .from('hero_carousel_images')
      .update({ display_order: currentImage.display_order })
      .eq('id', targetImage.id);

    loadImages();
  }

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  if (loading) {
    return (
      <div className="w-full h-96 bg-slate-200 animate-pulse flex items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  if (images.length === 0 && role !== 'ADMIN') {
    return null;
  }

  if (images.length === 0 && role === 'ADMIN') {
    return (
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-slate-100 rounded-lg p-8 text-center">
          <p className="text-slate-600 mb-4">No carousel images yet. Add your first image!</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add First Image
          </button>
          {showAddForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-6 max-w-md w-full">
                <h3 className="text-xl font-bold mb-4">Add Carousel Image</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Image URL
                    </label>
                    <input
                      type="text"
                      value={newImage.image_url}
                      onChange={(e) => setNewImage({ ...newImage, image_url: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      placeholder="https://images.pexels.com/..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Title (Optional)
                    </label>
                    <input
                      type="text"
                      value={newImage.title}
                      onChange={(e) => setNewImage({ ...newImage, title: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Description (Optional)
                    </label>
                    <input
                      type="text"
                      value={newImage.description}
                      onChange={(e) => setNewImage({ ...newImage, description: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={addImage}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                    >
                      Add Image
                    </button>
                    <button
                      onClick={() => setShowAddForm(false)}
                      className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <div className="relative">
        {role === 'ADMIN' && (
          <div className="flex justify-end gap-2 mb-4">
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2 text-sm"
            >
              {isEditMode ? <X className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
              {isEditMode ? 'Exit Edit Mode' : 'Edit Carousel'}
            </button>
            {isEditMode && (
              <button
                onClick={() => setShowAddForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center gap-2 text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Image
              </button>
            )}
          </div>
        )}

        <div className="relative rounded-xl overflow-hidden shadow-2xl">
          <div className="relative h-96 sm:h-[500px]">
            {images.map((image, index) => (
              <div
                key={image.id}
                className={`absolute inset-0 transition-opacity duration-1000 ${
                  index === currentIndex ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <img
                  src={image.image_url}
                  alt={image.title || 'Carousel image'}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                {(image.title || image.description) && (
                  <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 text-white">
                    {image.title && (
                      <h3 className="text-2xl sm:text-4xl font-bold mb-2">{image.title}</h3>
                    )}
                    {image.description && (
                      <p className="text-lg sm:text-xl text-white/90">{image.description}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {images.length > 1 && (
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
                {images.map((_, index) => (
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
            {images.map((image, index) => (
              <div key={image.id} className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4">
                <img
                  src={image.image_url}
                  alt={image.title || 'Carousel image'}
                  className="w-24 h-16 object-cover rounded"
                />
                <div className="flex-1">
                  <p className="font-medium">{image.title || 'Untitled'}</p>
                  <p className="text-sm text-slate-500">{image.description || 'No description'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => moveImage(image.id, 'up')}
                    disabled={index === 0}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MoveUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveImage(image.id, 'down')}
                    disabled={index === images.length - 1}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MoveDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setEditingImage(image)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteImage(image.id)}
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
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Add Carousel Image</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Image URL
                </label>
                <input
                  type="text"
                  value={newImage.image_url}
                  onChange={(e) => setNewImage({ ...newImage, image_url: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="https://images.pexels.com/..."
                />
                <p className="text-xs text-slate-500 mt-1">Use Pexels or other stock photo URLs</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  value={newImage.title}
                  onChange={(e) => setNewImage({ ...newImage, title: e.target.value })}
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
                  value={newImage.description}
                  onChange={(e) => setNewImage({ ...newImage, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="Make your celebration unforgettable"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addImage}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                >
                  Add Image
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewImage({ image_url: '', title: '', description: '' });
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

      {editingImage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Edit Carousel Image</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Image URL
                </label>
                <input
                  type="text"
                  value={editingImage.image_url}
                  onChange={(e) => setEditingImage({ ...editingImage, image_url: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  value={editingImage.title || ''}
                  onChange={(e) => setEditingImage({ ...editingImage, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={editingImage.description || ''}
                  onChange={(e) => setEditingImage({ ...editingImage, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={updateImage}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
                <button
                  onClick={() => setEditingImage(null)}
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
