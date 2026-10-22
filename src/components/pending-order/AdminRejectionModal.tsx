import { useState } from 'react';
import { MODAL_PANEL_SCROLL } from '../../lib/core/modalClasses';

interface RejectionModalProps {
  onReject: (reason: string) => void;
  onCancel: () => void;
}

const PRE_GENERATED_REJECTIONS = [
  'Units not available for selected date',
  'Location outside service area',
  'Weather conditions unsafe for event',
  'Insufficient setup space at location',
  'Unable to verify venue permissions',
  'Event date conflicts with existing booking',
];

// Rejecting a booking tells the customer, so a tap on a reason only selects it: a second, explicit confirmation sends it.
export function AdminRejectionModal({ onReject, onCancel }: RejectionModalProps) {
  const [customReason, setCustomReason] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  if (pending !== null) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div role="alertdialog" aria-modal="true" aria-label="Confirm rejection" className={`bg-white rounded-lg p-6 max-w-md w-full ${MODAL_PANEL_SCROLL}`}>
          <h3 className="text-lg font-bold text-slate-900 mb-2">Reject this booking?</h3>
          <p className="text-sm text-slate-600 mb-3">Reason:</p>
          <p className="text-sm font-medium text-slate-900 bg-slate-100 rounded-lg px-3 py-2 mb-3 break-words">{pending}</p>
          <p className="text-sm text-slate-600 mb-5">The customer will be notified. This cannot be undone from here.</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onReject(pending)}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg min-h-[48px]"
            >
              Yes, reject
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-3 px-4 rounded-lg min-h-[48px]"
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-lg p-6 max-w-md w-full ${MODAL_PANEL_SCROLL}`}>
        <h3 className="text-lg font-bold text-slate-900 mb-4">Reject Booking</h3>
        <p className="text-sm text-slate-600 mb-4">Select a reason or enter custom:</p>
        <div className="space-y-2 mb-4">
          {PRE_GENERATED_REJECTIONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => setPending(reason)}
              className="w-full text-left px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded text-sm text-slate-700 min-h-[44px]"
            >
              {reason}
            </button>
          ))}
        </div>
        <textarea
          value={customReason}
          onChange={(e) => setCustomReason(e.target.value)}
          placeholder="Or enter custom reason..."
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4"
          rows={3}
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => customReason.trim() && setPending(customReason.trim())}
            disabled={!customReason.trim()}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-3 px-4 rounded-lg min-h-[48px]"
          >
            Reject with Custom
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-3 px-4 rounded-lg min-h-[48px]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
