import { Calendar, Home, Building2, Clock } from 'lucide-react';
import type { QuoteFormData } from '../../hooks/useQuoteForm';

interface EventDetailsSectionProps {
  formData: QuoteFormData;
  onFormDataChange: (updates: Partial<QuoteFormData>) => void;
}

export function EventDetailsSection({ formData, onFormDataChange }: EventDetailsSectionProps) {
  const isSameDayRestricted =
    (formData.location_type === 'residential' && formData.pickup_preference === 'same_day') ||
    formData.location_type === 'commercial';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-4 sm:mb-6">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Event Details</h2>
      </div>

      <div className="mb-6">
        <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-3">Event Type</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onFormDataChange({ location_type: 'residential' })}
            className={`flex flex-col items-center p-3 sm:p-4 rounded-lg sm:rounded-xl border-2 transition-all ${
              formData.location_type === 'residential'
                ? 'border-blue-600 bg-blue-50 shadow-sm'
                : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
            }`}
          >
            <Home
              className={`w-7 h-7 sm:w-8 sm:h-8 mb-2 ${
                formData.location_type === 'residential' ? 'text-blue-600' : 'text-slate-400'
              }`}
            />
            <span
              className={`font-semibold text-sm sm:text-base ${
                formData.location_type === 'residential' ? 'text-blue-900' : 'text-slate-700'
              }`}
            >
              Residential
            </span>
            <span className="text-xs text-slate-600 mt-1 text-center">Home, backyard</span>
          </button>
          <button
            type="button"
            onClick={() => onFormDataChange({ location_type: 'commercial' })}
            className={`flex flex-col items-center p-3 sm:p-4 rounded-lg sm:rounded-xl border-2 transition-all ${
              formData.location_type === 'commercial'
                ? 'border-blue-600 bg-blue-50 shadow-sm'
                : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
            }`}
          >
            <Building2
              className={`w-7 h-7 sm:w-8 sm:h-8 mb-2 ${
                formData.location_type === 'commercial' ? 'text-blue-600' : 'text-slate-400'
              }`}
            />
            <span
              className={`font-semibold text-sm sm:text-base ${
                formData.location_type === 'commercial' ? 'text-blue-900' : 'text-slate-700'
              }`}
            >
              Commercial
            </span>
            <span className="text-xs text-slate-600 mt-1 text-center">School, park, church</span>
          </button>
        </div>
      </div>

      {formData.location_type === 'residential' && (
        <div className="mb-6">
          <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-3">When do you need pickup?</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                onFormDataChange({
                  pickup_preference: 'next_day',
                  same_day_responsibility_accepted: false,
                  overnight_responsibility_accepted: false,
                })
              }
              className={`flex flex-col items-center p-3 sm:p-4 rounded-lg sm:rounded-xl border-2 transition-all ${
                formData.pickup_preference === 'next_day'
                  ? 'border-green-600 bg-green-50 shadow-sm'
                  : 'border-slate-300 hover:border-green-400 hover:bg-slate-50'
              }`}
            >
              <Clock
                className={`w-7 h-7 sm:w-8 sm:h-8 mb-2 ${
                  formData.pickup_preference === 'next_day' ? 'text-green-600' : 'text-slate-400'
                }`}
              />
              <span
                className={`font-semibold text-center text-sm sm:text-base ${
                  formData.pickup_preference === 'next_day' ? 'text-green-900' : 'text-slate-700'
                }`}
              >
                Next Morning
              </span>
              <span className="text-xs text-slate-600 mt-1 text-center leading-tight">Pickup 6 AM - 1:30 PM</span>
            </button>
            <button
              type="button"
              onClick={() => onFormDataChange({ pickup_preference: 'same_day' })}
              className={`flex flex-col items-center p-3 sm:p-4 rounded-lg sm:rounded-xl border-2 transition-all ${
                formData.pickup_preference === 'same_day'
                  ? 'border-orange-600 bg-orange-50 shadow-sm'
                  : 'border-slate-300 hover:border-orange-400 hover:bg-slate-50'
              }`}
            >
              <Clock
                className={`w-7 h-7 sm:w-8 sm:h-8 mb-2 ${
                  formData.pickup_preference === 'same_day' ? 'text-orange-600' : 'text-slate-400'
                }`}
              />
              <span
                className={`font-semibold text-center text-sm sm:text-base ${
                  formData.pickup_preference === 'same_day' ? 'text-orange-900' : 'text-slate-700'
                }`}
              >
                Same Day
              </span>
              <span className="text-xs text-slate-600 mt-1 text-center leading-tight">Additional fees apply</span>
            </button>
          </div>
          {formData.pickup_preference === 'next_day' && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.overnight_responsibility_accepted}
                  onChange={(e) =>
                    onFormDataChange({ overnight_responsibility_accepted: e.target.checked })
                  }
                  className="mt-0.5 mr-3 flex-shrink-0"
                  required
                />
                <p className="text-xs text-amber-900 font-medium leading-relaxed">
                  ⚠️ I understand the inflatable will remain on my property overnight and I am
                  legally responsible for its safety and security until pickup the next morning. *
                </p>
              </label>
            </div>
          )}
          {formData.pickup_preference === 'same_day' && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.same_day_responsibility_accepted}
                  onChange={(e) =>
                    onFormDataChange({ same_day_responsibility_accepted: e.target.checked })
                  }
                  className="mt-0.5 mr-3 flex-shrink-0"
                  required
                />
                <p className="text-xs text-amber-900 font-medium leading-relaxed">
                  ⚠️ I understand I am legally responsible for the inflatable until Bounce Party
                  Club picks it up this evening. *
                </p>
              </label>
            </div>
          )}
        </div>
      )}

      {formData.location_type === 'residential' && (
        <div className="mb-6">
          <div className="p-3 sm:p-4 bg-slate-50 border border-slate-300 rounded-lg">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={formData.has_pets}
                onChange={(e) => onFormDataChange({ has_pets: e.target.checked })}
                className="mt-1 mr-3 flex-shrink-0"
              />
              <div>
                <p className="text-xs sm:text-sm font-medium text-slate-900">
                  We have pets at this location
                </p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  This helps our crew prepare for arrival and look out for pet waste or loose
                  animals during setup.
                </p>
              </div>
            </label>
          </div>
        </div>
      )}

      {formData.location_type === 'commercial' && (
        <div className="mb-6">
          <div className="p-3 sm:p-4 bg-blue-50 border border-blue-200 rounded-lg mb-3">
            <p className="text-xs sm:text-sm text-blue-900 leading-relaxed">
              <strong>Commercial events require same-day pickup by 7:00 PM.</strong> This ensures
              safety at parks, churches, schools, and other public locations.
            </p>
          </div>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={formData.same_day_responsibility_accepted}
                onChange={(e) =>
                  onFormDataChange({ same_day_responsibility_accepted: e.target.checked })
                }
                className="mt-0.5 mr-3 flex-shrink-0"
                required
              />
              <p className="text-xs text-amber-900 font-medium leading-relaxed">
                ⚠️ I understand I am legally responsible for the inflatable until Bounce Party Club
                picks it up by 7:00 PM. *
              </p>
            </label>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">Event Start Date *</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none" />
            <input
              type="date"
              required
              value={formData.event_date}
              onChange={(e) => {
                const newStartDate = e.target.value;
                const oldStartDate = formData.event_date;
                const oldEndDate = formData.event_end_date;

                if (oldStartDate && oldEndDate && newStartDate) {
                  const oldStart = new Date(oldStartDate);
                  const oldEnd = new Date(oldEndDate);
                  const dayOffset = Math.round(
                    (oldEnd.getTime() - oldStart.getTime()) / (1000 * 60 * 60 * 24)
                  );

                  const newStart = new Date(newStartDate);
                  const newEnd = new Date(newStart);
                  newEnd.setDate(newEnd.getDate() + dayOffset);

                  onFormDataChange({
                    event_date: newStartDate,
                    event_end_date: newEnd.toISOString().split('T')[0],
                  });
                } else {
                  onFormDataChange({ event_date: newStartDate });
                }
              }}
              min={new Date().toISOString().split('T')[0]}
              className="w-full pl-9 sm:pl-10 pr-3 sm:pr-4 py-2 sm:py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base transition-shadow"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">Event End Date *</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none" />
            <input
              type="date"
              required
              value={formData.event_end_date}
              onChange={(e) => onFormDataChange({ event_end_date: e.target.value })}
              min={formData.event_date || new Date().toISOString().split('T')[0]}
              disabled={isSameDayRestricted}
              className="w-full pl-9 sm:pl-10 pr-3 sm:pr-4 py-2 sm:py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base disabled:bg-slate-100 transition-shadow"
            />
            {isSameDayRestricted && (
              <p className="text-xs text-slate-500 mt-1.5">Same-day events cannot span multiple days</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">Start Time *</label>
          <input
            type="time"
            required
            value={formData.start_window}
            onChange={(e) => onFormDataChange({ start_window: e.target.value })}
            className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base transition-shadow"
          />
        </div>
        <div>
          <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">End Time *</label>
          <div className="space-y-2">
            <input
              type="time"
              required={!formData.until_end_of_day}
              disabled={formData.until_end_of_day}
              value={formData.end_window}
              onChange={(e) => {
                let newTime = e.target.value;
                if (isSameDayRestricted && newTime > '19:00') {
                  newTime = '19:00';
                }
                onFormDataChange({ end_window: newTime });
              }}
              max={isSameDayRestricted ? '19:00' : undefined}
              className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base disabled:bg-slate-100 transition-shadow"
            />
            {isSameDayRestricted && <p className="text-xs text-slate-500">Max 7:00 PM for same-day pickup</p>}
            <label className="flex items-center text-xs sm:text-sm text-slate-600">
              <input
                type="checkbox"
                checked={formData.until_end_of_day}
                onChange={(e) =>
                  onFormDataChange({
                    until_end_of_day: e.target.checked,
                    end_window: e.target.checked ? '23:59' : formData.end_window,
                  })
                }
                disabled={isSameDayRestricted}
                className="mr-2 disabled:opacity-50 flex-shrink-0"
              />
              <span className={isSameDayRestricted ? 'opacity-50' : ''}>Until end of day</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
