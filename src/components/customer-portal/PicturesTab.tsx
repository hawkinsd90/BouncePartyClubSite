import { useState } from 'react';
import { Upload, X } from 'lucide-react';

interface PicturesTabProps {
  onSubmit: (images: string[], notes: string) => Promise<void>;
}

export function PicturesTab({ onSubmit }: PicturesTabProps) {
  const [pictureNotes, setPictureNotes] = useState('');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedImages(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  }

  function handleRemoveImage(index: number) {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(uploadedImages, pictureNotes);
      setUploadedImages([]);
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

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Upload Pictures {uploadedImages.length > 0 && <span className="text-slate-500">({uploadedImages.length} selected)</span>}
        </label>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageUpload}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        <p className="text-xs text-slate-500 mt-1">
          You can select multiple images at once
        </p>
      </div>

      {uploadedImages.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {uploadedImages.map((img, idx) => (
            <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-300 group">
              <img src={img} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
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

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Notes (Optional)
        </label>
        <textarea
          value={pictureNotes}
          onChange={(e) => setPictureNotes(e.target.value)}
          placeholder="Any concerns or notes about the setup area..."
          className="w-full px-4 py-2 border border-slate-300 rounded-lg resize-none"
          rows={4}
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || uploadedImages.length === 0}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        <Upload className="w-5 h-5" />
        {submitting ? 'Submitting...' : 'Submit Pictures'}
      </button>
    </div>
  );
}
