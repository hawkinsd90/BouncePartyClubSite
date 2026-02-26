import { Calendar } from 'lucide-react';

interface DatePickerInputProps {
  id?: string;
  value: string; // ISO format YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string; // ISO format YYYY-MM-DD
  max?: string; // ISO format YYYY-MM-DD
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
  // Format date for display
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
    <div className="relative">
      {/* Styled display element */}
      <div className="relative">
        {showIcon && (
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none z-10" />
        )}
        <div
          className={`w-full ${showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'} pr-3 sm:pr-4 py-2.5 border-2 border-slate-300 rounded-xl focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 text-slate-900 font-medium transition-all ${
            disabled ? 'bg-slate-100 cursor-not-allowed text-slate-500' : 'bg-white cursor-pointer'
          } ${className}`}
          style={{ fontSize: '16px', minHeight: '44px', display: 'flex', alignItems: 'center' }}
        >
          {displayValue || <span className="text-slate-400">{placeholder}</span>}
        </div>
      </div>

      {/* Native date input overlaid (invisible but receives taps) */}
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        style={{ fontSize: '16px' }}
        aria-label={placeholder}
      />
    </div>
  );
}
