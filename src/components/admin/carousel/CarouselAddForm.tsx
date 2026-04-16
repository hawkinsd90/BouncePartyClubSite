import { useRef } from 'react';
import { Upload, Link as LinkIcon } from 'lucide-react';
import type { NewMediaState } from './carouselTypes';

interface CarouselAddFormProps {
  newMedia: NewMediaState;
  uploadMethod: 'file' | 'url';
  uploading: boolean;
  onNewMediaChange: (media: NewMediaState) => void;
  onUploadMethodChange: (method: 'file' | 'url') => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function CarouselAddForm({
  newMedia,
  uploadMethod,
  uploading,
  onNewMediaChange,
  onUploadMethodChange,
  onSubmit,
  onCancel,
}: CarouselAddFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    onNewMediaChange({ ...newMedia, file, mediaType: isVideo ? 'video' : 'image' });
  };

  const handleCancel = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold mb-4">Add Carousel Media</h3>
        <div className="space-y-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => onUploadMethodChange('file')}
              className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 ${
                uploadMethod === 'file'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload File
            </button>
            <button
              onClick={() => onUploadMethodChange('url')}
              className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 ${
                uploadMethod === 'url'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <LinkIcon className="w-4 h-4" />
              Use URL
            </button>
          </div>

          {uploadMethod === 'file' ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Upload Image or Video
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleFileSelect}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              {newMedia.file && (
                <p className="text-sm text-slate-600 mt-2">
                  Selected: {newMedia.file.name} ({newMedia.mediaType})
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Media Type
                </label>
                <select
                  value={newMedia.mediaType}
                  onChange={(e) => onNewMediaChange({ ...newMedia, mediaType: e.target.value as 'image' | 'video' })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {newMedia.mediaType === 'video' ? 'Video URL' : 'Image URL'}
                </label>
                <input
                  type="text"
                  value={newMedia.url}
                  onChange={(e) => onNewMediaChange({ ...newMedia, url: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder={
                    newMedia.mediaType === 'video'
                      ? 'https://example.com/video.mp4'
                      : 'https://images.pexels.com/...'
                  }
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Title (Optional)
            </label>
            <input
              type="text"
              value={newMedia.title}
              onChange={(e) => onNewMediaChange({ ...newMedia, title: e.target.value })}
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
              value={newMedia.description}
              onChange={(e) => onNewMediaChange({ ...newMedia, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              placeholder="Make your celebration unforgettable"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={onSubmit}
              disabled={uploading || (uploadMethod === 'file' && !newMedia.file) || (uploadMethod === 'url' && !newMedia.url)}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg"
            >
              {uploading ? 'Uploading...' : 'Add Media'}
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
