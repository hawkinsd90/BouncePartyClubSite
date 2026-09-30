import { CheckCircle2 } from 'lucide-react';

interface Props {
  isDropOff: boolean;
  completedTime?: string | null;
}

// The parent decides when to render this banner (currentStatus === 'completed').
export function TaskDetailCompletedBanner({ isDropOff, completedTime }: Props) {
  return (
    <div className="bg-green-600 rounded-xl p-5 flex items-center gap-4 shadow-lg">
      <div className="bg-white bg-opacity-20 rounded-full p-2 flex-shrink-0">
        <CheckCircle2 className="w-8 h-8 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-lg leading-tight">
          {isDropOff ? 'Delivery Complete' : 'Pickup Complete'}
        </p>
        <p className="text-green-100 text-sm mt-0.5">
          This task has been marked as completed.
          {completedTime && (
            <span> Completed at {new Date(completedTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.</span>
          )}
        </p>
      </div>
    </div>
  );
}
