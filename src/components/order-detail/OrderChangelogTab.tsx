import { format } from 'date-fns';

interface ChangelogEntry {
  id: string;
  change_type: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  created_at: string;
  users?: {
    email: string;
  };
}

interface OrderChangelogTabProps {
  changelog: ChangelogEntry[];
}

export function OrderChangelogTab({ changelog }: OrderChangelogTabProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-900">Change History</h3>
      {changelog.length === 0 ? (
        <p className="text-slate-600">No changes recorded yet</p>
      ) : (
        <div className="space-y-2">
          {changelog.map(change => (
            <div key={change.id} className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">
                  {change.change_type === 'status_change' ? 'Status Change' :
                   change.change_type === 'field_update' ? 'Field Update' :
                   change.change_type}
                </p>
                <span className="text-xs text-slate-500">
                  {format(new Date(change.created_at), 'MMM d, yyyy h:mm a')}
                </span>
              </div>

              {change.field_name && (
                <p className="text-sm text-slate-700 mb-1">
                  <span className="font-medium">Field:</span> {change.field_name}
                </p>
              )}

              {change.old_value && (
                <p className="text-sm text-slate-600">
                  <span className="font-medium">From:</span> {change.old_value}
                </p>
              )}

              {change.new_value && (
                <p className="text-sm text-slate-600">
                  <span className="font-medium">To:</span> {change.new_value}
                </p>
              )}

              {change.reason && (
                <p className="text-sm text-slate-600 mt-2 italic">
                  Reason: {change.reason}
                </p>
              )}

              {change.users?.email && (
                <p className="text-xs text-slate-500 mt-2">
                  Changed by: {change.users.email}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
