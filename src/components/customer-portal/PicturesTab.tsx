import { useState } from 'react';
import { Upload, X, Image as ImageIcon } from 'lucide-react';

interface ExistingPicture {
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);

    const validFiles = files.filter(file => {
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name} is too large. Maximum file size is 10MB.`);
        return false;
      }
      return true;
    });

    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrls(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });

    setSelectedFiles(prev => [...prev, ...validFiles]);
  }

  function handleRemoveImage(index: number) {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(selectedFiles, pictureNotes);
      setSelectedFiles([]);
      setPreviewUrls([]);
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
            Upload Pictures {selectedFiles.length > 0 && <span className="text-slate-500">({selectedFiles.length} selected)</span>}
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

        {previewUrls.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
            {previewUrls.map((url, idx) => (
              <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-300 group">
                <img src={url} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(idx)}
                  className="absolute top-2 right-2 bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  aria-label="Remove image"
                >
                  <X className="w-4 h-4" />
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
          disabled={submitting || selectedFiles.length === 0}
          className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <Upload className="w-5 h-5" />
          {submitting ? 'Uploading...' : 'Submit Pictures'}
        </button>
      </div>
    </div>
  );
}
