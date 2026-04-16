import { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { notifyError, showConfirm } from '../../../lib/notifications';
import type { CarouselMedia, NewMediaState } from './carouselTypes';

const EMPTY_NEW_MEDIA: NewMediaState = {
  file: null,
  url: '',
  title: '',
  description: '',
  mediaType: 'image',
};

export function useCarouselData() {
  const [media, setMedia] = useState<CarouselMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadMedia() {
    try {
      setLoading(true);
      setError(null);

      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/hero_carousel_images?is_active=eq.true&order=display_order`;

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout after 10 seconds')), 10000)
      );

      const fetchPromise = fetch(url, {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      }).then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.message || `HTTP ${res.status}`);
        }
        return data;
      });

      const data = await Promise.race([fetchPromise, timeoutPromise]) as any;

      if (data && !Array.isArray(data)) {
        console.error('[Carousel] Response is not an array:', data);
        setError(`Error: ${data?.message || 'Invalid response format'}`);
        setMedia([]);
        setLoading(false);
        return;
      }

      if (data && Array.isArray(data)) {
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
      } else {
        setMedia([]);
      }
      setLoading(false);
    } catch (err) {
      console.error('[Carousel] Exception loading carousel:', err);
      setError(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      setMedia([]);
      setLoading(false);
    }
  }

  async function handleFileUpload(newMedia: NewMediaState, onSuccess: () => void) {
    if (!newMedia.file) return;

    const fileExt = newMedia.file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('carousel-media')
      .upload(filePath, newMedia.file);

    if (uploadError) {
      notifyError('Failed to upload file: ' + uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage
      .from('carousel-media')
      .getPublicUrl(filePath);

    await addMediaToDatabase(newMedia, urlData.publicUrl, filePath);
    onSuccess();
  }

  async function addMediaToDatabase(newMedia: NewMediaState, url: string, filePath?: string) {
    const maxOrder = media.length > 0 ? Math.max(...media.map(m => m.display_order)) : 0;

    const { error } = await supabase
      .from('hero_carousel_images')
      .insert({
        image_url: url,
        storage_path: filePath || null,
        media_type: newMedia.mediaType,
        title: newMedia.title || null,
        description: newMedia.description || null,
        display_order: maxOrder + 1,
        is_active: true,
      });

    if (!error) {
      loadMedia();
    } else {
      notifyError('Failed to add media: ' + error.message);
    }
  }

  async function updateMedia(editingMedia: CarouselMedia, newMedia: NewMediaState) {
    let imageUrl = editingMedia.image_url;
    let storagePath = editingMedia.storage_path;

    if (newMedia.file || newMedia.url) {
      if (editingMedia.storage_path) {
        await supabase.storage
          .from('carousel-media')
          .remove([editingMedia.storage_path]);
      }

      if (newMedia.file) {
        const fileExt = newMedia.file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('carousel-media')
          .upload(filePath, newMedia.file);

        if (uploadError) {
          notifyError('Failed to upload file: ' + uploadError.message);
          return false;
        }

        const { data: urlData } = supabase.storage
          .from('carousel-media')
          .getPublicUrl(filePath);

        imageUrl = urlData.publicUrl;
        storagePath = filePath;
      } else if (newMedia.url) {
        imageUrl = newMedia.url;
        storagePath = null;
      }
    }

    const { error } = await supabase
      .from('hero_carousel_images')
      .update({
        image_url: imageUrl,
        storage_path: storagePath,
        media_type: newMedia.file || newMedia.url ? newMedia.mediaType : editingMedia.media_type,
        title: editingMedia.title || null,
        description: editingMedia.description || null,
      })
      .eq('id', editingMedia.id);

    if (!error) {
      loadMedia();
      return true;
    }
    return false;
  }

  async function deleteMedia(id: string, storagePath: string | null, currentIndex: number, onIndexReset: () => void) {
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
        onIndexReset();
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

  return {
    media,
    loading,
    error,
    loadMedia,
    handleFileUpload,
    addMediaToDatabase,
    updateMedia,
    deleteMedia,
    moveMedia,
    EMPTY_NEW_MEDIA,
  };
}
