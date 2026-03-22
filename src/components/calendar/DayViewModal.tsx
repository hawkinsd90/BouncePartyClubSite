import { useState } from 'react';
import { format } from 'date-fns';
import { X, Truck as TruckIcon, Package, MousePointer, Car, Settings, ClipboardList, AlertTriangle, Clock, CheckCircle } from 'lucide-react';
import { Task } from '../../hooks/useCalendarTasks';
import { getStopNumber, sortTasksByOrder, isTaskActiveRouteStop } from '../../lib/calendarUtils';
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
  onOptimizeRoute: (tasks: Task[]) => Promise<Task[]>;
  onRefresh?: () => void;
}

export function DayViewModal({
  selectedDate,
  tasks,
  optimizing,
  onClose,
  onTaskClick,
  onOptimizeRoute,
  onRefresh,
}: DayViewModalProps) {
  const [showMileageModal, setShowMileageModal] = useState(false);
  const [mileageType, setMileageType] = useState<'start' | 'end'>('start');
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [routeType, setRouteType] = useState<'drop-off' | 'pick-up'>('drop-off');
  const [showEquipmentChecklist, setShowEquipmentChecklist] = useState(false);

  const allMorningTasks = tasks.filter(
    t => t.type === 'drop-off' || (t.type === 'pick-up' && t.pickupPreference === 'next_day')
  );
  const allAfternoonTasks = tasks.filter(
    t => t.type === 'pick-up' && t.pickupPreference === 'same_day'
  );

  function splitByReadiness(taskList: Task[]) {
    const active = sortTasksByOrder(taskList.filter(t => isTaskActiveRouteStop(t)));
    const completed = taskList.filter(t => !isTaskActiveRouteStop(t) && (
      t.taskStatus?.status === 'completed' || t.pickupReadiness === 'completed'
    ));
    const blocked = taskList.filter(t => t.type === 'pick-up' && t.pickupReadiness === 'blocked');
    const projected = taskList.filter(t => t.type === 'pick-up' && t.pickupReadiness === 'projected');
    return { active, completed, blocked, projected };
  }

  const morning = splitByReadiness(allMorningTasks);
  const afternoon = splitByReadiness(allAfternoonTasks);

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

  const hasMorning = allMorningTasks.length > 0;
  const hasAfternoon = allAfternoonTasks.length > 0;

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

            {hasMorning && (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h3 className="text-base sm:text-lg font-bold text-green-900 flex items-center gap-2">
                    <TruckIcon className="w-5 h-5" />
                    Morning Route ({allMorningTasks.length})
                  </h3>
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
                </div>

                {/* Active drop-offs */}
                {morning.active.filter(t => t.type === 'drop-off').length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                      <TruckIcon className="w-4 h-4 text-green-600" />
                      Drop-offs / Deliveries ({morning.active.filter(t => t.type === 'drop-off').length})
                    </h4>
                    <div className="space-y-3">
                      {morning.active
                        .filter(t => t.type === 'drop-off')
                        .map(task => (
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

                {/* Active ready pickups (morning / next-day) */}
                {morning.active.filter(t => t.type === 'pick-up').length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                      <Package className="w-4 h-4 text-orange-600" />
                      Pick-ups / Retrievals ({morning.active.filter(t => t.type === 'pick-up').length})
                    </h4>
                    <div className="space-y-3">
                      {morning.active
                        .filter(t => t.type === 'pick-up')
                        .map(task => (
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

                {/* Completed morning tasks */}
                {morning.completed.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Completed ({morning.completed.length})
                    </h4>
                    <div className="space-y-2">
                      {morning.completed.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          stopNumber={0}
                          onClick={() => onTaskClick(task)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Blocked pickups */}
                {morning.blocked.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Blocked Pickups ({morning.blocked.length})
                    </h4>
                    <div className="space-y-2">
                      {morning.blocked.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          stopNumber={0}
                          onClick={() => onTaskClick(task)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Projected pickups */}
                {morning.projected.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-slate-500 mb-2 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      Projected Pickups — Planning Only ({morning.projected.length})
                    </h4>
                    <p className="text-xs text-slate-400 mb-2">
                      These will become actionable once the drop-off is completed.
                    </p>
                    <div className="space-y-2">
                      {morning.projected.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          stopNumber={0}
                          onClick={() => onTaskClick(task)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasAfternoon && (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h3 className="text-base sm:text-lg font-bold text-orange-900 flex items-center gap-2">
                    <Package className="w-5 h-5" />
                    Afternoon Route ({allAfternoonTasks.length})
                  </h3>
                  <button
                    onClick={() => handleManageRoute('pick-up')}
                    className="flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-700 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    <Settings className="w-4 h-4 flex-shrink-0" />
                    <span>Manage Route</span>
                  </button>
                </div>

                {/* Active same-day pickups */}
                {afternoon.active.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {afternoon.active.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        stopNumber={getStopNumber(task, tasks)}
                        onClick={() => onTaskClick(task)}
                      />
                    ))}
                  </div>
                )}

                {/* Completed afternoon tasks */}
                {afternoon.completed.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Completed ({afternoon.completed.length})
                    </h4>
                    <div className="space-y-2">
                      {afternoon.completed.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          stopNumber={0}
                          onClick={() => onTaskClick(task)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Blocked same-day pickups */}
                {afternoon.blocked.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Blocked Pickups ({afternoon.blocked.length})
                    </h4>
                    <div className="space-y-2">
                      {afternoon.blocked.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          stopNumber={0}
                          onClick={() => onTaskClick(task)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Projected same-day pickups */}
                {afternoon.projected.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-slate-500 mb-2 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      Projected Pickups — Planning Only ({afternoon.projected.length})
                    </h4>
                    <p className="text-xs text-slate-400 mb-2">
                      These will become actionable once the drop-off is completed.
                    </p>
                    <div className="space-y-2">
                      {afternoon.projected.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          stopNumber={0}
                          onClick={() => onTaskClick(task)}
                        />
                      ))}
                    </div>
                  </div>
                )}
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
        date={selectedDate}
        onClose={() => setShowRouteModal(false)}
        onUpdate={() => {
          setShowRouteModal(false);
          if (onRefresh) {
            onRefresh();
          }
        }}
        onOptimizeRoute={onOptimizeRoute}
        optimizing={optimizing}
      />

      <EquipmentChecklistModal
        isOpen={showEquipmentChecklist}
        tasks={morning.active}
        onClose={() => setShowEquipmentChecklist(false)}
      />
    </>
  );
}
