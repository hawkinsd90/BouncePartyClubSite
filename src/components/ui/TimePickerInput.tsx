import { useRef } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleClick = () => {
    if (disabled || !inputRef.current) return;
    try {
      (inputRef.current as any).showPicker();
    } catch {
      inputRef.current.focus();
      inputRef.current.click();
    }
  };

  return (
    <div className="relative">
      {showIcon && (
        <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none z-10" />
      )}
      <div
        onClick={handleClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
        className={`w-full ${showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4'} pr-3 sm:pr-4 py-2.5 border border-slate-300 rounded-lg text-slate-900 transition-shadow select-none ${
          disabled ? 'bg-slate-100 cursor-not-allowed text-slate-500' : 'bg-white cursor-pointer hover:border-blue-400'
        } ${className}`}
        style={{ fontSize: '16px', minHeight: '44px', display: 'flex', alignItems: 'center' }}
      >
        {displayValue || <span className="text-slate-400">{placeholder}</span>}
      </div>
      <input
        ref={inputRef}
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        tabIndex={-1}
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
        style={{ fontSize: '16px' }}
        aria-hidden="true"
      />
    </div>
  );
}
