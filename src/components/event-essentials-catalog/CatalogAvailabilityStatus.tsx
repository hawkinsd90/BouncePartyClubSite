import { Loader2 } from 'lucide-react';
import type { AvailabilityStatus } from './catalogCardModel';

// Display only: renders the line chosen by deriveAvailabilityStatus.
export function CatalogAvailabilityStatus({ status }: { status: AvailabilityStatus }) {
  switch (status.kind) {
    case 'select-dates':
      return <p className="text-xs text-slate-500 mb-3">Select dates to check availability.</p>;
    case 'error':
      return (
        <p className="text-xs text-amber-700 mb-3">
          Availability unavailable — please try again.
        </p>
      );
    case 'checking':
      return (
        <p className="text-xs text-slate-400 flex items-center gap-1.5 mb-3">
          <Loader2 className="w-3 h-3 animate-spin" />
          Checking availability...
        </p>
      );
    case 'text':
      return (
        <p className="text-xs text-slate-600 mb-3">
          {status.text}
        </p>
      );
    default:
      return null;
  }
}
