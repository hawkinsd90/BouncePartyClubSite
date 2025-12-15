import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addMonths, subMonths } from 'date-fns';

interface CalendarHeaderProps {
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
}

export function CalendarHeader({ currentMonth, onMonthChange }: CalendarHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Event Calendar</h2>
      <div className="flex items-center gap-2 sm:gap-4">
        <button
          onClick={() => onMonthChange(subMonths(currentMonth, 1))}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-base sm:text-lg font-semibold text-slate-900 min-w-[160px] sm:min-w-[200px] text-center">
          {format(currentMonth, 'MMMM yyyy')}
        </span>
        <button
          onClick={() => onMonthChange(addMonths(currentMonth, 1))}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <button
          onClick={() => onMonthChange(new Date())}
          className="ml-2 sm:ml-4 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm sm:text-base"
        >
          Today
        </button>
      </div>
    </div>
  );
}
