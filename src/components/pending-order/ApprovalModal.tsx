import { AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { formatOrderId } from '../../lib/utils';

interface ApprovalModalProps {
  order: any;
  customerDisplayName: string;
  lotPicturesRequested: boolean;
  lotPicturesReceived: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ApprovalModal({
  order,
  customerDisplayName,
  lotPicturesRequested,
  lotPicturesReceived,
  onConfirm,
  onCancel,
}: ApprovalModalProps) {
  const showLotPicturesWarning = lotPicturesRequested && !lotPicturesReceived;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-8 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="text-center mb-6">
          <img
            src="/bounce party club logo.png"
            alt="Bounce Party Club"
            className="h-16 w-auto mx-auto mb-4"
          />
          <h3 className="text-2xl font-bold text-slate-900 mb-2">Approve This Booking?</h3>
        </div>

        {showLotPicturesWarning && (
          <div className="bg-orange-50 border-2 border-orange-400 rounded-lg p-4 mb-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-orange-900 text-sm font-bold mb-1">Lot Pictures Not Yet Received</p>
              <p className="text-orange-800 text-sm">
                You requested lot pictures from the customer but have not received any yet. Are you sure you want to approve this order without seeing the lot?
              </p>
            </div>
          </div>
        )}

        <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 mb-6">
          <p className="text-amber-900 text-sm font-semibold mb-2">This will:</p>
          <ul className="text-amber-800 text-sm space-y-1 list-disc list-inside">
            {order.deposit_due_cents > 0 ? (
              <li>Charge the customer's card for the deposit ({formatCurrency(order.deposit_due_cents)})</li>
            ) : (
              <li>Confirm the booking (no deposit charge — card kept on file for final payment)</li>
            )}
            <li>Send confirmation SMS and email to customer</li>
            <li>Generate an invoice</li>
            <li>Mark the booking as confirmed</li>
          </ul>
        </div>

        <div className="bg-slate-50 rounded-lg p-4 mb-6">
          <p className="text-sm text-slate-600 mb-2">
            <strong>Customer:</strong> {customerDisplayName}
          </p>
          <p className="text-sm text-slate-600 mb-2">
            <strong>Order:</strong> #{formatOrderId(order.id)}
          </p>
          <p className="text-sm text-slate-600 mb-2">
            <strong>Deposit:</strong> {formatCurrency(order.deposit_due_cents)}
          </p>
          {order.tip_cents > 0 && (
            <p className="text-sm text-slate-600">
              <strong>Tip:</strong> {formatCurrency(order.tip_cents)}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
          >
            Yes, Approve Booking
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
