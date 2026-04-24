import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { X, Star, Loader } from 'lucide-react';

interface Address {
  line1: string;
  city: string;
  state: string;
  zip: string;
  lat?: number | null;
  lng?: number | null;
}

interface StreetViewImagesProps {
  address: Address;
  orderCreatedAt: string;
  selectedImage: { url: string; label: string } | null;
  onSelectImage: (image: { url: string; label: string } | null) => void;
}

const CARDINAL_ANGLES = [
  { heading: 0, label: 'North View' },
  { heading: 90, label: 'East View' },
  { heading: 180, label: 'South View' },
  { heading: 270, label: 'West View' },
];

function getStreetViewUrl(address: Address, heading: number, size = '600x400'): string {
  const addressStr = `${address.line1}, ${address.city}, ${address.state} ${address.zip}`;
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${encodeURIComponent(addressStr)}&heading=${heading}&key=${apiKey}`;
}

function nearestCardinal(heading: number): { heading: number; label: string } {
  const h = ((heading % 360) + 360) % 360;
  return CARDINAL_ANGLES.reduce((best, candidate) => {
    const diff = Math.abs(((candidate.heading - h + 540) % 360) - 180);
    const bestDiff = Math.abs(((best.heading - h + 540) % 360) - 180);
    return diff < bestDiff ? candidate : best;
  });
}

async function fetchFacingHeading(address: Address): Promise<number | null> {
  if (!address.lat || !address.lng) return null;
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  try {
    const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${address.lat},${address.lng}&key=${apiKey}`;
    const res = await fetch(metaUrl);
    if (!res.ok) return null;
    const meta = await res.json();
    if (meta.status !== 'OK' || !meta.location) return null;
    const { lat: panoLat, lng: panoLng } = meta.location;
    if (typeof google === 'undefined' || !google.maps?.geometry) return null;
    const from = new google.maps.LatLng(panoLat, panoLng);
    const to = new google.maps.LatLng(address.lat, address.lng);
    return google.maps.geometry.spherical.computeHeading(from, to);
  } catch {
    return null;
  }
}

export function StreetViewImages({
  address,
  orderCreatedAt,
  selectedImage,
  onSelectImage,
}: StreetViewImagesProps) {
  const [primaryHeading, setPrimaryHeading] = useState<number | null>(null);
  const [loadingHeading, setLoadingHeading] = useState(true);

  useEffect(() => {
    setLoadingHeading(true);
    fetchFacingHeading(address).then((heading) => {
      setPrimaryHeading(heading);
      setLoadingHeading(false);
    });
  }, [address.lat, address.lng]);

  const primaryCardinal = primaryHeading !== null
    ? nearestCardinal(primaryHeading)
    : CARDINAL_ANGLES[0];

  // All 4 angles in fixed order — primary one gets highlighted treatment
  const orderedAngles = CARDINAL_ANGLES;

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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          {orderedAngles.map((angle) => {
            const isPrimary = angle.heading === primaryCardinal.heading && !loadingHeading;
            const imgHeading = isPrimary && primaryHeading !== null ? primaryHeading : angle.heading;

            return (
              <div
                key={angle.heading}
                className={`rounded overflow-hidden cursor-pointer group relative transition-all ${
                  isPrimary
                    ? 'border-2 border-amber-400 ring-2 ring-amber-200'
                    : 'border border-slate-200'
                }`}
                onClick={() =>
                  onSelectImage({
                    url: getStreetViewUrl(address, imgHeading, '1200x800'),
                    label: isPrimary ? `Front-Facing View — ${angle.label}` : angle.label,
                  })
                }
              >
                {/* Label bar */}
                <div className={`px-2 py-1 text-xs font-medium text-center flex items-center justify-center gap-1 ${
                  isPrimary ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-700'
                }`}>
                  {isPrimary && <Star className="w-3 h-3 fill-white flex-shrink-0" />}
                  {loadingHeading && angle.heading === CARDINAL_ANGLES[0].heading ? (
                    <span className="flex items-center gap-1">
                      <Loader className="w-3 h-3 animate-spin" />
                      Detecting...
                    </span>
                  ) : (
                    isPrimary ? `Front View` : angle.label
                  )}
                </div>

                <div className="relative">
                  <img
                    src={getStreetViewUrl(address, imgHeading)}
                    alt={angle.label}
                    className="w-full h-32 sm:h-40 md:h-48 object-cover group-hover:opacity-90 transition-opacity"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded-full">
                      Enlarge
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
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
