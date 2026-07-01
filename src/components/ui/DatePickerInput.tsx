import { Calendar } from 'lucide-react';

interface DatePickerInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  showIcon?: boolean;
}

export function DatePickerInput({
  id,
  value,
  onChange,
  min,
  max,
  disabled = false,
  required = false,
  placeholder = 'Select date',
  className = '',
  showIcon = true,
}: DatePickerInputProps) {
  const formatDisplayDate = (isoDate: string): string => {
    if (!isoDate) return '';
    try {
      const date = new Date(isoDate + 'T00:00:00');
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const displayValue = formatDisplayDate(value);

  return (
    <div className="relative block w-full max-w-full min-w-0 box-border rounded-xl">
      {showIcon && (
        <Calendar className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none sm:h-5 sm:w-5" />
      )}

      <div
        className={`absolute inset-0 z-[1] box-border flex h-full w-full max-w-full min-w-0 items-center pointer-events-none ${
          showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'
        } pr-3 sm:pr-4`}
        aria-hidden="true"
      >
        {displayValue ? (
          <span className="min-w-0 flex-1 truncate text-base font-medium text-slate-900">
            {displayValue}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-base text-slate-400">
            {placeholder}
          </span>
        )}
      </div>

      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        className={`block h-12 w-full max-w-full min-w-0 box-border appearance-none rounded-xl border-2 border-slate-300 bg-white ${
          showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'
        } pr-3 sm:pr-4 py-2.5 transition-all cursor-pointer hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:cursor-not-allowed ${className}`}
        style={{
          WebkitAppearance: 'none',
          appearance: 'none',
          fontSize: '16px',
          minHeight: '48px',
          colorScheme: 'light',
          color: 'transparent',
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: '100%',
          minWidth: '0',
          display: 'block',
        }}
      />
    </div>
  );
}