import { User, MapPin, Clock, AlertTriangle, CheckCircle, Navigation, ArrowRight, History } from 'lucide-react';
import { Task } from '../../hooks/useCalendarTasks';

export type TaskPosition = 'current' | 'next' | 'previous' | null;

interface TaskCardProps {
  task: Task;
  stopNumber: number;
  taskPosition?: TaskPosition;
  onClick: () => void;
}

export function TaskCard({ task, stopNumber, taskPosition = null, onClick }: TaskCardProps) {
  const isDropOff = task.type === 'drop-off';
  const readiness = task.pickupReadiness;
  const isProjected = !isDropOff && readiness === 'projected';
  const isBlocked = !isDropOff && readiness === 'blocked';
  const isCompletedTask = task.taskStatus?.status === 'completed' || (!isDropOff && readiness === 'completed');
  const isPlanningOnlyDropOff = isDropOff && task.status === 'pending_review';

  function getCardStyle(): string {
    if (isCompletedTask) return 'bg-slate-50 border-slate-200 hover:bg-slate-100 opacity-60';
    if (isBlocked) return 'bg-amber-50 border-amber-300 hover:bg-amber-100';
    if (isProjected || isPlanningOnlyDropOff) return 'bg-slate-50 border-dashed border-slate-300 hover:bg-slate-100 opacity-75';
    if (isDropOff) return 'bg-green-50 border-green-200 hover:bg-green-100';
    return 'bg-orange-50 border-orange-200 hover:bg-orange-100';
  }

  function getStopBadgeStyle(): string {
    if (isCompletedTask) return 'bg-green-600';
    if (isBlocked) return 'bg-amber-500';
    if (isProjected) return 'bg-slate-400';
    if (isDropOff) return 'bg-green-700';
    return 'bg-orange-700';
  }

  const bulletColor = isDropOff ? 'text-green-600' : 'text-orange-600';
  const borderColor = isDropOff ? 'border-green-300' : 'border-orange-300';

  return (
    <div
      onClick={onClick}
      className={`${getCardStyle()} border-2 rounded-lg p-3 sm:p-4 cursor-pointer transition-colors relative ${taskPosition === 'current' ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
    >
      <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
        {stopNumber > 0 && (
          <div className={`${getStopBadgeStyle()} text-white text-xs font-bold px-2 py-1 rounded`}>
            Stop #{stopNumber}
          </div>
        )}
        {taskPosition === 'current' && (
          <div className="flex items-center gap-1 bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded shadow-sm">
            <Navigation className="w-3 h-3" />
            NOW
          </div>
        )}
        {taskPosition === 'next' && (
          <div className="flex items-center gap-1 bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded shadow-sm">
            <ArrowRight className="w-3 h-3" />
            NEXT
          </div>
        )}
        {taskPosition === 'previous' && (
          <div className="flex items-center gap-1 bg-slate-500 text-white text-xs font-bold px-2 py-1 rounded shadow-sm">
            <History className="w-3 h-3" />
            PREV
          </div>
        )}
      </div>

      <div className="flex justify-between items-start mb-3 pr-16">
        <div>
          <h4 className="font-bold text-slate-900 text-base sm:text-lg">
            Order #{task.orderNumber}
          </h4>
          <div className="flex gap-2 mt-1 flex-wrap">
            {/* Planning-only drop-offs: show only the PENDING REVIEW badge, no operational noise */}
            {isPlanningOnlyDropOff && !isCompletedTask ? (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-200 text-slate-600">
                <Clock className="w-3 h-3" />
                PENDING REVIEW
              </span>
            ) : (
              <>
                <span className={`inline-block text-xs px-2 py-1 rounded-full ${
                  isCompletedTask ? 'bg-green-600 text-white' :
                  task.taskStatus?.status === 'arrived' ? 'bg-yellow-600 text-white' :
                  task.taskStatus?.status === 'en_route' ? 'bg-blue-600 text-white' :
                  'bg-slate-200 text-slate-700'
                }`}>
                  {task.taskStatus?.status?.toUpperCase() || 'PENDING'}
                </span>

                {isProjected && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-200 text-slate-600">
                    <Clock className="w-3 h-3" />
                    PROJECTED
                  </span>
                )}

                {isBlocked && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">
                    <AlertTriangle className="w-3 h-3" />
                    BLOCKED
                  </span>
                )}

                {isCompletedTask && !isBlocked && !isProjected && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-800">
                    <CheckCircle className="w-3 h-3" />
                    DONE
                  </span>
                )}

                {!task.waiverSigned && isDropOff && !isCompletedTask && (
                  <span className="inline-block text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                    NO WAIVER
                  </span>
                )}

                {task.balanceDue > 0 && isDropOff && !isCompletedTask && (
                  <span className="inline-block text-xs px-2 py-1 rounded-full bg-red-100 text-red-800">
                    ${(task.balanceDue / 100).toFixed(0)} DUE
                  </span>
                )}
              </>
            )}
          </div>

          {(isBlocked || isProjected) && task.pickupBlockReason && (
            <p className="text-xs text-slate-500 mt-1">{task.pickupBlockReason}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <User className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">{task.customerName}</div>
              <div className="text-slate-600 text-xs">{task.customerPhone}</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
            <div className="text-slate-700 text-xs">{task.address}</div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
            <div className="text-slate-700 text-xs">
              <div>Event: {task.eventStartTime} - {task.eventEndTime}</div>
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 mb-2">Equipment:</div>
          <ul className="text-xs text-slate-700 space-y-1">
            {task.items.slice(0, 3).map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className={bulletColor}>•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {task.notes && (
        <div className={`mt-3 pt-3 border-t ${borderColor}`}>
          <div className="text-xs font-semibold text-slate-700 mb-1">Notes:</div>
          <div className="text-sm text-slate-700 whitespace-pre-wrap">{task.notes}</div>
        </div>
      )}
    </div>
  );
}
