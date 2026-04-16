import { useRef } from 'react';
import { Save, Upload, Link as LinkIcon } from 'lucide-react';
import type { CarouselMedia, NewMediaState } from './carouselTypes';

interface CarouselEditFormProps {
  editingMedia: CarouselMedia;
  newMedia: NewMediaState;
  uploadMethod: 'file' | 'url';
  uploading: boolean;
  onEditingMediaChange: (media: CarouselMedia) => void;
  onNewMediaChange: (media: NewMediaState) => void;
  onUploadMethodChange: (method: 'file' | 'url') => void;
  onSave: () => void;
  onCancel: () => void;
}

export function CarouselEditForm({
  editingMedia,
  newMedia,
  uploadMethod,
  uploading,
  onEditingMediaChange,
  onNewMediaChange,
  onUploadMethodChange,
  onSave,
  onCancel,
}: CarouselEditFormProps) {
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
        <h3 className="text-xl font-bold mb-4">Edit Carousel Media</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Current Media
            </label>
            {editingMedia.media_type === 'video' ? (
              <video
                src={editingMedia.image_url}
                className="w-full h-32 object-cover rounded-lg"
                muted
              />
            ) : (
              <img
                src={editingMedia.image_url}
                alt={editingMedia.title || 'Current media'}
                className="w-full h-32 object-cover rounded-lg"
              />
            )}
          </div>

          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Replace Media (Optional)
            </label>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => onUploadMethodChange('file')}
                className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-sm ${
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
                className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-sm ${
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileSelect}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                {newMedia.file && (
                  <p className="text-sm text-slate-600 mt-2">
                    Selected: {newMedia.file.name} ({newMedia.mediaType})
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="mb-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Media Type
                  </label>
                  <select
                    value={newMedia.mediaType}
                    onChange={(e) => onNewMediaChange({ ...newMedia, mediaType: e.target.value as 'image' | 'video' })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </div>
                <div>
                  <input
                    type="text"
                    value={newMedia.url}
                    onChange={(e) => onNewMediaChange({ ...newMedia, url: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    placeholder={
                      newMedia.mediaType === 'video'
                        ? 'https://example.com/video.mp4'
                        : 'https://images.pexels.com/...'
                    }
                  />
                </div>
              </>
            )}
          </div>

          <div className="border-t pt-4">
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Title (Optional)
              </label>
              <input
                type="text"
                value={editingMedia.title || ''}
                onChange={(e) => onEditingMediaChange({ ...editingMedia, title: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Description (Optional)
              </label>
              <input
                type="text"
                value={editingMedia.description || ''}
                onChange={(e) => onEditingMediaChange({ ...editingMedia, description: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={uploading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg inline-flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {uploading ? 'Saving...' : 'Save Changes'}
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
