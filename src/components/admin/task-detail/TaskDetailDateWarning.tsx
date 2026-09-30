import { AlertTriangle } from 'lucide-react';

interface Props {
  isFuture: boolean;
  date: Date;
  futureTaskOverride: boolean;
  onOverrideChange: (checked: boolean) => void;
}

// The parent decides when to render this warning (!isToday) and owns the override state.
export function TaskDetailDateWarning({ isFuture, date, futureTaskOverride, onOverrideChange }: Props) {
  return (
    <div className={`rounded-lg p-4 border-2 ${isFuture ? 'bg-amber-50 border-amber-400' : 'bg-slate-100 border-slate-400'}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isFuture ? 'text-amber-600' : 'text-slate-600'}`} />
        <div className="flex-1">
          <h3 className={`font-bold ${isFuture ? 'text-amber-900' : 'text-slate-900'} mb-1`}>
            {isFuture ? 'Future Task Warning' : 'Past Task Warning'}
          </h3>
          <p className={`text-sm ${isFuture ? 'text-amber-800' : 'text-slate-700'}`}>
            {isFuture
              ? `This task is scheduled for ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, not today. Taking delivery actions now may cause confusion.`
              : `This task was scheduled for ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} (past date).`}
          </p>
          {isFuture && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={futureTaskOverride}
                onChange={(e) => onOverrideChange(e.target.checked)}
                className="w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-sm font-semibold text-amber-900">
                I need to perform delivery actions early (e.g. pre-drop before a busy day)
              </span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
