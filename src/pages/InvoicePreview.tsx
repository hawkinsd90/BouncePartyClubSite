import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Printer, AlertTriangle, ArrowLeft } from 'lucide-react';
import { SimpleInvoiceDisplay } from '../components/shared/SimpleInvoiceDisplay';
import { buildOrderSummary } from '../lib/checkoutUtils';

export function InvoicePreview() {
  const navigate = useNavigate();
  const location = useLocation();

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const returnTo = useMemo(() => {
    // Prefer the explicit return route if it exists
    const stored = sessionStorage.getItem('invoice-preview-return-to');
    return stored || '/checkout';
  }, []);

  useEffect(() => {
    try {
      const storedData = sessionStorage.getItem('invoice-preview-data');
      if (!storedData) {
        setError('No invoice data found. Please try again from the checkout page.');
        return;
      }

      const parsedData = JSON.parse(storedData);

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
    } catch (err) {
      console.error('Error loading invoice data:', err);
      setError('Failed to load invoice data. Please try again.');
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      sessionStorage.removeItem('invoice-preview-data');
      sessionStorage.removeItem('invoice-preview-return-to');
    };
  }, []);

  const handlePrint = () => {
    document.body.classList.add('print-invoice-preview');
    window.print();
    setTimeout(() => document.body.classList.remove('print-invoice-preview'), 250);
  };

  const handleBack = () => navigate(returnTo);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Unable to Load Invoice</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={handleBack}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors inline-flex items-center"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
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

  const isCheckoutFormat = !!data.quoteData;

  let eventData, orderItems, orderSummary;

  if (isCheckoutFormat) {
    const { quoteData, priceBreakdown, cart } = data;

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
      pickup_preference:
        quoteData.pickup_preference ||
        (quoteData.location_type === 'commercial' ? 'same_day' : 'next_day'),
      can_use_stakes: quoteData.can_stake ?? true,
      generator_qty:
        priceBreakdown.generator_fee_cents > 0
          ? quoteData.generator_qty || (quoteData.has_generator ? 1 : 0)
          : 0,
      tax_waived: quoteData.tax_waived || false,
      travel_fee_waived: quoteData.travel_fee_waived || false,
      surface_fee_waived: quoteData.surface_fee_waived || false,
      generator_fee_waived: quoteData.generator_fee_waived || false,
      same_day_pickup_fee_waived: quoteData.same_day_pickup_fee_waived || false,
    };

    orderItems = cart;
    orderSummary = buildOrderSummary(priceBreakdown, cart, quoteData, 0);
  } else {
    eventData = data.orderData;
    orderItems = data.orderItems;
    orderSummary = data.orderSummary;
  }

  return (
    <div className="invoice-preview-route min-h-screen bg-slate-50 py-6 px-4">
      {/* Top Bar (hidden when printing) */}
      <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="inline-flex items-center bg-white hover:bg-slate-50 text-slate-700 font-semibold py-2 px-3 rounded-lg border border-slate-200 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </button>

          <div className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">Invoice Preview</span>
            <span className="mx-2 text-slate-300">•</span>
            <span>Print / save as PDF</span>
          </div>
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          aria-label="Print or Save PDF"
        >
          <Printer className="w-4 h-4 mr-2" />
          Print / Save PDF
        </button>
      </div>

      {/* Invoice Content */}
      <div id="print-content-wrapper" className="max-w-3xl mx-auto">
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
  );
}
