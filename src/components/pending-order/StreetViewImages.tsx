import { format } from 'date-fns';
import { X, Star } from 'lucide-react';

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
  { heading: 0, label: 'North View', primary: true },
  { heading: 90, label: 'East View', primary: false },
  { heading: 180, label: 'South View', primary: false },
  { heading: 270, label: 'West View', primary: false },
];

function getStreetViewUrl(address: Address, heading: number = 0, size = '600x400'): string {
  const addressStr = `${address.line1}, ${address.city}, ${address.state} ${address.zip}`;
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${encodeURIComponent(addressStr)}&heading=${heading}&key=${apiKey}`;
}

export function StreetViewImages({
  address,
  orderCreatedAt,
  selectedImage,
  onSelectImage,
}: StreetViewImagesProps) {
  const primaryAngle = streetViewAngles.find(a => a.primary)!;
  const secondaryAngles = streetViewAngles.filter(a => !a.primary);

  return (
    <>
      <div className="mb-4 p-3 md:p-4 bg-white rounded-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
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
        <div className="text-xs text-slate-600 mb-3 sm:hidden">
          Tap any image to view full screen
        </div>

        {/* Primary / highlighted view */}
        <div
          className="mb-3 border-2 border-amber-400 rounded-lg overflow-hidden cursor-pointer group relative"
          onClick={() =>
            onSelectImage({
              url: getStreetViewUrl(address, primaryAngle.heading, '1200x800'),
              label: primaryAngle.label,
            })
          }
        >
          <div className="flex items-center gap-1.5 bg-amber-400 px-3 py-1.5">
            <Star className="w-3.5 h-3.5 text-white fill-white" />
            <span className="text-xs font-semibold text-white tracking-wide">
              Primary View — {primaryAngle.label}
            </span>
          </div>
          <div className="relative">
            <img
              src={getStreetViewUrl(address, primaryAngle.heading, '1200x400')}
              alt={primaryAngle.label}
              className="w-full h-40 sm:h-56 md:h-64 object-cover group-hover:opacity-95 transition-opacity"
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="bg-black bg-opacity-60 text-white text-xs px-3 py-1.5 rounded-full font-medium">
                Click to enlarge
              </span>
            </div>
          </div>
        </div>

        {/* Secondary views */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {secondaryAngles.map((angle) => (
            <div
              key={angle.heading}
              className="border border-slate-200 rounded overflow-hidden cursor-pointer group relative"
              onClick={() =>
                onSelectImage({
                  url: getStreetViewUrl(address, angle.heading, '1200x800'),
                  label: angle.label,
                })
              }
            >
              <div className="bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 text-center">
                {angle.label}
              </div>
              <div className="relative">
                <img
                  src={getStreetViewUrl(address, angle.heading)}
                  alt={angle.label}
                  className="w-full h-28 sm:h-36 md:h-44 object-cover group-hover:opacity-90 transition-opacity"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded-full">
                    Enlarge
                  </span>
                </div>
              </div>
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
