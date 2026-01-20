import { useState } from 'react';
import { DollarSign, AlertCircle, X } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface TaxWaiverProps {
  taxCents: number;
  taxWaived: boolean;
  taxWaiveReason?: string;
  onToggle: (reason: string) => void;
  compact?: boolean;
  applyTaxesByDefault?: boolean;
  originalOrderTaxCents?: number;
}

export function TaxWaiver({
  taxCents,
  taxWaived,
  taxWaiveReason,
  onToggle,
  compact = false,
  applyTaxesByDefault = true,
  originalOrderTaxCents,
}: TaxWaiverProps) {
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Determine the action and messaging based on context
  // When taxes are applied by default: toggle removes them (waive)
  // When taxes are NOT applied by default: toggle adds them (apply)
  const isWaivingTaxes = applyTaxesByDefault;
  const actionVerb = taxWaived
    ? (isWaivingTaxes ? 'Restore Tax' : 'Remove Tax')
    : (isWaivingTaxes ? 'Waive Tax' : 'Apply Tax');
  const currentStatus = taxWaived
    ? (isWaivingTaxes ? 'Taxes are currently waived for this order.' : 'Taxes are currently applied for this order.')
    : (isWaivingTaxes ? 'Waive sales tax for this order. This action will be logged.' : 'Apply sales tax to this order. This action will be logged.');

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

  if (compact) {
    return (
      <>
        <div className="bg-red-50 rounded-lg shadow p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-red-700" />
            <h3 className="text-base sm:text-lg font-semibold text-slate-900">
              Tax Override
            </h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            {currentStatus}
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
            {actionVerb}
          </button>
        </div>

        {showConfirmation && (
          <ConfirmationDialog
            taxWaived={taxWaived}
            taxCents={taxCents}
            currentReason={taxWaiveReason}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            actionVerb={actionVerb}
            applyTaxesByDefault={applyTaxesByDefault}
          />
        )}
      </>
    );
  }

  // Determine if taxes should be shown as "applied" or "not applied"
  // The checkbox reflects the ACTUAL current state: Is tax being applied to this order?
  // We determine this by checking the actual tax amount being calculated/charged
  const taxesAreApplied = taxCents > 0;

  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-5 h-5 text-blue-700" />
          <h3 className="font-semibold text-slate-900">Tax Settings</h3>
        </div>

        <div className="space-y-3">
          {/* Checkbox to apply/remove taxes */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="apply-taxes"
              checked={taxesAreApplied}
              onChange={handleToggleClick}
              className="mt-1 w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex-1">
              <label htmlFor="apply-taxes" className="text-sm font-medium text-slate-900 cursor-pointer">
                Apply Sales Tax (6%)
              </label>
              <p className="text-xs text-slate-600 mt-1">
                {taxesAreApplied
                  ? `Tax of ${formatCurrency(taxCents)} will be charged to the customer.`
                  : `No tax will be charged to the customer.`
                }
              </p>
            </div>
          </div>

          {/* Show tax amount and reason when overridden - only show if there's actually a reason to display */}
          {taxWaiveReason && taxWaived && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <p className="text-xs font-medium text-amber-900 mb-1">
                {applyTaxesByDefault ? 'Tax Override - Waived' : 'Tax Override - Applied'}
              </p>
              <p className="text-xs text-slate-700">
                <strong>Reason:</strong> {taxWaiveReason}
              </p>
            </div>
          )}
        </div>
      </div>

      {showConfirmation && (
        <ConfirmationDialog
          taxWaived={taxWaived}
          taxCents={taxCents}
          currentReason={taxWaiveReason}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          actionVerb={actionVerb}
          applyTaxesByDefault={applyTaxesByDefault}
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
  actionVerb,
  applyTaxesByDefault,
}: {
  taxWaived: boolean;
  taxCents: number;
  currentReason?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  actionVerb: string;
  applyTaxesByDefault: boolean;
}) {
  const [reason, setReason] = useState(currentReason || '');

  const handleConfirm = () => {
    if (!taxWaived && !reason.trim()) {
      alert('Please provide a reason for waiving tax.');
      return;
    }
    onConfirm(reason.trim());
  };
  // Determine messaging based on context
  const isWaivingTaxes = applyTaxesByDefault;
  let confirmMessage: string;
  let reasonLabel: string;

  if (taxWaived) {
    // Currently overridden - restoring to default
    confirmMessage = isWaivingTaxes
      ? `This will restore the tax charge of ${formatCurrency(taxCents)} to the order. The customer will be charged this amount.`
      : `This will remove the tax charge of ${formatCurrency(taxCents)} from the order. The customer will not be charged any tax.`;
    reasonLabel = 'Reason for Change';
  } else {
    // Currently at default - applying override
    confirmMessage = isWaivingTaxes
      ? `This will waive the tax charge of ${formatCurrency(taxCents)} for this order. The customer will not be charged any tax.`
      : `This will add a tax charge of ${formatCurrency(taxCents)} to the order. The customer will be charged this amount.`;
    reasonLabel = isWaivingTaxes ? 'Reason for Waiving Tax' : 'Reason for Applying Tax';
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full border-2 border-red-600">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-6 h-6 text-red-600" />
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

          {!taxWaived && (
            <div>
              <label htmlFor="tax-waive-reason" className="block text-sm font-medium text-slate-700 mb-2">
                {reasonLabel} <span className="text-red-600">*</span>
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
              {actionVerb}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
