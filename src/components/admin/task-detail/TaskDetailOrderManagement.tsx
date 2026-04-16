import { useState } from 'react';
import { DollarSign, FileCheck, Ban, CreditCard } from 'lucide-react';
import { formatCurrency } from '../../../lib/pricing';
import { Task } from '../../../hooks/useCalendarTasks';

interface Props {
  task: Task;
  onCashPayment: (amountCents: number) => Promise<void>;
  onCheckPayment: (amountCents: number, checkNumber: string) => Promise<void>;
  onPaperWaiver: () => Promise<void>;
  onCancelOrder: (reason: string) => Promise<void>;
  onChargeCard: (amountCents: number) => Promise<void>;
  recordingCash: boolean;
  recordingCheck: boolean;
  signingWaiver: boolean;
  cancelling: boolean;
  chargingCard: boolean;
}

export function TaskDetailOrderManagement({
  task, onCashPayment, onCheckPayment, onPaperWaiver, onCancelOrder, onChargeCard,
  recordingCash, recordingCheck, signingWaiver, cancelling, chargingCard,
}: Props) {
  const [showCashPayment, setShowCashPayment] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [showCheckPayment, setShowCheckPayment] = useState(false);
  const [checkAmount, setCheckAmount] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState('');

  async function handleCash() {
    const amountCents = Math.round(parseFloat(cashAmount) * 100);
    if (!amountCents || amountCents <= 0) return;
    await onCashPayment(amountCents);
    setShowCashPayment(false);
    setCashAmount('');
  }

  async function handleCheck() {
    const amountCents = Math.round(parseFloat(checkAmount) * 100);
    if (!amountCents || amountCents <= 0 || !checkNumber.trim()) return;
    await onCheckPayment(amountCents, checkNumber.trim());
    setShowCheckPayment(false);
    setCheckAmount('');
    setCheckNumber('');
  }

  async function handleCancel() {
    const trimmed = cancelReason.trim();
    if (!trimmed || trimmed.length < 10) {
      setCancelReasonError(`Please provide a reason (minimum 10 characters, currently ${trimmed.length})`);
      return;
    }
    setCancelReasonError('');
    await onCancelOrder(trimmed);
  }

  return (
    <div className="bg-slate-50 rounded-lg p-4 space-y-3">
      <h3 className="font-bold text-slate-900 mb-3">Order Management</h3>

      {task.balanceDue > 0 && (
        <div className="space-y-2">
          <div>
            <button
              onClick={() => { setShowCashPayment(!showCashPayment); setShowCheckPayment(false); }}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              <DollarSign className="w-4 h-4" />
              Record Cash Payment
            </button>
            {showCashPayment && (
              <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg space-y-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Amount Received ($) — Balance Due: {formatCurrency(task.balanceDue)}
                  </label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={cashAmount}
                    onChange={e => setCashAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                    placeholder={(task.balanceDue / 100).toFixed(2)}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCash}
                    disabled={recordingCash}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white text-sm font-semibold py-2 px-3 rounded"
                  >
                    {recordingCash ? 'Recording...' : 'Record Payment'}
                  </button>
                  <button
                    onClick={() => setShowCashPayment(false)}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold py-2 px-3 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <button
              onClick={() => { setShowCheckPayment(!showCheckPayment); setShowCashPayment(false); }}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              <DollarSign className="w-4 h-4" />
              Record Check Payment
            </button>
            {showCheckPayment && (
              <div className="mt-3 p-3 bg-white border border-blue-200 rounded-lg space-y-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Amount Received ($) — Balance Due: {formatCurrency(task.balanceDue)}
                  </label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={checkAmount}
                    onChange={e => setCheckAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                    placeholder={(task.balanceDue / 100).toFixed(2)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Check Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={checkNumber}
                    onChange={e => setCheckNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                    placeholder="e.g. 1042"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCheck}
                    disabled={recordingCheck || !checkAmount || !checkNumber.trim()}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-semibold py-2 px-3 rounded"
                  >
                    {recordingCheck ? 'Recording...' : 'Record Payment'}
                  </button>
                  <button
                    onClick={() => setShowCheckPayment(false)}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold py-2 px-3 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {task.balanceDue > 0 && task.stripePaymentMethodId && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-4 h-4 text-blue-700" />
            <span className="text-xs font-semibold text-blue-800">
              Card on File:{' '}
              {task.paymentMethodBrand && task.paymentMethodLastFour
                ? `${task.paymentMethodBrand.charAt(0).toUpperCase()}${task.paymentMethodBrand.slice(1)} •••• ${task.paymentMethodLastFour}`
                : 'Saved card'}
            </span>
          </div>
          <button
            onClick={() => onChargeCard(task.balanceDue)}
            disabled={chargingCard}
            className="w-full flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            <CreditCard className="w-4 h-4" />
            {chargingCard ? 'Charging...' : `Charge ${formatCurrency(task.balanceDue)} to Card`}
          </button>
        </div>
      )}

      {!task.waiverSigned && (
        <button
          onClick={onPaperWaiver}
          disabled={signingWaiver}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          <FileCheck className="w-4 h-4" />
          {signingWaiver ? 'Processing...' : 'Mark Waiver Signed (Paper)'}
        </button>
      )}

      <div>
        <button
          onClick={() => setShowCancelForm(!showCancelForm)}
          className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          <Ban className="w-4 h-4" />
          Cancel Order
        </button>
        {showCancelForm && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Cancellation Reason (minimum 10 characters)
              </label>
              <textarea
                value={cancelReason}
                onChange={e => { setCancelReason(e.target.value); setCancelReasonError(''); }}
                className={`w-full px-3 py-2 text-sm border rounded ${cancelReasonError ? 'border-red-500' : 'border-slate-300'}`}
                rows={3}
                placeholder="e.g., Weather cancellation, Customer request, Equipment failure"
              />
              {cancelReasonError && (
                <p className="text-xs text-red-600 mt-1">{cancelReasonError}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white text-sm font-semibold py-2 px-3 rounded"
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
              <button
                onClick={() => setShowCancelForm(false)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold py-2 px-3 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
