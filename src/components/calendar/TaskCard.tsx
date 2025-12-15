import { User, MapPin, Clock } from 'lucide-react';
import { Task } from '../../hooks/useCalendarTasks';

interface TaskCardProps {
  task: Task;
  stopNumber: number;
  onClick: () => void;
}

export function TaskCard({ task, stopNumber, onClick }: TaskCardProps) {
  const isDropOff = task.type === 'drop-off';
  const colorClasses = isDropOff
    ? 'bg-green-50 border-green-200 hover:bg-green-100'
    : 'bg-orange-50 border-orange-200 hover:bg-orange-100';
  const badgeColor = isDropOff ? 'bg-green-700' : 'bg-orange-700';
  const bulletColor = isDropOff ? 'text-green-600' : 'text-orange-600';
  const borderColor = isDropOff ? 'border-green-300' : 'border-orange-300';

  return (
    <div
      onClick={onClick}
      className={`${colorClasses} border-2 rounded-lg p-3 sm:p-4 cursor-pointer transition-colors relative`}
    >
      <div className={`absolute top-2 right-2 ${badgeColor} text-white text-xs font-bold px-2 py-1 rounded`}>
        Stop #{stopNumber}
      </div>
      <div className="flex justify-between items-start mb-3 pr-16">
        <div>
          <h4 className="font-bold text-slate-900 text-base sm:text-lg">
            Order #{task.orderNumber}
          </h4>
          <div className="flex gap-2 mt-1 flex-wrap">
            <span className={`inline-block text-xs px-2 py-1 rounded-full ${
              task.taskStatus?.status === 'completed' ? 'bg-green-600 text-white' :
              task.taskStatus?.status === 'arrived' ? 'bg-yellow-600 text-white' :
              task.taskStatus?.status === 'en_route' ? 'bg-blue-600 text-white' :
              'bg-slate-200 text-slate-700'
            }`}>
              {task.taskStatus?.status?.toUpperCase() || 'PENDING'}
            </span>
            {!task.waiverSigned && isDropOff && (
              <span className="inline-block text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                NO WAIVER
              </span>
            )}
            {task.balanceDue > 0 && isDropOff && (
              <span className="inline-block text-xs px-2 py-1 rounded-full bg-red-100 text-red-800">
                ${(task.balanceDue / 100).toFixed(0)} DUE
              </span>
            )}
          </div>
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
