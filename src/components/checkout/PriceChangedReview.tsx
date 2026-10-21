import { formatCurrency } from '../../lib/pricing';
import type { ServerTotals } from '../../lib/booking/bookingApi';

interface PriceChangedReviewProps {
  /** The price the customer was shown. */
  previous: ServerTotals;
  /** The price the server computed just now from the live catalog and rules. */
  updated: ServerTotals;
  busy?: boolean;
  onAccept: () => void;
  onReview: () => void;
}

// Shown when the server prices the booking differently from what the page displayed (prices or fees changed since the quote was made).
// Nothing has been created or charged at this point: the customer chooses whether to continue at the new price.
export function PriceChangedReview({ previous, updated, busy = false, onAccept, onReview }: PriceChangedReviewProps) {
  const cheaper = updated.totalCents < previous.totalCents;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="price-changed-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="price-changed-title" className="text-xl font-bold text-slate-900 mb-2">
          {cheaper ? 'Your price has gone down' : 'Your price has changed'}
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Prices or fees were updated since your quote was prepared. Nothing has been charged. Please review the new amounts before continuing.
        </p>
        <dl className="mb-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Total shown before</dt>
            <dd className="font-semibold text-slate-500 line-through">{formatCurrency(previous.totalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-900 font-semibold">New total</dt>
            <dd className="font-bold text-slate-900">{formatCurrency(updated.totalCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2">
            <dt className="text-slate-600">Deposit shown before</dt>
            <dd className="font-semibold text-slate-500 line-through">{formatCurrency(previous.depositCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-900 font-semibold">New deposit</dt>
            <dd className="font-bold text-slate-900">{formatCurrency(updated.depositCents)}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-slate-400"
          >
            Accept new price and continue
          </button>
          <button
            type="button"
            onClick={onReview}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-lg bg-slate-100 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-200"
          >
            Review my quote
          </button>
        </div>
      </div>
    </div>
  );
}
