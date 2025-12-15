import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface InvoiceSuccessMessageProps {
  invoiceUrl: string;
  hasSelectedCustomer: boolean;
}

export function InvoiceSuccessMessage({ invoiceUrl, hasSelectedCustomer }: InvoiceSuccessMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(invoiceUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4 sm:p-6">
      <div className="flex items-center mb-4">
        <Check className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 mr-2" />
        <h3 className="text-base sm:text-lg font-semibold text-green-900">Invoice Created!</h3>
      </div>
      <p className="text-sm sm:text-base text-green-800 mb-4">
        {hasSelectedCustomer
          ? 'Invoice has been sent to the customer via email and SMS.'
          : 'Copy the link below and send it to your customer to fill in their information and accept the invoice.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={invoiceUrl}
          readOnly
          className="flex-1 px-3 sm:px-4 py-2 border border-green-300 rounded-lg bg-white text-slate-900 text-sm"
        />
        <button
          onClick={handleCopy}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors whitespace-nowrap text-sm sm:text-base"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy Link
            </>
          )}
        </button>
      </div>
    </div>
  );
}
