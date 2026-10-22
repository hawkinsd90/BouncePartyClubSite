import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface InvoiceSuccessMessageProps {
  invoiceUrl: string;
  hasSelectedCustomer: boolean;
}

export function InvoiceSuccessMessage({ invoiceUrl, hasSelectedCustomer }: InvoiceSuccessMessageProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The form below is cleared after a successful send and the person is usually at the bottom of it: bring the result into view.
  useEffect(() => {
    boxRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [invoiceUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(invoiceUrl);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some phone browsers refuse clipboard access: select the link so it can be copied by hand.
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyFailed(true);
    }
  };

  return (
    <div ref={boxRef} role="status" className="bg-green-50 border-2 border-green-500 rounded-lg p-4 sm:p-6 scroll-mt-24">
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
          ref={inputRef}
          type="text"
          value={invoiceUrl}
          readOnly
          aria-label="Invoice link"
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 px-3 sm:px-4 py-2 min-h-[44px] border border-green-300 rounded-lg bg-white text-slate-900 text-sm"
        />
        <button
          onClick={handleCopy}
          className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors whitespace-nowrap text-sm sm:text-base"
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
      {copyFailed && <p className="mt-2 text-xs text-green-900">The link is selected. Copy it with your phone Copy command.</p>}
    </div>
  );
}
