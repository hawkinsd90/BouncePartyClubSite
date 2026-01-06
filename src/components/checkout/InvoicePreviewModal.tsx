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
        quoteData={quoteData}
        priceBreakdown={priceBreakdown}
        cart={cart}
        contactData={contactData}
        invoiceNumber={`QUOTE-${Date.now().toString().slice(-8)}`}
        isPaid={false}
      />
    </PrintModal>
  );
}
