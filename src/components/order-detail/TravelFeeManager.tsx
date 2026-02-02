import { useState } from 'react';
import { DollarSign, AlertCircle, X } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface TravelFeeManagerProps {
  travelFeeCents: number;
  travelFeeWaived: boolean;
  travelFeeWaiveReason?: string;
  onToggle: (reason: string) => void;
  applyTravelFeeByDefault?: boolean;
  originalOrderTravelFeeCents?: number;
}

export function TravelFeeManager({
  travelFeeCents,
  travelFeeWaived,
  travelFeeWaiveReason,
  onToggle,
  applyTravelFeeByDefault = true,
  originalOrderTravelFeeCents,
}: TravelFeeManagerProps) {
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleToggleClick = () => {
    setShowConfirmation(true);
  };

  const handleConfirm = (reason: string) => {
    onToggle(reason);
    setShowConfirmation(false);
  };

  const handleCancel = () => {
    setShowConfirmation(false);
  };

  // If the original order has travel fee already applied, only show the waive button (not the checkbox)
  const orderHasTravelFeeApplied = (originalOrderTravelFeeCents || 0) > 0;
  const travelFeeIsApplied = travelFeeCents > 0 && !travelFeeWaived;

  return (
    <>
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-5 h-5 text-orange-700" />
          <h3 className="font-semibold text-slate-900">Travel Fee Settings</h3>
        </div>

        <div className="space-y-3">
          {/* Show checkbox only if order doesn't already have travel fee applied */}
          {!orderHasTravelFeeApplied && (
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="apply-travel-fee"
                checked={travelFeeIsApplied}
                onChange={handleToggleClick}
                className="mt-1 w-4 h-4 text-orange-600 border-slate-300 rounded focus:ring-2 focus:ring-orange-500"
              />
              <div className="flex-1">
                <label htmlFor="apply-travel-fee" className="text-sm font-medium text-slate-900 cursor-pointer">
                  Apply Travel Fee
                </label>
                <p className="text-xs text-slate-600 mt-1">
                  {travelFeeIsApplied
                    ? `Travel fee of ${formatCurrency(travelFeeCents)} will be charged to the customer.`
                    : `No travel fee will be charged to the customer.`
                  }
                </p>
              </div>
            </div>
          )}

          {/* Show waive button when order has travel fee applied */}
          {orderHasTravelFeeApplied && (
            <div className="bg-white border border-slate-300 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-slate-700">Travel Fee Amount:</span>
                <span className={`font-semibold ${travelFeeWaived ? 'text-orange-600 line-through' : 'text-slate-900'}`}>
                  {formatCurrency(travelFeeCents)}
                </span>
              </div>
              {travelFeeWaived && (
                <div className="mb-3 text-xs text-orange-700 bg-orange-100 px-3 py-2 rounded">
                  Travel Fee Waived - Not charged to customer
                </div>
              )}
              {!travelFeeWaived && (
                <div className="mb-3 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded">
                  Travel fee will be charged to the customer
                </div>
              )}
              <button
                onClick={handleToggleClick}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  travelFeeWaived
                    ? 'bg-slate-600 hover:bg-slate-700 text-white'
                    : 'bg-orange-600 hover:bg-orange-700 text-white'
                }`}
              >
                {travelFeeWaived ? 'Restore Travel Fee' : 'Waive Travel Fee'}
              </button>
            </div>
          )}

          {/* Show reason when overridden */}
          {travelFeeWaiveReason && travelFeeWaived && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <p className="text-xs font-medium text-amber-900 mb-1">
                Travel Fee Override - Waived
              </p>
              <p className="text-xs text-slate-700">
                <strong>Reason:</strong> {travelFeeWaiveReason}
              </p>
            </div>
          )}
        </div>
      </div>

      {showConfirmation && (
        <ConfirmationDialog
          travelFeeWaived={travelFeeWaived}
          travelFeeCents={travelFeeCents}
          currentReason={travelFeeWaiveReason}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}

function ConfirmationDialog({
  travelFeeWaived,
  travelFeeCents,
  currentReason,
  onConfirm,
  onCancel,
}: {
  travelFeeWaived: boolean;
  travelFeeCents: number;
  currentReason?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(currentReason || '');

  const handleConfirm = () => {
    if (!travelFeeWaived && !reason.trim()) {
      alert('Please provide a reason for waiving travel fee.');
      return;
    }
    onConfirm(reason.trim());
  };

  const actionVerb = travelFeeWaived ? 'Restore Travel Fee' : 'Waive Travel Fee';
  let confirmMessage: string;
  let reasonLabel: string;

  if (travelFeeWaived) {
    confirmMessage = `This will restore the travel fee charge of ${formatCurrency(travelFeeCents)} to the order. The customer will be charged this amount.`;
    reasonLabel = 'Reason for Change';
  } else {
    confirmMessage = `This will waive the travel fee charge of ${formatCurrency(travelFeeCents)} for this order. The customer will not be charged any travel fee.`;
    reasonLabel = 'Reason for Waiving Travel Fee';
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full border-2 border-orange-600">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-6 h-6 text-orange-600" />
            <h2 className="text-xl font-bold text-slate-900">
              {actionVerb}?
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-slate-700">
            {confirmMessage}
          </p>

          {!travelFeeWaived && (
            <div>
              <label htmlFor="travel-fee-waive-reason" className="block text-sm font-medium text-slate-700 mb-2">
                {reasonLabel} <span className="text-red-600">*</span>
              </label>
              <textarea
                id="travel-fee-waive-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Nearby customer, Repeat customer discount, Special promotion..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
              />
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-800">
              This change will be logged in the order changelog for auditing purposes.
            </p>
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 px-4 py-2 rounded-lg text-white font-medium transition-colors bg-orange-600 hover:bg-orange-700"
            >
              {actionVerb}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
