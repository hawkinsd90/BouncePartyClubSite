interface AdminMessageProps {
  value: string;
  onChange: (value: string) => void;
}

export function AdminMessage({ value, onChange }: AdminMessageProps) {
  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
      <h3 className="font-semibold text-slate-900 mb-3">Message to Customer</h3>
      <p className="text-sm text-slate-600 mb-3">
        Add an optional message to explain the changes to the customer. This will be included in the email and text notification.
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Example: We're upgrading your bounce house to a larger unit at no extra charge! Also added a generator since your event location doesn't have power outlets nearby."
        rows={4}
        className="w-full px-3 py-2 border border-slate-300 rounded text-sm resize-none"
      />
      {value.trim() && (
        <p className="text-xs text-purple-600 mt-2">
          This message will be sent to the customer when you save changes.
        </p>
      )}
    </div>
  );
}
