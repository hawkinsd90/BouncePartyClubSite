import { X } from 'lucide-react';
import { SimpleInvoiceDisplay } from '../shared/SimpleInvoiceDisplay';
import { buildOrderSummary } from '../../lib/checkoutUtils';

interface InvoicePreviewModalProps {
  quoteData: any;
  priceBreakdown: any;
  cart: any[];
  onClose: () => void;
}

export function InvoicePreviewModal({
  quoteData,
  priceBreakdown,
  cart,
  onClose,
}: InvoicePreviewModalProps) {
  const handlePrint = () => {
    // Small delay to ensure modal is fully rendered before printing
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const canUseStakes = quoteData.can_stake ?? true;
  const pickupPreference = quoteData.pickup_preference || (quoteData.location_type === 'commercial' ? 'same_day' : 'next_day');
  const generatorQty = priceBreakdown.generator_fee_cents > 0 ? (quoteData.generator_qty || (quoteData.has_generator ? 1 : 0)) : 0;

  const orderSummary = buildOrderSummary(priceBreakdown, cart, quoteData, 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto" id="print-content-wrapper">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto relative shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex justify-between items-center z-10 no-print">
          <h2 className="text-2xl font-bold text-slate-900">Invoice Preview</h2>
          <button
            onClick={onClose}
            className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 mr-2" />
            Close
          </button>
        </div>

        <div className="p-4">
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
            showTip={false}
            onPrint={handlePrint}
          />
        </div>
      </div>
    </div>
  );
}
