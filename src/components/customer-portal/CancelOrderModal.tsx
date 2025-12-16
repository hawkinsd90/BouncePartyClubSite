import { useState } from 'react';
import { X, AlertTriangle, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface CancelOrderModalProps {
  orderId: string;
  eventDate: string;
  onClose: () => void;
  onSuccess: () => void;
}

const CANCELLATION_REASONS = [
  { value: '', label: 'Select a reason...' },
  { value: 'Weather concerns', label: 'Weather concerns' },
  { value: 'Event cancelled/postponed', label: 'Event cancelled/postponed' },
  { value: 'Change in guest count', label: 'Change in guest count' },
  { value: 'Venue changed', label: 'Venue changed' },
  { value: 'Budget constraints', label: 'Budget constraints' },
  { value: 'Found alternative', label: 'Found alternative' },
  { value: 'Personal/family emergency', label: 'Personal/family emergency' },
  { value: 'other', label: 'Other (please specify)' },
];

export function CancelOrderModal({ orderId, eventDate, onClose, onSuccess }: CancelOrderModalProps) {
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const finalReason = selectedReason === 'other' ? customReason.trim() : selectedReason;

    if (!selectedReason) {
      setError('Please select a cancellation reason');
      return;
    }

    if (selectedReason === 'other' && customReason.trim().length < 10) {
      setError('Please provide a detailed reason with at least 10 characters');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-cancel-order`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId,
            cancellationReason: finalReason,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel order');
      }

      setResult(data);
    } catch (err: any) {
      console.error('Error cancelling order:', err);
      setError(err.message || 'Failed to cancel order');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center justify-center mb-6">
              {result.refundPolicy === 'full_refund' ? (
                <CheckCircle className="w-16 h-16 text-green-500" />
              ) : (
                <AlertTriangle className="w-16 h-16 text-orange-500" />
              )}
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">
              Order Cancelled
            </h2>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-gray-700 mb-4">{result.refundMessage}</p>

              {result.refundResult && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                  {result.refundResult.refunded ? (
                    <div className="flex items-start gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Refund Processed</p>
                        <p className="text-sm text-gray-700">
                          ${(result.refundResult.amount / 100).toFixed(2)} has been refunded to your original payment method.
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          Reference ID: {result.refundResult.refundId}
                        </p>
                      </div>
                    </div>
                  ) : result.refundResult.error ? (
                    <div className="flex items-start gap-2">
                      <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Refund Issue</p>
                        <p className="text-sm text-gray-700">{result.refundResult.error}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {result.refundPolicy === 'reschedule_credit' && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-sm font-semibold text-gray-900 mb-1">Reschedule Credit Available</p>
                  <p className="text-sm text-gray-700">
                    Contact us to reschedule your event within the next 12 months. Your payment will be applied to the new booking.
                  </p>
                </div>
              )}

              {result.refundPolicy === 'no_refund' && (
                <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded">
                  <p className="text-sm font-semibold text-gray-900 mb-1">Cancellation Policy</p>
                  <p className="text-sm text-gray-700">
                    Day-of cancellations are not eligible for refunds or credits. We understand emergencies happen - please contact us if you have extenuating circumstances.
                  </p>
                </div>
              )}
            </div>

            <div className="text-center text-sm text-gray-600 mb-6">
              <p>Event Date: {new Date(eventDate).toLocaleDateString()}</p>
              <p>Hours Until Event: {result.hoursUntilEvent}</p>
            </div>

            <button
              onClick={() => {
                onSuccess();
                onClose();
              }}
              className="w-full bg-blue-600 text-white rounded-lg px-6 py-3 font-semibold hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Cancel Order</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={submitting}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Cancellation Policy</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• <strong>72+ hours before event:</strong> Full refund</li>
                <li>• <strong>Less than 72 hours:</strong> Credit toward one-time reschedule within 12 months</li>
                <li>• <strong>Day of event:</strong> No refund or credit</li>
              </ul>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Event Date
            </label>
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-gray-900">
              {new Date(eventDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reason for Cancellation *
            </label>
            <select
              value={selectedReason}
              onChange={(e) => {
                setSelectedReason(e.target.value);
                setError(null);
              }}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              disabled={submitting}
            >
              {CANCELLATION_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              This helps us improve our service
            </p>
          </div>

          {selectedReason === 'other' && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Please specify your reason *
                <span className="text-xs text-gray-500 font-normal ml-2">
                  (minimum 10 characters)
                </span>
              </label>
              <textarea
                value={customReason}
                onChange={(e) => {
                  setCustomReason(e.target.value);
                  setError(null);
                }}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={4}
                placeholder="Please tell us why you need to cancel this order..."
                required
                minLength={10}
                disabled={submitting}
              />
              <div className="flex justify-end items-center mt-1">
                <p className={`text-xs ${customReason.length < 10 ? 'text-red-500' : 'text-green-600'}`}>
                  {customReason.length} / 10
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-200 text-gray-700 rounded-lg px-6 py-3 font-semibold hover:bg-gray-300 transition-colors"
              disabled={submitting}
            >
              Keep Order
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                !selectedReason ||
                (selectedReason === 'other' && customReason.trim().length < 10)
              }
              className="flex-1 bg-red-600 text-white rounded-lg px-6 py-3 font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5" />
                  Cancel Order
                </>
              )}
            </button>
          </div>

          <p className="text-xs text-gray-500 text-center mt-4">
            By cancelling, you acknowledge that you have read and understood our cancellation policy.
          </p>
        </form>
      </div>
    </div>
  );
}
