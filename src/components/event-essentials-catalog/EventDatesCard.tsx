import { Calendar } from 'lucide-react';

interface Props {
  eventDate: string;
  eventEndDate: string;
  datesValid: boolean;
  addError: string | null;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

// Display only. EventEssentialsCatalog owns the dates, their persistence and validation.
export function EventDatesCard({
  eventDate,
  eventEndDate,
  datesValid,
  addError,
  onStartDateChange,
  onEndDateChange,
}: Props) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border-2 p-4 sm:p-6 transition-colors ${
      (!datesValid) ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'
    }`}>
      <div className="flex items-center gap-3 mb-4">
        <Calendar className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Event Dates</h2>
      </div>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label htmlFor="event-date" className="block text-xs font-medium text-slate-700 mb-1">
            Start Date
          </label>
          <input
            id="event-date"
            type="date"
            value={eventDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="event-end-date" className="block text-xs font-medium text-slate-700 mb-1">
            End Date
          </label>
          <input
            id="event-end-date"
            type="date"
            value={eventEndDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>
      {!datesValid && (
        <div className="mt-4 p-4 rounded-lg bg-blue-50 border-2 border-blue-300">
          <h4 className="text-sm font-bold text-blue-900 mb-1">
            Choose your event dates
          </h4>
          <p className="text-sm text-blue-700">
            Select a start and end date to check availability and add Party Add-Ons.
          </p>
        </div>
      )}
      {addError && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {addError}
        </p>
      )}
    </div>
  );
}
