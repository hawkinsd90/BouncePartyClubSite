import { useState, useEffect } from 'react';
import { MapPin, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notifyError } from '../../lib/notifications';

interface LotPicturesDisplayProps {
  orderId: string;
  orderNumber: string;
  onPromptCustomer?: () => void;
  lotPicturesRequested?: boolean;
}

interface LotPicture {
  id: string;
  file_path: string;
  file_name: string;
  notes: string | null;
  uploaded_at: string;
}

export function LotPicturesDisplay({ orderId, onPromptCustomer, lotPicturesRequested }: LotPicturesDisplayProps) {
  const [pictures, setPictures] = useState<LotPicture[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    loadPictures();

    let debounceTimer: NodeJS.Timeout | null = null;

    const debouncedLoadPictures = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        loadPictures();
      }, 300);
    };

    // Set up real-time listener for new picture uploads
    const channel = supabase
      .channel(`lot-pictures-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_lot_pictures',
          filter: `order_id=eq.${orderId}`,
        },
        debouncedLoadPictures
      )
      .subscribe();

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      supabase.removeChannel(channel);
    };
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
      notifyError('Failed to load lot pictures');
    } finally {
      setLoading(false);
    }
  };

  const getPictureUrl = (filePath: string) => {
    const { data } = supabase.storage.from('lot-pictures').getPublicUrl(filePath);
    return data.publicUrl;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-900">Lot Pictures</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (pictures.length === 0) {
    return (
      <div className={`${lotPicturesRequested ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'} border rounded-lg p-4`}>
        <div className="flex items-start gap-3">
          <ImageIcon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${lotPicturesRequested ? 'text-blue-600' : 'text-amber-600'}`} />
          <div className="flex-1">
            <h3 className={`font-semibold mb-1 ${lotPicturesRequested ? 'text-blue-900' : 'text-amber-900'}`}>
              {lotPicturesRequested ? 'Lot Pictures Requested' : 'No Lot Pictures Uploaded'}
            </h3>
            <p className={`text-sm mb-3 ${lotPicturesRequested ? 'text-blue-800' : 'text-amber-800'}`}>
              {lotPicturesRequested
                ? 'A request has been sent to the customer. Waiting for them to upload pictures through their portal.'
                : "The customer hasn't uploaded pictures of the event location yet. These pictures help assess setup requirements and identify any potential issues."}
            </p>
            {onPromptCustomer && !lotPicturesRequested && (
              <button
                onClick={onPromptCustomer}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Request Lot Pictures from Customer
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-slate-900">Lot Pictures ({pictures.length})</h3>
          </div>
          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
            Pictures Received
          </span>
        </div>

        <p className="text-sm text-slate-600 mb-4">
          Customer uploaded pictures of the event location. Click to view full size.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {pictures.map((picture) => (
            <div key={picture.id} className="group relative">
              <button
                onClick={() => setSelectedImage(getPictureUrl(picture.file_path))}
                className="aspect-square bg-slate-100 rounded-lg overflow-hidden border-2 border-slate-200 hover:border-blue-400 transition-colors w-full"
              >
                <img
                  src={getPictureUrl(picture.file_path)}
                  alt={picture.file_name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-opacity flex items-center justify-center">
                  <ExternalLink className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
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

      {/* Image Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white hover:text-slate-300 transition-colors"
            onClick={() => setSelectedImage(null)}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={selectedImage}
            alt="Lot picture full size"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
