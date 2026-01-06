import { useState } from 'react';
import { DollarSign, AlertCircle, X } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface TaxWaiverProps {
  taxCents: number;
  taxWaived: boolean;
  taxWaiveReason?: string;
  onToggle: (reason: string) => void;
  compact?: boolean;
}

export function TaxWaiver({
  taxCents,
  taxWaived,
  taxWaiveReason,
  onToggle,
  compact = false,
}: TaxWaiverProps) {
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

  if (compact) {
    return (
      <>
        <div className="bg-red-50 rounded-lg shadow p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-red-700" />
            <h3 className="text-base sm:text-lg font-semibold text-slate-900">
              Tax Waiver
            </h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            {taxWaived
              ? 'Taxes are currently waived for this order.'
              : 'Waive sales tax for this order. This action will be logged.'}
          </p>
          <div className="bg-white p-3 rounded border border-red-200 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-700">Tax Amount:</span>
              <span className={`font-semibold ${taxWaived ? 'text-red-600 line-through' : 'text-slate-900'}`}>
                {formatCurrency(taxCents)}
              </span>
            </div>
            {taxWaived && (
              <div className="mt-2 text-xs text-red-700 bg-red-100 px-2 py-1 rounded">
                Tax Waived - Not charged to customer
              </div>
            )}
            {taxWaived && taxWaiveReason && (
              <div className="mt-2 text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded">
                <strong>Reason:</strong> {taxWaiveReason}
              </div>
            )}
          </div>
          <button
            onClick={handleToggleClick}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
              taxWaived
                ? 'bg-slate-600 hover:bg-slate-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {taxWaived ? 'Restore Tax' : 'Waive Tax'}
          </button>
        </div>

        {showConfirmation && (
          <ConfirmationDialog
            taxWaived={taxWaived}
            taxCents={taxCents}
            currentReason={taxWaiveReason}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-5 h-5 text-red-700" />
          <h3 className="font-semibold text-slate-900">Tax Waiver</h3>
        </div>
        <p className="text-sm text-slate-600 mb-3">
          {taxWaived
            ? 'Taxes are currently waived for this order.'
            : 'Waive sales tax for this order. This action will be logged.'}
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">Tax Amount:</span>
            <span className={`font-semibold ${taxWaived ? 'text-red-600 line-through' : 'text-slate-900'}`}>
              {formatCurrency(taxCents)}
            </span>
          </div>
          {taxWaived && (
            <div className="bg-red-100 border border-red-300 rounded p-3">
              <p className="text-sm font-medium text-red-800 mb-1">Tax Waived</p>
              <p className="text-xs text-red-700">
                Taxes have been waived and will not be charged to the customer.
              </p>
              {taxWaiveReason && (
                <p className="text-xs text-slate-700 mt-2 bg-white px-2 py-1 rounded">
                  <strong>Reason:</strong> {taxWaiveReason}
                </p>
              )}
            </div>
          )}
          <button
            onClick={handleToggleClick}
            className={`w-full py-2 rounded text-sm font-medium transition-colors ${
              taxWaived
                ? 'bg-slate-600 hover:bg-slate-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {taxWaived ? 'Restore Tax' : 'Waive Tax'}
          </button>
        </div>
      </div>

      {showConfirmation && (
        <ConfirmationDialog
          taxWaived={taxWaived}
          taxCents={taxCents}
          currentReason={taxWaiveReason}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}

function ConfirmationDialog({
  taxWaived,
  taxCents,
  currentReason,
  onConfirm,
  onCancel,
}: {
  taxWaived: boolean;
  taxCents: number;
  currentReason?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(currentReason || '');

  const handleConfirm = () => {
    if (!taxWaived && !reason.trim()) {
      alert('Please provide a reason for waiving tax.');
      return;
    }
    onConfirm(reason.trim());
  };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full border-2 border-red-600">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-6 h-6 text-red-600" />
            <h2 className="text-xl font-bold text-slate-900">
              {taxWaived ? 'Restore Tax?' : 'Waive Tax?'}
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
            {taxWaived
              ? `This will restore the tax charge of ${formatCurrency(taxCents)} to the order. The customer will be charged this amount.`
              : `This will waive the tax charge of ${formatCurrency(taxCents)} for this order. The customer will not be charged any tax.`}
          </p>

          {!taxWaived && (
            <div>
              <label htmlFor="tax-waive-reason" className="block text-sm font-medium text-slate-700 mb-2">
                Reason for Waiving Tax <span className="text-red-600">*</span>
              </label>
              <textarea
                id="tax-waive-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Non-profit organization, Tax-exempt customer, Special promotion..."
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
              className="flex-1 px-4 py-2 rounded-lg text-white font-medium transition-colors bg-red-600 hover:bg-red-700"
            >
              {taxWaived ? 'Restore Tax' : 'Waive Tax'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
