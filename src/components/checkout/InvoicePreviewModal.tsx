import { PrintModal } from '../common/PrintModal';
import { PrintableInvoice } from '../invoice/PrintableInvoice';

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
  return (
    <PrintModal
      isOpen={true}
      onClose={onClose}
      title="Invoice Preview"
      maxWidth="5xl"
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
