import { formatCurrency } from '../../lib/pricing';

interface ApprovalModalProps {
  order: any;
  customerDisplayName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ApprovalModal({
  order,
  customerDisplayName,
  onConfirm,
  onCancel,
}: ApprovalModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <img
            src="/bounce party club logo.png"
            alt="Bounce Party Club"
            className="h-16 w-auto mx-auto mb-4"
          />
          <h3 className="text-2xl font-bold text-slate-900 mb-2">Approve This Booking?</h3>
        </div>

        <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 mb-6">
          <p className="text-amber-900 text-sm font-semibold mb-2">This will:</p>
          <ul className="text-amber-800 text-sm space-y-1 list-disc list-inside">
            <li>Charge the customer's card for the deposit</li>
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
            <strong>Order:</strong> #{order.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="text-sm text-slate-600">
            <strong>Deposit:</strong> {formatCurrency(order.deposit_due_cents)}
          </p>
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
