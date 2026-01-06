import { PrintModal } from '../common/PrintModal';
import { PrintableInvoice } from '../invoice/PrintableInvoice';
import { showToast } from '../../lib/notifications';

interface InvoicePreviewModalProps {
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
  onClose: () => void;
}

export function InvoicePreviewModal({
  quoteData,
  priceBreakdown,
  cart,
  contactData,
  onClose,
}: InvoicePreviewModalProps) {
  const handleBeforePrint = () => {
    console.log('Preparing invoice for printing...');
  };

  const handleAfterPrint = () => {
    console.log('Invoice print completed');
  };

  const handlePrintError = (error: Error) => {
    console.error('Print error:', error);
    showToast(`Print failed: ${error.message}`, 'error');
  };

  // Enhance quoteData with additional fields needed for the invoice
  const enhancedQuoteData = {
    ...quoteData,
    surface: quoteData.surface || (quoteData.can_stake ? 'grass' : 'cement'),
    pickup_preference: quoteData.pickup_preference || (quoteData.location_type === 'commercial' ? 'same_day' : 'next_day'),
    generator_qty: priceBreakdown.generator_fee_cents > 0 ? (quoteData.generator_qty || (quoteData.has_generator ? 1 : 0)) : 0,
  };

  return (
    <PrintModal
      isOpen={true}
      onClose={onClose}
      title="Invoice Preview"
      maxWidth="5xl"
      documentType="invoice"
      showZoomControls={true}
      onBeforePrint={handleBeforePrint}
      onAfterPrint={handleAfterPrint}
      onPrintError={handlePrintError}
    >
      <PrintableInvoice
        quoteData={enhancedQuoteData}
        priceBreakdown={priceBreakdown}
        cart={cart}
        contactData={contactData}
        invoiceNumber={`QUOTE-${Date.now().toString().slice(-8)}`}
        isPaid={false}
      />
    </PrintModal>
  );
}
