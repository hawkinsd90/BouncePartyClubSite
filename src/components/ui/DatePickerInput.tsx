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
    <div className="relative">
      {showIcon && (
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none z-10" />
      )}
      {/* Visible styled display layer */}
      <div
        className={`absolute inset-0 flex items-center pointer-events-none z-[1] ${
          showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'
        } pr-3 sm:pr-4`}
        aria-hidden="true"
      >
        {displayValue ? (
          <span className="text-slate-900 font-medium text-base">{displayValue}</span>
        ) : (
          <span className="text-slate-400 text-base">Select date</span>
        )}
      </div>
      {/* Native date input — visible but styled to be transparent so the display layer shows through.
          The calendar picker icon from the browser is preserved at the right edge. */}
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        className={`w-full ${showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'} pr-3 sm:pr-4 py-2.5 border-2 border-slate-300 rounded-xl bg-white hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 transition-all cursor-pointer disabled:bg-slate-100 disabled:cursor-not-allowed ${className}`}
        style={{
          fontSize: '16px',
          minHeight: '44px',
          colorScheme: 'light',
          color: 'transparent',
        }}
      />
    </div>
  );
}
