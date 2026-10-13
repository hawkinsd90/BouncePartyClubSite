// Shared Event Essentials image lifecycle for ProductForm and PackageForm.
//
// Owns the pending-upload / removal state, the uploader handle ref, the busy and single-close guards, and the
// save / rollback / commit / previous-file cleanup orchestration (see eventEssentialsImageModel for the injected
// logic). The forms keep their fields, validation, entity-specific save params and call, and rendering.
// AdminImageUpload still performs the immediate upload and the pending-replacement handling.

import { useState, useRef, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { parseStoragePath } from '../../../lib/queries/products';
import { notifyWarning } from '../../../lib/toasts';
import type { AdminImageUploadHandle, UploadedImage } from './AdminImageUpload';
import {
  syncPendingImage,
  resolveSavedImageUrl,
  closeWithCleanup,
  runImageSave,
  type EntityLabel,
  type ImageAction,
  type ImageLifecycleDeps,
  type PreparedImageSave,
} from './eventEssentialsImageModel';

export interface UseEventEssentialsImageLifecycleOptions {
  entityLabel: EntityLabel;
  // The saved image URL when the form opened (`product?.image_url ?? null`); read once, like the old ref init.
  initialImageUrl: string | null;
  onClose: () => void;
}

export interface SaveWithImageArgs {
  prepared: PreparedImageSave;
  fallbackMessage: string;
  saveEntity: () => Promise<{ error: { message?: string } | null }>;
  onFailure: (message: string) => void;
  onSuccess: () => void;
}

export function useEventEssentialsImageLifecycle({
  entityLabel,
  initialImageUrl,
  onClose,
}: UseEventEssentialsImageLifecycleOptions) {
  const [imageAction, setImageAction] = useState<ImageAction>('none');
  const [newUploadedImage, setNewUploadedImage] = useState<UploadedImage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const imageUploadRef = useRef<AdminImageUploadHandle>(null);
  const prevImageUrl = useRef<string | null>(initialImageUrl);
  const closedRef = useRef(false);

  const handleImageChange = useCallback(
    (image: UploadedImage | null, action: ImageAction) => {
      setNewUploadedImage(image);
      setImageAction(action);
    },
    [],
  );

  const handleUploadStateChange = useCallback((busy: boolean) => {
    setIsUploading(busy);
  }, []);

  const isBusy = isSaving || isUploading;

  const deps: ImageLifecycleDeps = {
    getHandle: () => imageUploadRef.current,
    setNewUploadedImage,
    setImageAction,
    warn: notifyWarning,
    logError: (...args) => console.error(...args),
    removeStorageObject: (path) => supabase.storage.from('event-essentials-media').remove([path]),
    parseStoragePath,
    entityLabel,
  };

  function handleClose(): Promise<void> {
    return closeWithCleanup(deps, {
      isClosed: () => closedRef.current,
      isBusy,
      markClosed: () => {
        closedRef.current = true;
      },
      onClose,
    });
  }

  // Sync the parent image state with the uploader's pending upload, then resolve the image URL to save.
  function prepareImageForSave(currentImageUrl: string | null): PreparedImageSave {
    const childPending = imageUploadRef.current?.getUploadedImage() ?? null;
    const synced = syncPendingImage({ childPending, newUploadedImage, imageAction });
    if (synced.changed && childPending) {
      setNewUploadedImage(childPending);
      setImageAction('upload');
    }
    const { effectiveAction, effectiveImage } = synced;
    const imageUrl = resolveSavedImageUrl({ currentImageUrl, effectiveAction, effectiveImage });
    return { effectiveAction, effectiveImage, imageUrl };
  }

  function saveWithImage(args: SaveWithImageArgs): Promise<void> {
    return runImageSave(deps, {
      prepared: args.prepared,
      previousImageUrl: prevImageUrl.current,
      fallbackMessage: args.fallbackMessage,
      setIsSaving,
      saveEntity: args.saveEntity,
      onFailure: args.onFailure,
      onSuccess: args.onSuccess,
    });
  }

  return {
    imageUploadRef,
    isSaving,
    isBusy,
    handleImageChange,
    handleUploadStateChange,
    handleClose,
    prepareImageForSave,
    saveWithImage,
  };
}
