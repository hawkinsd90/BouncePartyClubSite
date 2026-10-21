import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  EMPTY_TIME_DRAFT,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  PERIOD_OPTIONS,
  applyHourChange,
  applyMinuteChange,
  applyPeriodChange,
  formatMinute,
  parseTime24,
  toTime24,
  type Period,
  type TimeDraft,
} from '../../lib/core/timeSelect';

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
}

const selectClass =
  'h-12 min-h-[48px] w-full min-w-0 box-border appearance-none rounded-lg border border-slate-300 bg-white px-2 sm:px-3 text-base text-slate-900 transition-all cursor-pointer hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:cursor-not-allowed';

export function TimePickerInput({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  className = '',
  showIcon = false,
}: TimePickerInputProps) {
  const [draft, setDraft] = useState<TimeDraft>(() => parseTime24(value) ?? EMPTY_TIME_DRAFT);

  // Follow the parent: a complete value replaces the draft; a cleared value clears a complete draft but keeps a half-finished one.
  useEffect(() => {
    const parsed = parseTime24(value);
    if (parsed) {
      setDraft((current) => (toTime24(current) === toTime24(parsed) ? current : parsed));
    } else {
      setDraft((current) => (toTime24(current) === null ? current : EMPTY_TIME_DRAFT));
    }
  }, [value]);

  const update = (next: TimeDraft) => {
    setDraft(next);
    const time24 = toTime24(next);
    if (time24 !== null) {
      if (time24 !== value) onChange(time24);
    } else if (value) {
      // A complete time became incomplete (the caller's value no longer matches what is shown): clear it.
      onChange('');
    }
  };

  return (
    <div
      role="group"
      aria-label="Time"
      className={`relative flex w-full max-w-full min-w-0 items-center gap-2 box-border ${className}`}
    >
      {showIcon && <Clock className="h-4 w-4 flex-shrink-0 text-slate-400 sm:h-5 sm:w-5" aria-hidden="true" />}
      <select
        id={id}
        aria-label="Hour"
        value={draft.hour ?? ''}
        disabled={disabled}
        required={required}
        onChange={(e) => update(applyHourChange(draft, e.target.value === '' ? null : Number(e.target.value)))}
        className={selectClass}
      >
        <option value="">Hr</option>
        {HOUR_OPTIONS.map((hour) => (
          <option key={hour} value={hour}>
            {hour}
          </option>
        ))}
      </select>
      <select
        aria-label="Minute"
        value={draft.minute ?? ''}
        disabled={disabled}
        required={required}
        onChange={(e) => update(applyMinuteChange(draft, e.target.value === '' ? null : Number(e.target.value)))}
        className={selectClass}
      >
        <option value="">Min</option>
        {MINUTE_OPTIONS.map((minute) => (
          <option key={minute} value={minute}>
            {formatMinute(minute)}
          </option>
        ))}
      </select>
      <select
        aria-label="AM or PM"
        value={draft.period ?? ''}
        disabled={disabled}
        required={required}
        onChange={(e) => update(applyPeriodChange(draft, (e.target.value || null) as Period | null))}
        className={selectClass}
      >
        <option value="">AM/PM</option>
        {PERIOD_OPTIONS.map((period) => (
          <option key={period} value={period}>
            {period}
          </option>
        ))}
      </select>
    </div>
  );
}
