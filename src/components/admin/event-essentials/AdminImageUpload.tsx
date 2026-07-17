import { useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Upload, Trash2, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { notifyError, notifyWarning } from '../../../lib/notifications';

const BUCKET = 'event-essentials-media';
const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
];

export interface UploadedImage {
  url: string;
  path: string;
}

export interface AdminImageUploadHandle {
  /** Delete the current pending unsaved upload. Returns true if deleted or none existed. */
  deleteNewlyUploaded: () => Promise<boolean>;
  /** Get the current pending upload (null if none). */
  getUploadedImage: () => UploadedImage | null;
  /** Mark the pending upload as saved — clears rollback ref without deleting storage. */
  commitUploadedImage: () => void;
  /** Whether an upload is currently in progress. */
  isBusy: () => boolean;
}

interface AdminImageUploadProps {
  folder: 'products' | 'bundles';
  ownerId: string;
  currentImageUrl: string | null;
  onImageChange: (image: UploadedImage | null, action: 'upload' | 'remove' | 'none') => void;
  onUploadStateChange?: (isUploading: boolean) => void;
  label?: string;
}

export const AdminImageUpload = forwardRef<AdminImageUploadHandle, AdminImageUploadProps>(
  function AdminImageUpload(
    { folder, ownerId, currentImageUrl, onImageChange, onUploadStateChange, label = 'Image' },
    ref
  ) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl);
    const [isUploading, setIsUploading] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [markedForRemoval, setMarkedForRemoval] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Refs for storage lifecycle
    const uploadedRef = useRef<UploadedImage | null>(null);
    const activeBlobRef = useRef<string | null>(null);
    const isUploadingRef = useRef(false);

    const revokeActiveBlob = useCallback(() => {
      if (activeBlobRef.current) {
        URL.revokeObjectURL(activeBlobRef.current);
        activeBlobRef.current = null;
      }
    }, []);

    const deleteFromStorage = useCallback(async (path: string): Promise<boolean> => {
      try {
        const { error } = await supabase.storage.from(BUCKET).remove([path]);
        if (error) {
          console.error('Failed to delete storage file:', error.message);
          return false;
        }
        return true;
      } catch (err) {
        console.error('Failed to delete storage file:', err);
        return false;
      }
    }, []);

    const setUploadState = useCallback(
      (busy: boolean) => {
        isUploadingRef.current = busy;
        setIsUploading(busy);
        onUploadStateChange?.(busy);
      },
      [onUploadStateChange]
    );

    useImperativeHandle(ref, () => ({
      deleteNewlyUploaded: async (): Promise<boolean> => {
        const img = uploadedRef.current;
        if (!img) return true;
        const ok = await deleteFromStorage(img.path);
        if (ok) {
          uploadedRef.current = null;
        } else {
          notifyWarning('Failed to clean up an uploaded image. The orphaned file may need manual removal.');
        }
        return ok;
      },
      getUploadedImage: () => uploadedRef.current,
      commitUploadedImage: () => {
        uploadedRef.current = null;
      },
      isBusy: () => isUploadingRef.current,
    }));

    const handleFileSelect = useCallback(
      async (file: File) => {
        setLocalError(null);

        const validationError =
          file.size > MAX_SIZE
            ? 'Image must be 10 MB or smaller'
            : !ALLOWED_MIME.includes(file.type)
              ? 'Image must be PNG, JPEG, GIF, WebP, or HEIC'
              : null;

        if (validationError) {
          setLocalError(validationError);
          notifyError(validationError);
          return;
        }

        // Revoke any prior blob before creating a new one
        revokeActiveBlob();

        const objectUrl = URL.createObjectURL(file);
        activeBlobRef.current = objectUrl;
        setPreviewUrl(objectUrl);
        setMarkedForRemoval(false);
        setUploadState(true);

        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const path = `${folder}/${ownerId}/${timestamp}-${random}.${ext}`;

        try {
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, file, { contentType: file.type });

          if (uploadError) {
            throw new Error(uploadError.message || 'Upload failed');
          }

          const { data: urlData } = supabase.storage
            .from(BUCKET)
            .getPublicUrl(path);

          const img: UploadedImage = { url: urlData.publicUrl, path };

          // If there was a previous unsaved upload, delete it now
          const prevUpload = uploadedRef.current;
          if (prevUpload) {
            const deleted = await deleteFromStorage(prevUpload.path);
            if (!deleted) {
              notifyWarning('Could not delete the previous unsaved image. It may need manual cleanup.');
            }
          }

          uploadedRef.current = img;

          // Swap preview from blob to the real public URL, then revoke blob
          setPreviewUrl(img.url);
          revokeActiveBlob();

          onImageChange(img, 'upload');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to upload image';
          setLocalError(msg);
          notifyError(msg);
          // Restore prior preview state
          revokeActiveBlob();
          setPreviewUrl(currentImageUrl);
          setMarkedForRemoval(false);
        } finally {
          setUploadState(false);
        }
      },
      [folder, ownerId, currentImageUrl, onImageChange, deleteFromStorage, revokeActiveBlob, setUploadState]
    );

    const handleRemove = useCallback(async () => {
      // If we have a pending unsaved upload, delete it from storage
      const img = uploadedRef.current;
      if (img) {
        const ok = await deleteFromStorage(img.path);
        if (!ok) {
          notifyWarning('Failed to delete the uploaded image file. It may need manual removal.');
        }
        uploadedRef.current = null;
      }

      revokeActiveBlob();
      setPreviewUrl(null);
      setMarkedForRemoval(true);
      onImageChange(null, 'remove');
    }, [deleteFromStorage, revokeActiveBlob, onImageChange]);

    const handleUndo = useCallback(() => {
      revokeActiveBlob();
      setMarkedForRemoval(false);
      setPreviewUrl(currentImageUrl);
      onImageChange(null, 'none');
    }, [currentImageUrl, onImageChange, revokeActiveBlob]);

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    };

    const showPreview = previewUrl && !markedForRemoval;

    return (
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">{label}</label>
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_MIME.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = '';
          }}
        />

        {showPreview ? (
          <div className="relative group">
            <img
              src={previewUrl}
              alt="Preview"
              className="w-32 h-32 object-cover rounded-lg border border-slate-200"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-1.5 bg-white/90 rounded-lg text-slate-700 hover:bg-white transition-colors disabled:opacity-50"
                title="Replace image"
              >
                <Upload className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={isUploading}
                className="p-1.5 bg-white/90 rounded-lg text-red-600 hover:bg-white transition-colors disabled:opacity-50"
                title="Remove image"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => !isUploading && fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={`w-32 h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors ${
              isUploading
                ? 'border-slate-300 cursor-wait'
                : 'border-slate-300 cursor-pointer hover:border-blue-500 hover:bg-blue-50'
            }`}
          >
            {isUploading ? (
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
            ) : (
              <>
                <ImageIcon className="w-8 h-8 text-slate-400 mb-1" />
                <span className="text-xs text-slate-500 text-center px-2">Click or drop image</span>
              </>
            )}
          </div>
        )}

        {localError && (
          <div className="mt-2 flex items-center gap-1.5 text-sm text-red-600">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{localError}</span>
          </div>
        )}

        {markedForRemoval && !showPreview && (
          <button
            type="button"
            onClick={handleUndo}
            className="mt-2 text-xs text-blue-600 hover:underline"
          >
            Undo removal
          </button>
        )}

        <p className="mt-1 text-xs text-slate-400">Max 10 MB. PNG, JPEG, GIF, WebP, HEIC.</p>
      </div>
    );
  }
);
