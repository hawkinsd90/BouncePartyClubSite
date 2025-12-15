import { useState } from 'react';

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

export function RejectionModal({ onReject, onCancel }: RejectionModalProps) {
  const [customReason, setCustomReason] = useState('');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 className="text-lg font-bold text-slate-900 mb-4">Reject Booking</h3>
        <p className="text-sm text-slate-600 mb-4">Select a reason or enter custom:</p>
        <div className="space-y-2 mb-4">
          {PRE_GENERATED_REJECTIONS.map((reason) => (
            <button
              key={reason}
              onClick={() => onReject(reason)}
              className="w-full text-left px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm text-slate-700"
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
            onClick={() => customReason.trim() && onReject(customReason)}
            disabled={!customReason.trim()}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg"
          >
            Reject with Custom
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
