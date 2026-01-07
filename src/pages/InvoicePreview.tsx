import { useEffect, useState } from 'react';
import { Printer, X, AlertTriangle } from 'lucide-react';
import { SimpleInvoiceDisplay } from '../components/shared/SimpleInvoiceDisplay';
import { buildOrderSummary } from '../lib/checkoutUtils';

export function InvoicePreview() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      // Get data from sessionStorage (more reliable than localStorage for this use case)
      const storedData = sessionStorage.getItem('invoice-preview-data');
      if (!storedData) {
        setError('No invoice data found. Please try again from the checkout page.');
        return;
      }

      const parsedData = JSON.parse(storedData);

      // Validate required data exists
      if (!parsedData.quoteData || !parsedData.priceBreakdown || !parsedData.cart || !parsedData.contactData) {
        setError('Incomplete invoice data. Please try again from the checkout page.');
        return;
      }

      setData(parsedData);

      // Don't remove immediately - keep it for page refreshes
      // It will be cleared when the user closes the tab or navigates away
    } catch (err) {
      console.error('Error loading invoice data:', err);
      setError('Failed to load invoice data. Please try again from the checkout page.');
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      sessionStorage.removeItem('invoice-preview-data');
    };
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Unable to Load Invoice</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={() => window.close()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            Close Window
          </button>
        </div>
      </div>
    );
  }

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
          locationType={quoteData.location_type}
          pickupPreference={pickupPreference}
          canUseStakes={canUseStakes}
          generatorQty={generatorQty}
          orderItems={cart}
          orderSummary={orderSummary}
          taxWaived={quoteData.tax_waived || false}
          travelFeeWaived={quoteData.travel_fee_waived || false}
          surfaceFeeWaived={quoteData.surface_fee_waived || false}
          generatorFeeWaived={quoteData.generator_fee_waived || false}
          sameDayPickupFeeWaived={quoteData.same_day_pickup_fee_waived || false}
          showTip={false}
          onPrint={handlePrint}
        />
      </div>
    </div>
  );
}
