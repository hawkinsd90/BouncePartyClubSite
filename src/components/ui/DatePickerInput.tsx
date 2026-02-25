import { Calendar } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface DatePickerInputProps {
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
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

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
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none z-10" />
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
          className={`w-full ${showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'} pr-3 sm:pr-4 py-2.5 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 font-medium transition-all disabled:bg-slate-100 disabled:cursor-not-allowed cursor-pointer ${className}`}
        />
      </div>

      {/* Hidden native date picker */}
      <input
        ref={pickerRef}
        type="date"
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
