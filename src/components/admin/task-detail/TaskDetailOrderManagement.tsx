import { useState } from 'react';
import { DollarSign, FileCheck, Ban, CreditCard } from 'lucide-react';
import { formatCurrency } from '../../../lib/pricing';
import { Task } from '../../../hooks/useCalendarTasks';

interface Props {
  task: Task;
  onCashPayment: (balancePaymentCents: number, tipCents?: number, totalReceivedCents?: number) => Promise<void>;
  onCheckPayment: (balancePaymentCents: number, checkNumber: string, tipCents?: number, totalReceivedCents?: number) => Promise<void>;
  onPaperWaiver: () => Promise<void>;
  onCancelOrder: (reason: string) => Promise<void>;
  onChargeCard: (amountCents: number) => Promise<void>;
  recordingCash: boolean;
  recordingCheck: boolean;
  signingWaiver: boolean;
  cancelling: boolean;
  chargingCard: boolean;
}

function parseTotalReceived(value: string, balanceDueCents: number): { totalReceivedCents: number; balancePaymentCents: number; tipCents: number; valid: boolean } {
  const raw = parseFloat(value);
  if (!isFinite(raw) || raw <= 0) return { totalReceivedCents: 0, balancePaymentCents: 0, tipCents: 0, valid: false };
  const totalReceivedCents = Math.round(raw * 100);
  const balancePaymentCents = Math.min(totalReceivedCents, balanceDueCents);
  const tipCents = Math.max(totalReceivedCents - balanceDueCents, 0);
  return { totalReceivedCents, balancePaymentCents, tipCents, valid: true };
}

function PaymentBreakdown({ totalValue, balanceDueCents }: { totalValue: string; balanceDueCents: number }) {
  const { totalReceivedCents, balancePaymentCents, tipCents, valid } = parseTotalReceived(totalValue, balanceDueCents);
  if (!valid) return null;
  return (
    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2 space-y-0.5">
      <div className="flex justify-between">
        <span>Balance due:</span>
        <span className="font-medium">{formatCurrency(balanceDueCents)}</span>
      </div>
      <div className="flex justify-between">
        <span>Balance payment:</span>
        <span className="font-medium text-green-700">{formatCurrency(balancePaymentCents)}</span>
      </div>
      <div className="flex justify-between">
        <span>Tip:</span>
        <span className={`font-medium ${tipCents > 0 ? 'text-blue-700' : 'text-slate-500'}`}>{formatCurrency(tipCents)}</span>
      </div>
      <div className="flex justify-between border-t border-slate-200 pt-0.5 mt-0.5">
        <span className="font-semibold">Total received:</span>
        <span className="font-semibold">{formatCurrency(totalReceivedCents)}</span>
      </div>
    </div>
  );
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
    const { totalReceivedCents, balancePaymentCents, tipCents, valid } = parseTotalReceived(cashAmount, task.balanceDue);
    if (!valid) return;
    await onCashPayment(balancePaymentCents, tipCents, totalReceivedCents);
    setShowCashPayment(false);
    setCashAmount('');
  }

  async function handleCheck() {
    const { totalReceivedCents, balancePaymentCents, tipCents, valid } = parseTotalReceived(checkAmount, task.balanceDue);
    if (!valid || !checkNumber.trim()) return;
    await onCheckPayment(balancePaymentCents, checkNumber.trim(), tipCents, totalReceivedCents);
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
          {/* Cash payment */}
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
                    Total Received ($)
                  </label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={cashAmount}
                    onChange={e => setCashAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                    placeholder={(task.balanceDue / 100).toFixed(2)}
                  />
                </div>
                <PaymentBreakdown totalValue={cashAmount} balanceDueCents={task.balanceDue} />
                <div className="flex gap-2">
                  <button
                    onClick={handleCash}
                    disabled={recordingCash || !parseTotalReceived(cashAmount, task.balanceDue).valid}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white text-sm font-semibold py-2 px-3 rounded"
                  >
                    {recordingCash ? 'Recording...' : 'Record Payment'}
                  </button>
                  <button
                    onClick={() => { setShowCashPayment(false); setCashAmount(''); }}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold py-2 px-3 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Check payment */}
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
                    Total Received ($)
                  </label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={checkAmount}
                    onChange={e => setCheckAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                    placeholder={(task.balanceDue / 100).toFixed(2)}
                  />
                </div>
                <PaymentBreakdown totalValue={checkAmount} balanceDueCents={task.balanceDue} />
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
                    disabled={recordingCheck || !parseTotalReceived(checkAmount, task.balanceDue).valid || !checkNumber.trim()}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-semibold py-2 px-3 rounded"
                  >
                    {recordingCheck ? 'Recording...' : 'Record Payment'}
                  </button>
                  <button
                    onClick={() => { setShowCheckPayment(false); setCheckAmount(''); setCheckNumber(''); }}
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
