import { Calendar, Trash2, Ban, Clock } from 'lucide-react';

interface BlackoutDate {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  notes: string | null;
  block_type: 'full' | 'same_day_pickup';
  created_at: string;
}

interface BlackoutDatesListProps {
  dates: BlackoutDate[];
  onDelete: (id: string) => void;
}

export function BlackoutDatesList({ dates, onDelete }: BlackoutDatesListProps) {
  return (
    <div className="space-y-3">
      {dates.map((date) => (
        <div key={date.id} className="border-2 border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <span className="font-bold text-slate-900">
                  {new Date(date.start_date).toLocaleDateString()} - {new Date(date.end_date).toLocaleDateString()}
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
              </div>
              <p className="text-slate-700"><strong>Reason:</strong> {date.reason}</p>
              {date.notes && <p className="text-sm text-slate-600 mt-1">{date.notes}</p>}
              <p className="text-xs text-slate-500 mt-2">Added: {new Date(date.created_at).toLocaleString()}</p>
            </div>
            <button
              onClick={() => onDelete(date.id)}
              className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
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
