import { useState } from 'react';
import { DollarSign, FileCheck, Ban } from 'lucide-react';
import { formatCurrency } from '../../../lib/pricing';
import { Task } from '../../../hooks/useCalendarTasks';

interface Props {
  task: Task;
  onCashPayment: (amountCents: number) => Promise<void>;
  onPaperWaiver: () => Promise<void>;
  onCancelOrder: (reason: string) => Promise<void>;
  recordingCash: boolean;
  signingWaiver: boolean;
  cancelling: boolean;
}

export function TaskDetailOrderManagement({
  task, onCashPayment, onPaperWaiver, onCancelOrder,
  recordingCash, signingWaiver, cancelling,
}: Props) {
  const [showCashPayment, setShowCashPayment] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  async function handleCash() {
    const amountCents = Math.round(parseFloat(cashAmount) * 100);
    if (!amountCents || amountCents <= 0) return;
    await onCashPayment(amountCents);
    setShowCashPayment(false);
    setCashAmount('');
  }

  async function handleCancel() {
    if (!cancelReason.trim() || cancelReason.trim().length < 10) return;
    await onCancelOrder(cancelReason);
  }

  return (
    <div className="bg-slate-50 rounded-lg p-4 space-y-3">
      <h3 className="font-bold text-slate-900 mb-3">Order Management</h3>

      {task.balanceDue > 0 && (
        <div>
          <button
            onClick={() => setShowCashPayment(!showCashPayment)}
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
                onChange={e => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                rows={3}
                placeholder="e.g., Weather cancellation, Customer request, Equipment failure"
              />
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
