import { CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

interface WorkflowEvent {
  id: string;
  event_type: string;
  description?: string;
  created_at: string;
}

interface OrderWorkflowTabProps {
  workflowEvents: WorkflowEvent[];
}

export function OrderWorkflowTab({ workflowEvents }: OrderWorkflowTabProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-900">Workflow Events</h3>
      {workflowEvents.length === 0 ? (
        <p className="text-slate-600">No workflow events yet</p>
      ) : (
        <div className="space-y-2">
          {workflowEvents.map(event => (
            <div key={event.id} className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <p className="font-medium text-sm">{event.event_type}</p>
                <span className="text-xs text-slate-500 ml-auto">
                  {format(new Date(event.created_at), 'MMM d, yyyy h:mm a')}
                </span>
              </div>
              {event.description && (
                <p className="text-sm text-slate-600 ml-6">{event.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
