import { Copy, MapPin } from 'lucide-react';
import { formatAddress, mapsDirectionsUrl, type AddressParts } from '../../lib/core/address';
import { showToast } from '../../lib/toasts';

interface Props {
  address: AddressParts | string | null | undefined;
  // A ready-made single line (used when only the text is known); coordinates may still be given through `coords`.
  coords?: { lat?: number | null; lng?: number | null };
  className?: string;
  showCopy?: boolean;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Address copied', 'success');
  } catch {
    showToast('Could not copy the address. Select it and copy manually.', 'error');
  }
}

// An address as a tap target that opens Google Maps directions in a new tab, with a Copy button beside it. The text is the full address
// including the unit. With no address it renders nothing.
export function AddressLink({ address, coords, className = '', showCopy = true }: Props) {
  if (!address) return null;
  const parts: AddressParts = typeof address === 'string' ? { line1: address, ...coords } : { ...address, ...(coords ?? {}) };
  const text = typeof address === 'string' ? address : formatAddress(parts);
  const href = mapsDirectionsUrl(typeof address === 'string' ? { line1: address, lat: coords?.lat, lng: coords?.lng } : parts);
  if (!text || !href) return null;

  return (
    <span className="inline-flex items-start gap-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-start gap-1 text-blue-700 hover:underline py-1 min-h-[32px] ${className}`}
        aria-label={`Directions to ${text}`}
      >
        <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{text}</span>
      </a>
      {showCopy && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void copyText(text); }}
          className="p-2 -my-1 text-slate-500 hover:text-blue-700 min-w-[32px] min-h-[32px]"
          aria-label="Copy address"
          title="Copy address"
        >
          <Copy className="w-4 h-4" />
        </button>
      )}
    </span>
  );
}
