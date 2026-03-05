import { useState } from 'react';
import { format } from 'date-fns';
import { X, Truck as TruckIcon, Package, MousePointer, Route, Car, Settings, ClipboardList } from 'lucide-react';
import { Task } from '../../hooks/useCalendarTasks';
import { getStopNumber } from '../../lib/calendarUtils';
import { TaskCard } from './TaskCard';
import { MileageModal } from './MileageModal';
import { RouteManagementModal } from './RouteManagementModal';
import { EquipmentChecklistModal } from './EquipmentChecklistModal';

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
  const [showMileageModal, setShowMileageModal] = useState(false);
  const [mileageType, setMileageType] = useState<'start' | 'end'>('start');
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [routeType, setRouteType] = useState<'drop-off' | 'pick-up'>('drop-off');
  const [showEquipmentChecklist, setShowEquipmentChecklist] = useState(false);

  const dropOffTasks = tasks.filter(t => t.type === 'drop-off');
  const pickUpTasks = tasks.filter(t => t.type === 'pick-up');

  function handleStartDay() {
    setMileageType('start');
    setShowMileageModal(true);
  }

  function handleEndDay() {
    setMileageType('end');
    setShowMileageModal(true);
  }

  function handleManageRoute(type: 'drop-off' | 'pick-up') {
    setRouteType(type);
    setShowRouteModal(true);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto pt-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto my-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center gap-3 z-10">
          <div className="flex-1 min-w-0 pr-2">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900 break-words">
              <span className="hidden sm:inline">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</span>
              <span className="sm:hidden">{format(selectedDate, 'EEE, MMM d, yyyy')}</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} scheduled
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 mb-4">
            <p className="text-sm text-blue-900 flex items-center gap-2 mb-3">
              <MousePointer className="w-4 h-4" />
              Click on any task below to view details and take action
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleStartDay}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-colors"
              >
                <Car className="w-4 h-4" />
                Start Day Mileage
              </button>
              <button
                onClick={handleEndDay}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-colors"
              >
                <Car className="w-4 h-4" />
                End Day Mileage
              </button>
            </div>
          </div>

          {dropOffTasks.length > 0 && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h3 className="text-base sm:text-lg font-bold text-green-900 flex items-center gap-2">
                  <TruckIcon className="w-5 h-5" />
                  Drop-offs / Deliveries ({dropOffTasks.length})
                </h3>
                {dropOffTasks.length >= 1 && (
                  <div className="flex flex-row gap-2">
                    <button
                      onClick={() => setShowEquipmentChecklist(true)}
                      className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      <ClipboardList className="w-4 h-4 flex-shrink-0" />
                      <span>Equipment</span>
                    </button>
                    <button
                      onClick={() => handleManageRoute('drop-off')}
                      className="flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-700 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      <Settings className="w-4 h-4 flex-shrink-0" />
                      <span>Manage Route</span>
                    </button>
                  </div>
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
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h3 className="text-base sm:text-lg font-bold text-orange-900 flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Pick-ups / Retrievals ({pickUpTasks.length})
                </h3>
                {pickUpTasks.length >= 1 && (
                  <button
                    onClick={() => handleManageRoute('pick-up')}
                    className="flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-700 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    <Settings className="w-4 h-4 flex-shrink-0" />
                    <span>Manage Route</span>
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

      <MileageModal
        isOpen={showMileageModal}
        date={selectedDate}
        type={mileageType}
        onClose={() => setShowMileageModal(false)}
        onSuccess={() => setShowMileageModal(false)}
      />

      <RouteManagementModal
        isOpen={showRouteModal}
        tasks={tasks}
        type={routeType}
        onClose={() => setShowRouteModal(false)}
        onUpdate={() => {
          setShowRouteModal(false);
          window.location.reload();
        }}
        onOptimize={routeType === 'drop-off' ? onOptimizeMorning : onOptimizeAfternoon}
        optimizing={optimizing}
      />

      <EquipmentChecklistModal
        isOpen={showEquipmentChecklist}
        tasks={dropOffTasks}
        onClose={() => setShowEquipmentChecklist(false)}
      />
    </>
  );
}
