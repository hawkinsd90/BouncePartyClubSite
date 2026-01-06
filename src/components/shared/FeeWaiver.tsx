import { useState } from 'react';
import { DollarSign, AlertCircle, X } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface FeeWaiverProps {
  feeName: string;
  feeAmount: number;
  isWaived: boolean;
  waiveReason?: string;
  onToggle: (reason: string) => void;
  compact?: boolean;
  color?: 'red' | 'orange' | 'blue';
}

export function FeeWaiver({
  feeName,
  feeAmount,
  isWaived,
  waiveReason,
  onToggle,
  compact = false,
  color = 'red',
}: FeeWaiverProps) {
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleToggleClick = () => {
    setShowConfirmation(true);
  };

  const handleConfirm = (reason: string) => {
    onToggle(reason);
    // Keep modal open after waiving/restoring
  };

  const handleCancel = () => {
    setShowConfirmation(false);
  };

  const colorClasses = {
    red: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-700',
      buttonBg: 'bg-red-600 hover:bg-red-700',
      iconText: 'text-red-700',
      badge: 'bg-red-100 text-red-700 border-red-200',
      confirmBorder: 'border-red-600',
      confirmIcon: 'text-red-600',
      confirmBg: 'bg-red-50 border-red-200',
    },
    orange: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      text: 'text-orange-700',
      buttonBg: 'bg-orange-600 hover:bg-orange-700',
      iconText: 'text-orange-700',
      badge: 'bg-orange-100 text-orange-700 border-orange-200',
      confirmBorder: 'border-orange-600',
      confirmIcon: 'text-orange-600',
      confirmBg: 'bg-orange-50 border-orange-200',
    },
    blue: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-700',
      buttonBg: 'bg-blue-600 hover:bg-blue-700',
      iconText: 'text-blue-700',
      badge: 'bg-blue-100 text-blue-700 border-blue-200',
      confirmBorder: 'border-blue-600',
      confirmIcon: 'text-blue-600',
      confirmBg: 'bg-blue-50 border-blue-200',
    },
  };

  const colors = colorClasses[color];

  if (compact) {
    return (
      <>
        <div className={`${colors.bg} rounded-lg shadow p-4 sm:p-6`}>
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className={`w-5 h-5 ${colors.iconText}`} />
            <h3 className="text-base sm:text-lg font-semibold text-slate-900">
              {feeName} Waiver
            </h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            {isWaived
              ? `${feeName} is currently waived for this order.`
              : `Waive ${feeName.toLowerCase()} for this order. This action will be logged.`}
          </p>
          <div className={`bg-white p-3 rounded border ${colors.border} mb-4`}>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-700">{feeName}:</span>
              <span className={`font-semibold ${isWaived ? `${colors.text} line-through` : 'text-slate-900'}`}>
                {formatCurrency(feeAmount)}
              </span>
            </div>
            {isWaived && (
              <div className={`mt-2 text-xs ${colors.badge} px-2 py-1 rounded border`}>
                {feeName} Waived - Not charged to customer
              </div>
            )}
            {isWaived && waiveReason && (
              <div className="mt-2 text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded">
                <strong>Reason:</strong> {waiveReason}
              </div>
            )}
          </div>
          <button
            onClick={handleToggleClick}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
              isWaived
                ? 'bg-slate-600 hover:bg-slate-700 text-white'
                : `${colors.buttonBg} text-white`
            }`}
          >
            {isWaived ? `Restore ${feeName}` : `Waive ${feeName}`}
          </button>
        </div>

        {showConfirmation && (
          <ConfirmationDialog
            feeName={feeName}
            feeAmount={feeAmount}
            isWaived={isWaived}
            currentReason={waiveReason}
            colors={colors}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className={`${colors.bg} border ${colors.border} rounded-lg p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className={`w-5 h-5 ${colors.iconText}`} />
          <h3 className="font-semibold text-slate-900">{feeName} Waiver</h3>
        </div>
        <p className="text-sm text-slate-600 mb-3">
          {isWaived
            ? `${feeName} is currently waived for this order.`
            : `Waive ${feeName.toLowerCase()} for this order. This action will be logged.`}
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{feeName}:</span>
            <span className={`font-semibold ${isWaived ? `${colors.text} line-through` : 'text-slate-900'}`}>
              {formatCurrency(feeAmount)}
            </span>
          </div>
          {isWaived && (
            <div className={`${colors.confirmBg} border ${colors.border} rounded p-3`}>
              <p className={`text-sm font-medium ${colors.text} mb-1`}>{feeName} Waived</p>
              <p className={`text-xs ${colors.text}`}>
                {feeName} has been waived and will not be charged to the customer.
              </p>
              {waiveReason && (
                <p className="text-xs text-slate-700 mt-2 bg-white px-2 py-1 rounded border border-slate-200">
                  <strong>Reason:</strong> {waiveReason}
                </p>
              )}
            </div>
          )}
          <button
            onClick={handleToggleClick}
            className={`w-full py-2 rounded text-sm font-medium transition-colors ${
              isWaived
                ? 'bg-slate-600 hover:bg-slate-700 text-white'
                : `${colors.buttonBg} text-white`
            }`}
          >
            {isWaived ? `Restore ${feeName}` : `Waive ${feeName}`}
          </button>
        </div>
      </div>

      {showConfirmation && (
        <ConfirmationDialog
          feeName={feeName}
          feeAmount={feeAmount}
          isWaived={isWaived}
          currentReason={waiveReason}
          colors={colors}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}

function ConfirmationDialog({
  feeName,
  feeAmount,
  isWaived,
  currentReason,
  colors,
  onConfirm,
  onCancel,
}: {
  feeName: string;
  feeAmount: number;
  isWaived: boolean;
  currentReason?: string;
  colors: any;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(currentReason || '');

  const handleConfirm = () => {
    if (!isWaived && !reason.trim()) {
      alert('Please provide a reason for waiving this fee.');
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className={`bg-white rounded-xl shadow-xl max-w-md w-full border-2 ${colors.confirmBorder}`}>
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <AlertCircle className={`w-6 h-6 ${colors.confirmIcon}`} />
            <h2 className="text-xl font-bold text-slate-900">
              {isWaived ? `Restore ${feeName}?` : `Waive ${feeName}?`}
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
            {isWaived
              ? `This will restore the ${feeName.toLowerCase()} charge of ${formatCurrency(feeAmount)} to the order. The customer will be charged this amount.`
              : `This will waive the ${feeName.toLowerCase()} charge of ${formatCurrency(feeAmount)} for this order. The customer will not be charged this fee.`}
          </p>

          {!isWaived && (
            <div>
              <label htmlFor="waive-reason" className="block text-sm font-medium text-slate-700 mb-2">
                Reason for Waiving Fee <span className="text-red-600">*</span>
              </label>
              <textarea
                id="waive-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Repeat customer discount, Error in pricing, Special promotion..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
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
              className={`flex-1 px-4 py-2 rounded-lg text-white font-medium transition-colors ${colors.buttonBg}`}
            >
              {isWaived ? `Restore ${feeName}` : `Waive ${feeName}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
