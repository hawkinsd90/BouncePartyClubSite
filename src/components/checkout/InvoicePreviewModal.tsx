import { X, Printer } from 'lucide-react';
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
  const handlePrint = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto no-print">
      <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto relative">
        <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex justify-between items-center z-10 no-print">
          <h2 className="text-2xl font-bold text-slate-900">Invoice Preview</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              <X className="w-4 h-4 mr-2" />
              Close
            </button>
          </div>
        </div>
        <div className="p-4 no-print">
          <PrintableInvoice
            quoteData={quoteData}
            priceBreakdown={priceBreakdown}
            cart={cart}
            contactData={contactData}
            invoiceNumber={`QUOTE-${Date.now().toString().slice(-8)}`}
            isPaid={false}
          />
        </div>
      </div>
    </div>
  );
}
