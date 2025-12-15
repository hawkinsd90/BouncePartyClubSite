import { Shield, Loader2, Printer } from 'lucide-react';
import { PrintableInvoice } from '../PrintableInvoice';

interface CheckoutSummaryProps {
  quoteData: any;
  priceBreakdown: any;
  cart: any[];
  contactData: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    business_name: string;
  };
  processing: boolean;
  cardOnFileConsent: boolean;
  smsConsent: boolean;
}

export function CheckoutSummary({
  quoteData,
  priceBreakdown,
  cart,
  contactData,
  processing,
  cardOnFileConsent,
  smsConsent,
}: CheckoutSummaryProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <PrintableInvoice
          quoteData={quoteData}
          priceBreakdown={priceBreakdown}
          cart={cart}
          contactData={contactData}
          invoiceNumber={`QUOTE-${Date.now().toString().slice(-8)}`}
          isPaid={false}
        />
      </div>

      <div className="bg-white rounded-xl shadow-md p-6 sticky top-24">
        <button
          type="button"
          onClick={() => window.print()}
          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center mb-3"
        >
          <Printer className="w-5 h-5 mr-2" />
          Print / Save PDF
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
    </div>
  );
}
