import { Clock } from 'lucide-react';
import { useRef } from 'react';

interface TimePickerInputProps {
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
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

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

  // Handle clicking the text input - open the native picker
  const handleInputClick = () => {
    if (!disabled) {
      pickerRef.current?.showPicker?.();
    }
  };

  // Handle focus on text input
  const handleInputFocus = () => {
    if (!disabled) {
      pickerRef.current?.showPicker?.();
    }
  };

  return (
    <div className="relative">
      {/* Visible text input */}
      <div className="relative">
        {showIcon && (
          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none z-10" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onClick={handleInputClick}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          readOnly
          style={{ fontSize: '16px' }}
          className={`w-full ${showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'} pr-3 sm:pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 transition-shadow disabled:bg-slate-100 disabled:cursor-not-allowed cursor-pointer ${className}`}
        />
      </div>

      {/* Hidden native time picker */}
      <input
        ref={pickerRef}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        className="absolute opacity-0 pointer-events-none"
        tabIndex={-1}
        style={{ position: 'absolute', left: '-9999px' }}
      />
    </div>
  );
}
