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

      const { data, error: queryError } = await supabase
        .from('hero_carousel_images')
        .select('id, image_url, title, description, media_type, storage_path, display_order, is_active')
        .eq('is_active', true)
        .order('display_order');

      if (queryError) {
        console.error('[Carousel] Error loading carousel:', queryError);
        setError(`Error: ${queryError.message}`);
        setMedia([]);
        setLoading(false);
        return;
      }

      if (data && Array.isArray(data)) {
        // Resolve storage_path → public URL for items stored in the bucket.
        // For externally-hosted URLs (no storage_path) image_url is used as-is.
        const mediaWithUrls = data.map((item: any) => {
          if (item.storage_path) {
            const { data: urlData } = supabase.storage
              .from('carousel-media')
              .getPublicUrl(item.storage_path);
            return { ...item, image_url: urlData.publicUrl };
          }
          return item;
        });
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

    const inserted = await addMediaToDatabase(newMedia, urlData.publicUrl, filePath);
    if (inserted) {
      onSuccess();
    } else {
      await supabase.storage.from('carousel-media').remove([filePath]);
    }
  }

  async function addMediaToDatabase(newMedia: NewMediaState, url: string, filePath?: string): Promise<boolean> {
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
      return true;
    } else {
      notifyError('Failed to add media: ' + error.message);
      return false;
    }
  }

  async function updateMedia(editingMedia: CarouselMedia, newMedia: NewMediaState) {
    let imageUrl = editingMedia.image_url;
    let storagePath = editingMedia.storage_path;
    let newlyUploadedPath: string | null = null;

    if (newMedia.file || newMedia.url) {
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
        newlyUploadedPath = filePath;
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

    if (error) {
      if (newlyUploadedPath) {
        await supabase.storage.from('carousel-media').remove([newlyUploadedPath]);
      }
      return false;
    }

    if (editingMedia.storage_path && editingMedia.storage_path !== storagePath) {
      await supabase.storage
        .from('carousel-media')
        .remove([editingMedia.storage_path]);
    }

    loadMedia();
    return true;
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
