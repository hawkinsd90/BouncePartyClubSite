import { Shield, Loader2, FileText } from 'lucide-react';
import { OrderSummary } from '../OrderSummary';
import { OrderSummaryDisplay } from '../../lib/orderSummary';

interface CheckoutSummaryProps {
  quoteData: any;
  orderSummary: OrderSummaryDisplay | null;
  processing: boolean;
  cardOnFileConsent: boolean;
  smsConsent: boolean;
  tipCents: number;
  onViewInvoice: () => void;
}

export function CheckoutSummary({
  quoteData,
  orderSummary,
  processing,
  cardOnFileConsent,
  smsConsent,
  tipCents,
  onViewInvoice,
}: CheckoutSummaryProps) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6 sticky top-24">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Order Summary</h2>

      <div className="space-y-4 mb-6">
        <div>
          <h4 className="font-semibold text-slate-900 mb-2">Event Details</h4>
          <p className="text-sm text-slate-600">
            {quoteData.event_date} at {quoteData.start_window}
          </p>
          <p className="text-sm text-slate-600">
            {quoteData.address_line1}, {quoteData.city}, {quoteData.state}{' '}
            {quoteData.zip}
          </p>
          <p className="text-sm text-slate-600 capitalize">
            {quoteData.location_type}
          </p>
        </div>
      </div>

      {orderSummary && (
        <OrderSummary
          summary={orderSummary}
          showDeposit={true}
          showTip={tipCents > 0}
          title=""
          className="mb-6"
        />
      )}

      <button
        type="button"
        onClick={onViewInvoice}
        className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center mb-3"
      >
        <FileText className="w-5 h-5 mr-2" />
        View as Invoice
      </button>

      <button
        type="submit"
        disabled={processing || !cardOnFileConsent || !smsConsent}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center"
      >
        {processing ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Shield className="w-5 h-5 mr-2" />
            Complete Booking
          </>
        )}
      </button>

      <p className="text-xs text-slate-500 text-center mt-4">
        Your payment information is secured with industry-standard encryption
      </p>
    </div>
  );
}
