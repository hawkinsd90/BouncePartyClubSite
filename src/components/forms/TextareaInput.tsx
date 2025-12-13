interface TextareaInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  rows?: number;
  error?: string;
  helpText?: string;
  className?: string;
}

export function TextareaInput({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  rows = 4,
  error,
  helpText,
  className = '',
}: TextareaInputProps) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        rows={rows}
        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base transition-colors resize-y ${
          error
            ? 'border-red-300 bg-red-50'
            : 'border-slate-300 bg-white'
        } ${disabled ? 'bg-slate-100 cursor-not-allowed' : ''}`}
      />
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
      {helpText && !error && (
        <p className="mt-1 text-sm text-slate-500">{helpText}</p>
      )}
    </div>
  );
}
