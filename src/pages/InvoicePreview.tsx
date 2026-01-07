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

      // Support two data formats:
      // 1. From checkout: quoteData, priceBreakdown, cart, contactData
      // 2. From customer portal: orderData, orderItems, orderSummary, contactData
      const hasCheckoutFormat = parsedData.quoteData && parsedData.priceBreakdown && parsedData.cart;
      const hasPortalFormat = parsedData.orderData && parsedData.orderItems && parsedData.orderSummary;

      if (!hasCheckoutFormat && !hasPortalFormat) {
        setError('Incomplete invoice data. Please try again.');
        return;
      }

      if (!parsedData.contactData) {
        setError('Missing contact information. Please try again.');
        return;
      }

      setData(parsedData);

      // Don't remove immediately - keep it for page refreshes
      // It will be cleared when the user closes the tab or navigates away
    } catch (err) {
      console.error('Error loading invoice data:', err);
      setError('Failed to load invoice data. Please try again.');
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

  // Handle both data formats
  const isCheckoutFormat = !!data.quoteData;

  let eventData, orderItems, orderSummary, contactData;

  if (isCheckoutFormat) {
    // From checkout page
    const { quoteData, priceBreakdown, cart } = data;
    contactData = data.contactData;

    eventData = {
      event_date: quoteData.event_date,
      start_window: quoteData.start_window,
      end_window: quoteData.end_window,
      address_line1: quoteData.address_line1,
      address_line2: quoteData.address_line2,
      city: quoteData.city,
      state: quoteData.state,
      zip: quoteData.zip,
      location_type: quoteData.location_type,
      pickup_preference: quoteData.pickup_preference || (quoteData.location_type === 'commercial' ? 'same_day' : 'next_day'),
      can_use_stakes: quoteData.can_stake ?? true,
      generator_qty: priceBreakdown.generator_fee_cents > 0 ? (quoteData.generator_qty || (quoteData.has_generator ? 1 : 0)) : 0,
      tax_waived: quoteData.tax_waived || false,
      travel_fee_waived: quoteData.travel_fee_waived || false,
      surface_fee_waived: quoteData.surface_fee_waived || false,
      generator_fee_waived: quoteData.generator_fee_waived || false,
      same_day_pickup_fee_waived: quoteData.same_day_pickup_fee_waived || false,
    };

    orderItems = cart;
    orderSummary = buildOrderSummary(priceBreakdown, cart, quoteData, 0);
  } else {
    // From customer portal
    eventData = data.orderData;
    orderItems = data.orderItems;
    orderSummary = data.orderSummary;
    contactData = data.contactData;
  }

  const handlePrint = () => {
    window.print();
  };

  const handleClose = () => {
    window.close();
  };

  return (
    <>
      <style>{`
        @media print {
          body {
            background: white !important;
          }
          .min-h-screen {
            min-height: auto !important;
            background: white !important;
          }
          .bg-slate-50 {
            background: white !important;
          }
        }
      `}</style>
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
          eventDate={eventData.event_date}
          startWindow={eventData.start_window}
          endWindow={eventData.end_window}
          addressLine1={eventData.address_line1}
          addressLine2={eventData.address_line2}
          city={eventData.city}
          state={eventData.state}
          zip={eventData.zip}
          locationType={eventData.location_type}
          pickupPreference={eventData.pickup_preference}
          canUseStakes={eventData.can_use_stakes}
          generatorQty={eventData.generator_qty || 0}
          orderItems={orderItems}
          orderSummary={orderSummary}
          taxWaived={eventData.tax_waived || false}
          travelFeeWaived={eventData.travel_fee_waived || false}
          surfaceFeeWaived={eventData.surface_fee_waived || false}
          generatorFeeWaived={eventData.generator_fee_waived || false}
          sameDayPickupFeeWaived={eventData.same_day_pickup_fee_waived || false}
          showTip={orderSummary ? orderSummary.tip > 0 : false}
          onPrint={handlePrint}
        />
      </div>
      </div>
    </>
  );
}
