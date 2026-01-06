import { useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { SimpleInvoiceDisplay } from '../components/shared/SimpleInvoiceDisplay';
import { buildOrderSummary } from '../lib/checkoutUtils';

export function InvoicePreview() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    // Get data from localStorage (set by the opening window)
    const storedData = localStorage.getItem('invoice-preview-data');
    if (storedData) {
      setData(JSON.parse(storedData));
      // Clean up after reading
      localStorage.removeItem('invoice-preview-data');
    }
  }, []);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading invoice...</p>
        </div>
      </div>
    );
  }

  const { quoteData, priceBreakdown, cart, contactData } = data;
  const canUseStakes = quoteData.can_stake ?? true;
  const pickupPreference = quoteData.pickup_preference || (quoteData.location_type === 'commercial' ? 'same_day' : 'next_day');
  const generatorQty = priceBreakdown.generator_fee_cents > 0 ? (quoteData.generator_qty || (quoteData.has_generator ? 1 : 0)) : 0;

  const orderSummary = buildOrderSummary(priceBreakdown, cart, quoteData, 0);

  const handlePrint = () => {
    window.print();
  };

  const handleClose = () => {
    window.close();
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      {/* Action Bar - Hidden when printing */}
      <div className="max-w-3xl mx-auto mb-4 flex justify-end gap-2 no-print">
        <button
          onClick={handlePrint}
          className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          aria-label="Print or Save PDF"
        >
          <Printer className="w-4 h-4 mr-2" />
          Print / Save PDF
        </button>
        <button
          onClick={handleClose}
          className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
          aria-label="Close window"
        >
          <X className="w-4 h-4 mr-2" />
          Close
        </button>
      </div>

      {/* Invoice Content */}
      <div className="max-w-3xl mx-auto">
        <SimpleInvoiceDisplay
          eventDate={quoteData.event_date}
          startWindow={quoteData.start_window}
          endWindow={quoteData.end_window}
          addressLine1={quoteData.address_line1}
          addressLine2={quoteData.address_line2}
          city={quoteData.city}
          state={quoteData.state}
          zip={quoteData.zip}
          firstName={contactData.first_name}
          lastName={contactData.last_name}
          email={contactData.email}
          phone={contactData.phone}
          businessName={contactData.business_name}
          orderSummary={orderSummary}
          generatorQty={generatorQty}
          sandbags={!canUseStakes}
          pickupPreference={pickupPreference}
          specialInstructions={quoteData.special_instructions}
        />
      </div>
    </div>
  );
}
