interface PaymentLinkSectionProps {
  paymentUrl: string;
  onCopyLink: () => void;
  onSendLink: () => void;
  isSending: boolean;
}

export function PaymentLinkSection({
  paymentUrl,
  onCopyLink,
  onSendLink,
  isSending,
}: PaymentLinkSectionProps) {
  return (
    <div className="p-4 bg-white rounded-lg border border-blue-200">
      <h4 className="text-sm font-semibold text-slate-700 mb-2">Payment Link</h4>
      <p className="text-xs text-slate-600 mb-3">
        Send this link to the customer to collect deposit payment:
      </p>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={paymentUrl}
          readOnly
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50"
        />
        <button
          onClick={onCopyLink}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Copy Link
        </button>
      </div>
      <button
        onClick={onSendLink}
        disabled={isSending}
        className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
      >
        {isSending ? 'Sending...' : 'Send Payment Link via SMS'}
      </button>
    </div>
  );
}
