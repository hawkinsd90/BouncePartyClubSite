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
  /** Reset preview to currentImageUrl and clear pending state. Called after RPC rollback. */
  resetToCurrentImage: () => void;
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
          console.error('Failed to delete storage file:', path, error.message);
          return false;
        }
        return true;
      } catch (err) {
        console.error('Failed to delete storage file:', path, err);
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
        // Block concurrent cleanup: if another operation is running, wait for it
        // to finish rather than starting a duplicate deletion of the same path.
        if (isUploadingRef.current) {
          // Operation in progress — uploadedRef may be mutated by it.
          // Surface a warning via the parent path instead of racing.
          notifyWarning(
            'Another image operation is in progress. Please wait for it to finish before closing.'
          );
          return false;
        }
        setUploadState(true);
        try {
          const ok = await deleteFromStorage(img.path);
          if (ok) {
            uploadedRef.current = null;
          } else {
            // Parent (cleanupPendingUpload) reports its own warning on false.
          }
          return ok;
        } finally {
          setUploadState(false);
        }
      },
      getUploadedImage: () => uploadedRef.current,
      commitUploadedImage: () => {
        uploadedRef.current = null;
      },
      isBusy: () => isUploadingRef.current,
      resetToCurrentImage: () => {
        revokeActiveBlob();
        uploadedRef.current = null;
        setMarkedForRemoval(false);
        setPreviewUrl(currentImageUrl);
      },
    }));

    const handleFileSelect = useCallback(
      async (file: File) => {
        // Block concurrent file selection — state updates are async, so use the ref.
        if (isUploadingRef.current) return;

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

        const priorUpload = uploadedRef.current;

        // Enter busy state before ANY storage operation, including deleting A.
        setUploadState(true);

        try {
          // If a pending unsaved image A already exists, delete A BEFORE uploading B.
          if (priorUpload) {
            const aDeleted = await deleteFromStorage(priorUpload.path);
            if (!aDeleted) {
              // Abort — keep A pending and visible, do not upload B.
              notifyWarning(
                'Could not delete the previous unsaved image. The new selection was cancelled — please retry.'
              );
              // A remains pending; re-affirm parent state.
              onImageChange(priorUpload, 'upload');
              return;
            }
            // A deleted successfully — clear A from child and parent state before uploading B.
            uploadedRef.current = null;
            onImageChange(null, 'none');
          }

          revokeActiveBlob();

          const objectUrl = URL.createObjectURL(file);
          activeBlobRef.current = objectUrl;
          setPreviewUrl(objectUrl);
          setMarkedForRemoval(false);

          const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
          const timestamp = Date.now();
          const random = Math.random().toString(36).substring(2, 8);
          const path = `${folder}/${ownerId}/${timestamp}-${random}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, file, { contentType: file.type });

          if (uploadError) {
            throw new Error(uploadError.message || 'Upload failed');
          }

          const { data: urlData } = supabase.storage
            .from(BUCKET)
            .getPublicUrl(path);

          const newImg: UploadedImage = { url: urlData.publicUrl, path };

          // B is the only pending upload
          uploadedRef.current = newImg;

          // Swap preview from blob to the real public URL, then revoke blob
          setPreviewUrl(newImg.url);
          revokeActiveBlob();

          onImageChange(newImg, 'upload');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to upload image';
          setLocalError(msg);
          notifyError(msg);

          // B upload failed — no pending files remain (A was already deleted)
          revokeActiveBlob();
          setPreviewUrl(currentImageUrl);
          setMarkedForRemoval(false);
          onImageChange(null, 'none');
        } finally {
          setUploadState(false);
        }
      },
      [folder, ownerId, currentImageUrl, onImageChange, deleteFromStorage, revokeActiveBlob, setUploadState]
    );

    const handleRemove = useCallback(async () => {
      // Block concurrent removal.
      if (isUploadingRef.current) return;

      const pendingImg = uploadedRef.current;

      if (pendingImg) {
        // Removing a pending unsaved upload — enter busy state before deleting.
        setUploadState(true);
        try {
          const ok = await deleteFromStorage(pendingImg.path);
          if (!ok) {
            // Deletion failed — keep pending image visible, keep uploadedRef,
            // keep parent action pointing to this pending image as 'upload'.
            // Do NOT restore currentImageUrl. Do NOT call onImageChange(null, 'none').
            notifyWarning(
              'Failed to delete the uploaded image. Removal did not complete — you can retry.'
            );
            // Re-affirm parent state points to the pending upload
            onImageChange(pendingImg, 'upload');
            return;
          }

          // Deletion succeeded — restore existing image or empty state, reset action
          uploadedRef.current = null;
          revokeActiveBlob();
          setPreviewUrl(currentImageUrl);
          setMarkedForRemoval(false);
          onImageChange(null, 'none');
        } finally {
          setUploadState(false);
        }
      } else {
        // Removing the existing saved image itself — no storage deletion, synchronous.
        revokeActiveBlob();
        setPreviewUrl(null);
        setMarkedForRemoval(true);
        onImageChange(null, 'remove');
      }
    }, [deleteFromStorage, revokeActiveBlob, onImageChange, currentImageUrl, setUploadState]);

    const handleUndo = useCallback(() => {
      if (isUploadingRef.current) return;
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
      // Block drag/drop while busy — do not bypass the disabled click controls.
      if (isUploadingRef.current) return;
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
            disabled={isUploading}
            className="mt-2 text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            Undo removal
          </button>
        )}

        <p className="mt-1 text-xs text-slate-400">Max 10 MB. PNG, JPEG, GIF, WebP, HEIC.</p>
      </div>
    );
  }
);
