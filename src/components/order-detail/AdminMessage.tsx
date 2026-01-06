interface AdminMessageProps {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  variant?: 'order-edit' | 'invoice';
}

export function AdminMessage({ value, onChange, compact = false, variant = 'order-edit' }: AdminMessageProps) {
  const containerClass = compact
    ? variant === 'order-edit'
      ? 'bg-purple-50 rounded-lg shadow p-4 sm:p-6'
      : 'bg-slate-50 rounded-lg shadow p-4 sm:p-6'
    : variant === 'order-edit'
      ? 'bg-purple-50 border border-purple-200 rounded-lg p-4'
      : 'bg-slate-50 rounded-lg p-4';

  const headingClass = compact ? 'text-base sm:text-lg font-semibold text-slate-900 mb-2' : 'font-semibold text-slate-900 mb-3';
  const descriptionClass = compact ? 'text-sm text-slate-600 mb-4' : 'text-sm text-slate-600 mb-3';

  const placeholderText = variant === 'order-edit'
    ? "Example: We're upgrading your bounce house to a larger unit at no extra charge! Also added a generator since your event location doesn't have power outlets nearby."
    : "Example: Thanks for your order! We've included a generator since your event location doesn't have power outlets nearby. Looking forward to making your event amazing!";

  const descriptionText = variant === 'order-edit'
    ? 'Add an optional message to explain the changes to the customer. This will be included in the email and text notification.'
    : 'Add an optional message to explain the invoice details to the customer. This will be included in the email and text notification.';

  return (
    <div className={containerClass}>
      <h3 className={headingClass}>
        Message to Customer
      </h3>
      <p className={descriptionClass}>
        {descriptionText}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none"
        rows={4}
        placeholder={placeholderText}
      />
      {variant === 'order-edit' && value.trim() && (
        <p className="text-xs text-purple-600 mt-2">
          This message will be sent to the customer when you save changes.
        </p>
      )}
    </div>
  );
}
