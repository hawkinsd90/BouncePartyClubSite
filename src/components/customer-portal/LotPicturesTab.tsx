import { useState, useEffect } from 'react';
import { Upload, Image as ImageIcon, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notifyError, notifySuccess } from '../../lib/notifications';

interface LotPicturesTabProps {
  orderId: string;
  orderNumber: string;
}

interface LotPicture {
  id: string;
  file_path: string;
  file_name: string;
  notes: string | null;
  uploaded_at: string;
}

export function LotPicturesTab({ orderId }: LotPicturesTabProps) {
  const [pictures, setPictures] = useState<LotPicture[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadPictures();
  }, [orderId]);

  const loadPictures = async () => {
    try {
      const { data, error } = await supabase
        .from('order_lot_pictures' as any)
        .select('*')
        .eq('order_id', orderId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setPictures((data as any) || []);
    } catch (error: any) {
      console.error('Error loading lot pictures:', error);
      notifyError('Failed to load pictures');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          throw new Error(`${file.name} is not an image file`);
        }

        // Validate file size (10MB max)
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${file.name} is too large (max 10MB)`);
        }

        // Create unique file name
        const fileExt = file.name.split('.').pop();
        const fileName = `${orderId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('lot-pictures')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // Save record to database
        const { error: dbError } = await supabase
          .from('order_lot_pictures' as any)
          .insert({
            order_id: orderId,
            file_path: fileName,
            file_name: file.name,
          });

        if (dbError) {
          // Clean up uploaded file if database insert fails
          await supabase.storage.from('lot-pictures').remove([fileName]);
          throw dbError;
        }
      });

      await Promise.all(uploadPromises);
      notifySuccess(`Successfully uploaded ${files.length} picture${files.length > 1 ? 's' : ''}`);
      await loadPictures();
    } catch (error: any) {
      notifyError(error.message || 'Failed to upload pictures');
    } finally {
      setUploading(false);
      // Reset input
      event.target.value = '';
    }
  };

  const getPictureUrl = (filePath: string) => {
    const { data } = supabase.storage.from('lot-pictures').getPublicUrl(filePath);
    return data.publicUrl;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <ImageIcon className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-900 mb-2">Upload Pictures of Your Event Location</h3>
            <p className="text-sm text-blue-800 mb-3">
              Help us prepare for your event! Please upload pictures of the area where you'd like the inflatables set up. This helps us:
            </p>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Assess the setup area and plan accordingly</li>
              <li>Identify any potential obstacles or special requirements</li>
              <li>Ensure we bring the right equipment</li>
              <li>Make your event setup as smooth as possible</li>
            </ul>
            <p className="text-sm text-blue-800 mt-3">
              <strong>Tip:</strong> Take photos from different angles showing the full area, any slopes, nearby obstacles, and access points.
            </p>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
        <input
          type="file"
          id="lot-pictures-upload"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          disabled={uploading}
          className="hidden"
        />
        <label
          htmlFor="lot-pictures-upload"
          className="cursor-pointer flex flex-col items-center gap-3"
        >
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
            <Upload className="w-8 h-8 text-blue-600" />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900 mb-1">
              {uploading ? 'Uploading...' : 'Click to upload pictures'}
            </p>
            <p className="text-sm text-slate-600">
              or drag and drop images here
            </p>
            <p className="text-xs text-slate-500 mt-2">
              PNG, JPG, WEBP, HEIC up to 10MB each
            </p>
          </div>
        </label>
      </div>

      {/* Uploaded Pictures */}
      {pictures.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-slate-900">
              Uploaded Pictures ({pictures.length})
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {pictures.map((picture) => (
              <div key={picture.id} className="group relative">
                <div className="aspect-square bg-slate-100 rounded-lg overflow-hidden border-2 border-slate-200 hover:border-blue-400 transition-colors">
                  <img
                    src={getPictureUrl(picture.file_path)}
                    alt={picture.file_name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <p className="text-xs text-slate-600 mt-1 truncate" title={picture.file_name}>
                  {picture.file_name}
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(picture.uploaded_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {pictures.length === 0 && !uploading && (
        <div className="text-center py-8">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ImageIcon className="w-10 h-10 text-slate-400" />
          </div>
          <p className="text-slate-600 mb-2">No pictures uploaded yet</p>
          <p className="text-sm text-slate-500">
            Upload pictures of your event location to help us prepare
          </p>
        </div>
      )}

      {/* Success Message for uploads */}
      {pictures.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800">
            <strong>Thank you!</strong> Your pictures have been received. Our team will review them as we prepare for your event.
          </p>
        </div>
      )}
    </div>
  );
}
