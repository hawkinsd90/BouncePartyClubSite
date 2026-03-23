import { CheckCircle, DollarSign, AlertTriangle, FileCheck, Clock } from 'lucide-react';
import { formatCurrency } from '../../../lib/pricing';

export interface CompletionSummaryData {
  orderNumber: string;
  customerName: string;
  totalCents: number;
  depositPaidCents: number;
  balancePaidCents: number;
  tipCents: number;
  remainingBalanceCents: number;
  paymentMethods: string[];
  waiverSigned: boolean;
  completionTime: Date;
  hadBalanceWarning: boolean;
}

interface Props {
  summary: CompletionSummaryData;
  onClose: () => void;
}

export function PickupCompletionSummary({ summary, onClose }: Props) {
  const collectedTotal = summary.depositPaidCents + summary.balancePaidCents + summary.tipCents;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="bg-green-600 rounded-t-2xl px-6 py-5 text-white">
          <div className="flex items-center gap-3 mb-1">
            <CheckCircle className="w-7 h-7" />
            <h2 className="text-xl font-bold">Pickup Complete</h2>
          </div>
          <p className="text-green-100 text-sm">
            {summary.completionTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} —{' '}
            {summary.completionTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Order</p>
            <p className="font-bold text-slate-900 text-lg">#{summary.orderNumber}</p>
            <p className="text-slate-600 text-sm">{summary.customerName}</p>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Payment Summary</p>

            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Order Total</span>
              <span className="font-semibold text-slate-900">{formatCurrency(summary.totalCents)}</span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Deposit Paid</span>
              <span className="font-semibold text-green-700">{formatCurrency(summary.depositPaidCents)}</span>
            </div>

            {summary.balancePaidCents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Balance Paid</span>
                <span className="font-semibold text-green-700">{formatCurrency(summary.balancePaidCents)}</span>
              </div>
            )}

            {summary.tipCents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Crew Tip</span>
                <span className="font-semibold text-green-700">+{formatCurrency(summary.tipCents)}</span>
              </div>
            )}

            <div className="border-t border-slate-200 pt-2 flex justify-between text-sm">
              <span className="font-semibold text-slate-900">Total Collected</span>
              <span className="font-bold text-slate-900">{formatCurrency(collectedTotal)}</span>
            </div>

            {summary.remainingBalanceCents > 0 && (
              <div className="flex justify-between text-sm pt-1">
                <span className="font-semibold text-red-700">Remaining Balance</span>
                <span className="font-bold text-red-700">{formatCurrency(summary.remainingBalanceCents)}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <FileCheck className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Waiver</span>
              </div>
              <span className={`text-sm font-semibold ${summary.waiverSigned ? 'text-green-700' : 'text-red-600'}`}>
                {summary.waiverSigned ? 'Signed' : 'Not Signed'}
              </span>
            </div>

            <div className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <DollarSign className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment</span>
              </div>
              <span className="text-sm font-semibold text-slate-900">
                {summary.paymentMethods.length > 0
                  ? summary.paymentMethods.join(', ')
                  : summary.depositPaidCents > 0 ? 'Card' : 'Pending'}
              </span>
            </div>
          </div>

          {summary.hadBalanceWarning && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 font-medium">
                Completed with outstanding balance. Follow up with customer for remaining payment.
              </p>
            </div>
          )}

          {!summary.waiverSigned && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-800 font-medium">
                Waiver was not signed. Follow up with customer.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Clock className="w-4 h-4" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
