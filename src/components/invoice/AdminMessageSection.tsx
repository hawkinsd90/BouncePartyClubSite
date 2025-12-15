interface AdminMessageSectionProps {
  message: string;
  onChange: (message: string) => void;
}

export function AdminMessageSection({ message, onChange }: AdminMessageSectionProps) {
  return (
    <div className="bg-slate-50 rounded-lg shadow p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
        Message to Customer
      </h3>
      <p className="text-sm text-slate-600 mb-4">
        Add an optional message to explain the invoice details to the customer. This will be
        included in the email and text notification.
      </p>
      <textarea
        value={message}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
        rows={4}
        placeholder="Example: Thanks for your order! We've included a generator since your event location doesn't have power outlets nearby. Looking forward to making your event amazing!"
      />
    </div>
  );
}
