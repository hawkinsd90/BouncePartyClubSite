import { Clock } from 'lucide-react';

interface TimePickerInputProps {
  id?: string;
  value: string; // HH:mm format
  onChange: (value: string) => void;
  min?: string; // HH:mm format
  max?: string; // HH:mm format
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  showIcon?: boolean;
}

export function TimePickerInput({
  id,
  value,
  onChange,
  min,
  max,
  disabled = false,
  required = false,
  placeholder = 'Select time',
  className = '',
  showIcon = false,
}: TimePickerInputProps) {
  const formatDisplayTime = (time24: string): string => {
    if (!time24) return '';
    try {
      const [hours, minutes] = time24.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours % 12 || 12;
      return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
    } catch {
      return '';
    }
  };

  const displayValue = formatDisplayTime(value);

  return (
    <div className="relative block w-full max-w-full min-w-0 box-border rounded-lg">
      {showIcon && (
        <Clock className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none sm:h-5 sm:w-5" />
      )}

      {/* Visible styled display layer */}
      <div
        className={`absolute inset-0 z-[1] box-border flex h-full w-full max-w-full min-w-0 items-center pointer-events-none ${
          showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'
        } pr-10 sm:pr-11`}
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

      {/* Native time input. Text is transparent so the display layer shows through. */}
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        className={`block h-12 w-full max-w-full min-w-0 box-border rounded-lg border border-slate-300 bg-white ${
          showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'
        } pr-10 sm:pr-11 py-2.5 transition-all cursor-pointer hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:cursor-not-allowed ${className}`}
        style={{
          fontSize: '16px',
          minHeight: '48px',
          colorScheme: 'light',
          color: 'transparent',
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        }}
      />
    </div>
  );
}
