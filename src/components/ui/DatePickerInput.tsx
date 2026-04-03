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
    <div className="relative">
      {showIcon && (
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none z-10" />
      )}
      <div
        className={`w-full ${showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'} pr-3 sm:pr-4 py-2.5 border-2 border-slate-300 rounded-xl text-slate-900 font-medium transition-all select-none pointer-events-none ${
          disabled ? 'bg-slate-100 text-slate-500' : 'bg-white hover:border-blue-400'
        } ${className}`}
        style={{ fontSize: '16px', minHeight: '44px', display: 'flex', alignItems: 'center' }}
        aria-hidden="true"
      >
        {displayValue || <span className="text-slate-400">{placeholder}</span>}
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
        tabIndex={disabled ? -1 : 0}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        style={{ fontSize: '16px' }}
      />
    </div>
  );
}
