import { Clock } from 'lucide-react';
import { normalizeTime } from '../../lib/core/eventTimeWindow';

// WP-P2-12b (F-34): the native time control again (type="time"), as Production had it: the phone's own time wheel / minute dial, the desktop
// browser's own segmented field. It replaces the Hr / Min / AM-PM selects. Behaviour that matters:
// - It starts EMPTY unless the caller passes a saved time: nothing is chosen for the customer or for staff, and "required" works natively.
// - Any minute 00-59 can be entered (no min / max / step is put on the input: those would make some phones refuse or snap minutes).
//   `min` / `max` are accepted for compatibility only; callers apply their limits (the customer's 7:00 PM cap, the end-after-start check)
//   after a time is chosen, so a limit never blocks typing.
// - The value is "HH:mm" (24-hour), exactly as stored; a saved "HH:mm:ss" is shown without seconds and is never replaced by this control.
// - A half-typed time reports '' (the browser reports '' until hour, minute and AM/PM are all entered), so a caller never sees an invented value.
interface TimePickerInputProps {
  id?: string;
  value: string; // HH:mm format
  onChange: (value: string) => void;
  /** Accepted for compatibility. Limits are applied by the caller after a time is chosen (e.g. the 7:00 PM same-day cap). */
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  showIcon?: boolean;
  /** Accessible name when no visible <label htmlFor> points at this control. */
  ariaLabel?: string;
}

export function TimePickerInput({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  placeholder = 'Select time',
  className = '',
  showIcon = false,
  ariaLabel,
}: TimePickerInputProps) {
  const shown = normalizeTime(value);
  const padding = showIcon ? 'pl-9 sm:pl-11' : 'pl-3 sm:pl-4';

  return (
    <div className={`relative block w-full max-w-full min-w-0 box-border rounded-lg ${className}`}>
      {showIcon && (
        <Clock className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none sm:h-5 sm:w-5" aria-hidden="true" />
      )}
      <input
        id={id}
        type="time"
        aria-label={ariaLabel}
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        className={`peer block h-12 min-h-[48px] w-full max-w-full min-w-0 box-border appearance-none rounded-lg border border-slate-300 bg-white ${padding} pr-3 sm:pr-4 py-2.5 text-base transition-all cursor-pointer hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:cursor-not-allowed ${
          shown === '' ? 'text-transparent focus:text-slate-900' : 'text-slate-900'
        }`}
        style={{ colorScheme: 'light', fontSize: '16px' }}
      />
      {shown === '' && (
        <span
          className={`pointer-events-none absolute inset-y-0 left-0 flex items-center ${padding} pr-3 text-base text-slate-400 peer-focus:hidden`}
          aria-hidden="true"
        >
          {placeholder}
        </span>
      )}
    </div>
  );
}
