interface PaymentBackfillSectionProps {
  onBackfill: () => void;
  backfilling: boolean;
}

export function PaymentBackfillSection({ onBackfill, backfilling }: PaymentBackfillSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Payment Method Backfill</h2>

      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-slate-700 mb-2">
          If you have existing payments that don't show payment method information on receipts, use this tool to retrieve that data from Stripe.
        </p>
        <p className="text-sm text-slate-600">
          This will fetch payment method details (card type, last 4 digits, etc.) for all past payments that are missing this information.
        </p>
      </div>

      <div className="space-y-4 max-w-2xl">
        <button
          onClick={onBackfill}
          disabled={backfilling}
          className="bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
        >
          {backfilling ? 'Processing...' : 'Backfill Payment Methods'}
        </button>
        <p className="text-xs text-slate-500">
          This process is safe and only adds missing information. It won't modify existing data.
        </p>
      </div>
    </div>
  );
}
