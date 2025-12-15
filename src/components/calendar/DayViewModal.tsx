import { format } from 'date-fns';
import { X, TruckIcon, Package, MousePointer, Route } from 'lucide-react';
import { Task } from '../../hooks/useCalendarTasks';
import { getStopNumber } from '../../lib/calendarUtils';
import { TaskCard } from './TaskCard';

interface DayViewModalProps {
  selectedDate: Date;
  tasks: Task[];
  optimizing: boolean;
  onClose: () => void;
  onTaskClick: (task: Task) => void;
  onOptimizeMorning: () => void;
  onOptimizeAfternoon: () => void;
}

export function DayViewModal({
  selectedDate,
  tasks,
  optimizing,
  onClose,
  onTaskClick,
  onOptimizeMorning,
  onOptimizeAfternoon,
}: DayViewModalProps) {
  const dropOffTasks = tasks.filter(t => t.type === 'drop-off');
  const pickUpTasks = tasks.filter(t => t.type === 'pick-up');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center z-10">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} scheduled
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 mb-4">
            <p className="text-sm text-blue-900 flex items-center gap-2">
              <MousePointer className="w-4 h-4" />
              Click on any task below to view details and take action
            </p>
          </div>

          {dropOffTasks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-green-900 flex items-center gap-2">
                  <TruckIcon className="w-5 h-5" />
                  Drop-offs / Deliveries ({dropOffTasks.length})
                </h3>
                {dropOffTasks.length >= 1 && (
                  <button
                    onClick={onOptimizeMorning}
                    disabled={optimizing}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Route className="w-4 h-4" />
                    {optimizing ? 'Optimizing...' : 'Optimize Morning Route'}
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {dropOffTasks
                  .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0))
                  .map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      stopNumber={getStopNumber(task, tasks)}
                      onClick={() => onTaskClick(task)}
                    />
                  ))}
              </div>
            </div>
          )}

          {pickUpTasks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-orange-900 flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Pick-ups / Retrievals ({pickUpTasks.length})
                </h3>
                {pickUpTasks.filter(t => t.pickupPreference === 'same_day').length >= 2 && (
                  <button
                    onClick={onOptimizeAfternoon}
                    disabled={optimizing}
                    className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Route className="w-4 h-4" />
                    {optimizing ? 'Optimizing...' : 'Optimize Afternoon Route'}
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {pickUpTasks
                  .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0))
                  .map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      stopNumber={getStopNumber(task, tasks)}
                      onClick={() => onTaskClick(task)}
                    />
                  ))}
              </div>
            </div>
          )}

          {tasks.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              No tasks scheduled for this day
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
