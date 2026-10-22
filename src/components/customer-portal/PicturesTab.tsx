import { useEffect, useRef, useState } from 'react';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { addPendingPhotos, releaseAll, removePendingPhoto, type PendingPhoto } from '../../lib/portal/pendingPhotos';
import { notifyError } from '../../lib/toasts';

export interface ExistingPicture {
  id: string;
  file_path: string;
  file_name: string;
  url: string;
  notes?: string | null;
  created_at?: string;
}

interface PicturesTabProps {
  onSubmit: (files: File[], notes: string) => Promise<void>;
  existingPictures?: ExistingPicture[];
}

export function PicturesTab({ onSubmit, existingPictures = [] }: PicturesTabProps) {
  const [pictureNotes, setPictureNotes] = useState('');
  // One record per picked photo (file + its own preview), removed by id: see lib/portal/pendingPhotos.ts.
  const [selected, setSelected] = useState<PendingPhoto[]>([]);
  const selectedRef = useRef<PendingPhoto[]>([]);
  selectedRef.current = selected;
  const [submitting, setSubmitting] = useState(false);

  // Preview URLs are released when the tab goes away.
  useEffect(() => () => releaseAll(selectedRef.current, (u) => URL.revokeObjectURL(u)), []);

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const result = addPendingPhotos(selected, files, { createUrl: (f) => URL.createObjectURL(f), newId: () => crypto.randomUUID() });
    if (result.tooLarge.length > 0) notifyError(`${result.tooLarge.join(', ')} ${result.tooLarge.length === 1 ? 'is' : 'are'} too large. Maximum file size is 10MB.`);
    if (result.notImages.length > 0) notifyError(`${result.notImages.join(', ')} ${result.notImages.length === 1 ? 'is' : 'are'} not a picture.`);
    setSelected(result.items);
    // let the same file be picked again after removing it
    e.target.value = '';
  }

  function handleRemoveImage(id: string) {
    setSelected((prev) => removePendingPhoto(prev, id, (u) => URL.revokeObjectURL(u)));
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(selected.map((p) => p.file), pictureNotes);
      releaseAll(selected, (u) => URL.revokeObjectURL(u));
      setSelected([]);
      setPictureNotes('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>Optional:</strong> Upload pictures of the setup area or any concerns you have about the equipment condition.
        </p>
      </div>

      {existingPictures.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="w-4 h-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-700">
              Your Uploaded Pictures ({existingPictures.length})
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {existingPictures.map((pic) => (
              <div key={pic.id} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                <img
                  src={pic.url}
                  alt={pic.file_name}
                  className="w-full h-full object-cover"
                />
                {pic.notes && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs px-2 py-1 truncate">
                    {pic.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Add More Pictures</h3>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Upload Pictures {selected.length > 0 && <span className="text-slate-500">({selected.length} selected)</span>}
          </label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <p className="text-xs text-slate-500 mt-1">
            You can select multiple images at once (max 10MB per image)
          </p>
        </div>

        {selected.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
            {selected.map((p, idx) => (
              <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden border border-slate-300">
                <img src={p.url} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
                {/* Always visible: a touch screen has no hover. */}
                <button
                  type="button"
                  onClick={() => handleRemoveImage(p.id)}
                  className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white rounded-full w-11 h-11 flex items-center justify-center shadow-lg"
                  aria-label={`Remove picture ${idx + 1}`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Notes (Optional)
          </label>
          <textarea
            value={pictureNotes}
            onChange={(e) => setPictureNotes(e.target.value)}
            placeholder="Any concerns or notes about the setup area..."
            className="w-full px-4 py-2 border border-slate-300 rounded-lg resize-none"
            rows={3}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || selected.length === 0}
          className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <Upload className="w-5 h-5" />
          {submitting ? 'Uploading...' : 'Submit Pictures'}
        </button>
      </div>
    </div>
  );
}
