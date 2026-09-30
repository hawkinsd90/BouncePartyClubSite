import { Send, Copy, Check } from 'lucide-react';

interface Props {
  saving: boolean;
  hasNoActiveItems: boolean;
  hasAvailabilityIssues: boolean;
  generatorResolutionPending: boolean;
  checkingAvailability: boolean;
  pricingIsCurrent: boolean;
  hasSelectedCustomer: boolean;
  invoiceUrl: string;
  copiedLink: boolean;
  onGenerate: () => void;
  onCopyLink: () => void;
}

// Display only. InvoiceBuilder owns invoice generation, the link and the copied state.
export function InvoiceActions({
  saving,
  hasNoActiveItems,
  hasAvailabilityIssues,
  generatorResolutionPending,
  checkingAvailability,
  pricingIsCurrent,
  hasSelectedCustomer,
  invoiceUrl,
  copiedLink,
  onGenerate,
  onCopyLink,
}: Props) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 lg:p-6 min-w-0">
      <button
        onClick={onGenerate}
        disabled={saving || hasNoActiveItems || hasAvailabilityIssues || generatorResolutionPending || checkingAvailability || !pricingIsCurrent}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm sm:text-base"
      >
        <Send className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
        <span className="truncate">
          {saving
            ? 'Generating...'
            : hasAvailabilityIssues
              ? 'Resolve Availability Issues'
              : hasSelectedCustomer
                ? 'Send Invoice to Customer'
                : 'Generate Shareable Link'}
        </span>
      </button>
      <p className="text-xs text-slate-500 text-center mt-2">
        {hasSelectedCustomer
          ? 'Invoice will be sent via email and SMS'
          : 'A shareable link will be generated for you to send manually'}
      </p>
      {invoiceUrl && (
        <button
          onClick={onCopyLink}
          title="Copy invoice link"
          className="mt-2 w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-sm"
        >
          {copiedLink ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
          {copiedLink ? 'Copied!' : 'Copy Link'}
        </button>
      )}
    </div>
  );
}
