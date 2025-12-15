import { format, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { TruckIcon, Package } from 'lucide-react';
import { Task } from '../../hooks/useCalendarTasks';
import { getTasksForDate } from '../../lib/calendarUtils';

interface CalendarGridProps {
  currentMonth: Date;
  tasks: Task[];
  onDateClick: (date: Date) => void;
}

export function CalendarGrid({ currentMonth, tasks, onDateClick }: CalendarGridProps) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const startDayOfWeek = monthStart.getDay();
  const emptyDays = Array(startDayOfWeek).fill(null);

  return (
    <>
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="grid grid-cols-7 bg-slate-100 border-b border-slate-200">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="py-3 px-2 text-center font-semibold text-slate-700 text-sm">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {emptyDays.map((_, index) => (
            <div key={`empty-${index}`} className="aspect-square border border-slate-100 bg-slate-50" />
          ))}

          {calendarDays.map(day => {
            const dayTasks = getTasksForDate(tasks, day);
            const isToday = isSameDay(day, new Date());
            const dropOffs = dayTasks.filter(t => t.type === 'drop-off').length;
            const pickUps = dayTasks.filter(t => t.type === 'pick-up').length;

            return (
              <div
                key={day.toISOString()}
                onClick={() => dayTasks.length > 0 && onDateClick(day)}
                className={`aspect-square border border-slate-100 p-2 ${
                  dayTasks.length > 0 ? 'cursor-pointer hover:bg-blue-50' : ''
                } ${isToday ? 'bg-blue-50' : 'bg-white'} transition-colors relative`}
              >
                <div className={`text-sm font-semibold mb-1 ${
                  isToday ? 'text-blue-600' : 'text-slate-700'
                }`}>
                  {format(day, 'd')}
                </div>

                {dayTasks.length > 0 && (
                  <div className="space-y-1">
                    {dropOffs > 0 && (
                      <div className="flex items-center gap-1 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                        <TruckIcon className="w-3 h-3" />
                        <span className="font-semibold">{dropOffs}</span>
                      </div>
                    )}
                    {pickUps > 0 && (
                      <div className="flex items-center gap-1 text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                        <Package className="w-3 h-3" />
                        <span className="font-semibold">{pickUps}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-50 rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 border-2 border-green-500 rounded"></div>
          <span className="text-slate-700">Drop-off / Delivery</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-orange-100 border-2 border-orange-500 rounded"></div>
          <span className="text-slate-700">Pick-up / Retrieval</span>
        </div>
      </div>
    </>
  );
}
