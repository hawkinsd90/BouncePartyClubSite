import { useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Upload, Trash2, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { notifyError } from '../../../lib/notifications';

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
  deleteNewlyUploaded: () => Promise<boolean>;
  getUploadedImage: () => UploadedImage | null;
}

interface AdminImageUploadProps {
  folder: 'products' | 'bundles';
  ownerId: string;
  currentImageUrl: string | null;
  onImageChange: (image: UploadedImage | null, action: 'upload' | 'remove' | 'none') => void;
  label?: string;
}

export const AdminImageUpload = forwardRef<AdminImageUploadHandle, AdminImageUploadProps>(
  function AdminImageUpload(
    { folder, ownerId, currentImageUrl, onImageChange, label = 'Image' },
    ref
  ) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl);
    const [, setUploadedImage] = useState<UploadedImage | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [markedForRemoval, setMarkedForRemoval] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadedRef = useRef<UploadedImage | null>(null);

    const validateFile = (file: File): string | null => {
      if (file.size > MAX_SIZE) {
        return 'Image must be 10 MB or smaller';
      }
      if (!ALLOWED_MIME.includes(file.type)) {
        return 'Image must be PNG, JPEG, GIF, WebP, or HEIC';
      }
      return null;
    };

    useImperativeHandle(ref, () => ({
      deleteNewlyUploaded: async (): Promise<boolean> => {
        const img = uploadedRef.current;
        if (!img) return true;
        try {
          const { error } = await supabase.storage.from(BUCKET).remove([img.path]);
          if (error) {
            console.error('Failed to delete uploaded file:', error);
            return false;
          }
          uploadedRef.current = null;
          return true;
        } catch {
          return false;
        }
      },
      getUploadedImage: () => uploadedRef.current,
    }));

    const handleFileSelect = useCallback(
      async (file: File) => {
        setLocalError(null);

        const validationError = validateFile(file);
        if (validationError) {
          setLocalError(validationError);
          notifyError(validationError);
          return;
        }

        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        setIsUploading(true);

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
          uploadedRef.current = img;
          setUploadedImage(img);
          setMarkedForRemoval(false);
          onImageChange(img, 'upload');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to upload image';
          setLocalError(msg);
          notifyError(msg);
          setPreviewUrl(currentImageUrl);
          uploadedRef.current = null;
          setUploadedImage(null);
        } finally {
          setIsUploading(false);
          if (objectUrl.startsWith('blob:')) {
            URL.revokeObjectURL(objectUrl);
          }
        }
      },
      [folder, ownerId, currentImageUrl, onImageChange]
    );

    const handleRemove = useCallback(() => {
      uploadedRef.current = null;
      setUploadedImage(null);
      setPreviewUrl(null);
      setMarkedForRemoval(true);
      onImageChange(null, 'remove');
    }, [onImageChange]);

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    };

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

        {previewUrl && !markedForRemoval ? (
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
                className="p-1.5 bg-white/90 rounded-lg text-slate-700 hover:bg-white transition-colors"
                title="Replace image"
              >
                <Upload className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="p-1.5 bg-white/90 rounded-lg text-red-600 hover:bg-white transition-colors"
                title="Remove image"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="w-32 h-32 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors"
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

        {markedForRemoval && !previewUrl && (
          <button
            type="button"
            onClick={() => {
              setMarkedForRemoval(false);
              setPreviewUrl(currentImageUrl);
              onImageChange(null, 'none');
            }}
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
