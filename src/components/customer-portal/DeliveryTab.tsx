import { useState, useEffect } from 'react';
import { Truck, Camera, Clock, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface DeliveryTabProps {
  orderId: string;
}

export function DeliveryTab({ orderId }: DeliveryTabProps) {
  const [deliveryImages, setDeliveryImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deliveredAt, setDeliveredAt] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    loadDeliveryPhotos();
  }, [orderId]);

  async function loadDeliveryPhotos() {
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('task_status')
        .select('delivery_images, completed_time, updated_at, status')
        .eq('order_id', orderId)
        .eq('task_type', 'drop-off')
        .order('created_at', { ascending: false })
        .limit(1);

      const data = rows && rows.length > 0 ? rows[0] : null;

      if (error) {
        console.error('Error loading delivery photos:', error);
        return;
      }

      if (data) {
        const imgs: string[] = Array.isArray(data.delivery_images) ? data.delivery_images : [];
        setDeliveryImages(imgs);
        if (data.status === 'completed' || imgs.length > 0) {
          // Prefer completed_time (set when crew marks drop-off done) over updated_at
          setDeliveredAt(data.completed_time || data.updated_at);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading delivery photos...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-900 text-sm">Proof of Delivery Photos</p>
              <p className="text-xs text-blue-700 mt-1">
                These photos are taken by the Bounce Party Club crew at the time of equipment
                setup and delivery. They serve as your proof of delivery and document the
                condition of the equipment upon arrival.
              </p>
            </div>
          </div>
        </div>

        {deliveredAt && deliveryImages.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            <span>
              Equipment delivered and photos captured on{' '}
              {new Date(deliveredAt).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}

        {deliveryImages.length > 0 ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Camera className="w-4 h-4 text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-700">
                {deliveryImages.length} Delivery Photo{deliveryImages.length !== 1 ? 's' : ''}
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {deliveryImages.map((url, idx) => (
                <button
                  key={idx}
                  onClick={() => setLightboxUrl(url)}
                  className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all group"
                >
                  <img
                    src={url}
                    alt={`Delivery photo ${idx + 1}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all" />
                  <div className="absolute bottom-1 right-1 bg-black bg-opacity-50 text-white text-xs px-1.5 py-0.5 rounded">
                    {idx + 1}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-12 bg-slate-50 border border-slate-200 rounded-lg">
            <Clock className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="font-semibold text-slate-700 mb-1">No Delivery Photos Yet</p>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              Delivery photos will appear here after the Bounce Party Club crew completes your
              equipment setup. Check back on your event day!
            </p>
          </div>
        )}
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-4xl max-h-full">
            <img
              src={lightboxUrl}
              alt="Delivery photo fullscreen"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-3 -right-3 bg-white text-slate-800 rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg shadow-lg hover:bg-slate-100 transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
