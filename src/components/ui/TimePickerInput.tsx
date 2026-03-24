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
  // Format time for display (convert 24h to 12h format)
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
    <div className="relative">
      {/* Styled display element */}
      <div className="relative">
        {showIcon && (
          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none z-10" />
        )}
        <div
          className={`w-full ${showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'} pr-3 sm:pr-4 py-2.5 border border-slate-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent text-slate-900 transition-shadow ${
            disabled ? 'bg-slate-100 cursor-not-allowed text-slate-500' : 'bg-white cursor-pointer'
          } ${className}`}
          style={{ fontSize: '16px', minHeight: '44px', display: 'flex', alignItems: 'center' }}
        >
          {displayValue || <span className="text-slate-400">{placeholder}</span>}
        </div>
      </div>

      {/* Native time input overlaid (invisible but receives taps and clicks) */}
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        style={{ fontSize: '16px', zIndex: 10 }}
        aria-label={placeholder}
      />
    </div>
  );
}
