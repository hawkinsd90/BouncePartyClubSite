import { Calendar, Trash2, Ban, Clock, RefreshCw } from 'lucide-react';
import type { BlackoutDate } from '../../types/index';

interface BlackoutDatesListProps {
  dates: BlackoutDate[];
  onDelete: (id: string) => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function BlackoutDatesList({ dates, onDelete }: BlackoutDatesListProps) {
  return (
    <div className="space-y-3">
      {dates.map((date) => (
        <div key={date.id} className="border-2 border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Calendar className="w-5 h-5 text-blue-600 shrink-0" />
                <span className="font-bold text-slate-900">
                  {formatDate(date.start_date)} &ndash; {formatDate(date.end_date)}
                </span>

                {date.block_type === 'full' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                    <Ban className="w-3 h-3" />
                    Full Block
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                    <Clock className="w-3 h-3" />
                    Same-Day Pickup Block
                  </span>
                )}

                {date.recurrence === 'annual' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                    <RefreshCw className="w-3 h-3" />
                    Annual
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                    One-Time
                  </span>
                )}
              </div>

              <p className="text-slate-700"><strong>Reason:</strong> {date.reason}</p>
              {date.notes && <p className="text-sm text-slate-600 mt-1">{date.notes}</p>}

              <div className="flex flex-wrap gap-x-4 mt-2">
                {date.recurrence === 'annual' && date.expires_at && (
                  <p className="text-xs text-slate-500">
                    Expires: {formatDate(date.expires_at)}
                  </p>
                )}
                {date.recurrence === 'annual' && !date.expires_at && (
                  <p className="text-xs text-slate-500">No expiration</p>
                )}
                <p className="text-xs text-slate-400">Added: {new Date(date.created_at).toLocaleString()}</p>
              </div>
            </div>

            <button
              onClick={() => onDelete(date.id)}
              className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors shrink-0"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      ))}
      {dates.length === 0 && (
        <p className="text-center text-slate-500 py-8">No blackout dates configured</p>
      )}
    </div>
  );
}
