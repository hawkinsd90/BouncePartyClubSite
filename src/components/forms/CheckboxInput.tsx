interface CheckboxInputProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  error?: string;
  helpText?: string;
  className?: string;
}

export function CheckboxInput({
  label,
  checked,
  onChange,
  disabled = false,
  error,
  helpText,
  className = '',
}: CheckboxInputProps) {
  return (
    <div className={className}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="mt-1 w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed"
        />
        <span className="text-sm text-slate-700">{label}</span>
      </label>
      {error && (
        <p className="mt-1 text-sm text-red-600 ml-7">{error}</p>
      )}
      {helpText && !error && (
        <p className="mt-1 text-sm text-slate-500 ml-7">{helpText}</p>
      )}
    </div>
  );
}
