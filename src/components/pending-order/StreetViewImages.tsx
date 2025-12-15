import { format } from 'date-fns';
import { X } from 'lucide-react';

interface Address {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

interface StreetViewImagesProps {
  address: Address;
  orderCreatedAt: string;
  selectedImage: { url: string; label: string } | null;
  onSelectImage: (image: { url: string; label: string } | null) => void;
}

const streetViewAngles = [
  { heading: 0, label: 'North View' },
  { heading: 90, label: 'East View' },
  { heading: 180, label: 'South View' },
  { heading: 270, label: 'West View' },
];

function getStreetViewUrl(address: Address, heading: number = 0): string {
  const addressStr = `${address.line1}, ${address.city}, ${address.state} ${address.zip}`;
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${encodeURIComponent(addressStr)}&heading=${heading}&key=${apiKey}`;
}

export function StreetViewImages({
  address,
  orderCreatedAt,
  selectedImage,
  onSelectImage,
}: StreetViewImagesProps) {
  return (
    <>
      <div className="mb-4 p-3 md:p-4 bg-white rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-slate-700">
            Street View Assessment - Multiple Angles
          </h4>
          <span className="text-xs text-slate-500">
            Order Created: {format(new Date(orderCreatedAt), 'MMM d, yyyy h:mm a')}
          </span>
        </div>
        <div className="text-xs text-slate-500 mb-3">
          Non-client test message may still display during delivery. Walk down during delivery.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {streetViewAngles.map((angle) => (
            <div key={angle.heading} className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                {angle.label}
              </div>
              <img
                src={getStreetViewUrl(address, angle.heading)}
                alt={angle.label}
                className="w-full h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() =>
                  onSelectImage({ url: getStreetViewUrl(address, angle.heading), label: angle.label })
                }
              />
            </div>
          ))}
        </div>
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4"
          onClick={() => onSelectImage(null)}
        >
          <button
            onClick={() => onSelectImage(null)}
            className="absolute top-4 right-4 text-white hover:text-slate-300 transition-colors"
          >
            <X className="w-8 h-8" />
          </button>
          <div className="max-w-full max-h-full flex flex-col items-center">
            <img
              src={selectedImage.url}
              alt={selectedImage.label}
              className="max-w-full max-h-[85vh] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <p className="text-white text-lg font-semibold mt-4 text-center">
              {selectedImage.label}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
