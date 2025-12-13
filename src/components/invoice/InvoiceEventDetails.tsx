import { AddressAutocomplete } from '../AddressAutocomplete';
import { formatCurrency } from '../../lib/pricing';

interface InvoiceEventDetailsProps {
  eventDetails: any;
  pricingRules: any;
  onEventChange: (updates: any) => void;
  onAddressSelect: (result: any) => void;
}

export function InvoiceEventDetails({
  eventDetails,
  pricingRules,
  onEventChange,
  onAddressSelect,
}: InvoiceEventDetailsProps) {
  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Event Details</h3>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Event Start Date</label>
            <input
              type="date"
              value={eventDetails.event_date}
              onChange={(e) => {
                const newStart = e.target.value;
                onEventChange({
                  event_date: newStart,
                  event_end_date: newStart > eventDetails.event_end_date ? newStart : eventDetails.event_end_date
                });
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Event End Date</label>
            <input
              type="date"
              value={eventDetails.event_end_date}
              onChange={(e) => onEventChange({ event_end_date: e.target.value })}
              min={eventDetails.event_date}
              disabled={eventDetails.pickup_preference === 'same_day' || eventDetails.location_type === 'commercial'}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm disabled:bg-slate-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Start Time</label>
            <input
              type="time"
              value={eventDetails.start_window}
              onChange={(e) => onEventChange({ start_window: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">End Time</label>
            <input
              type="time"
              value={eventDetails.end_window}
              onChange={(e) => onEventChange({ end_window: e.target.value })}
              disabled={eventDetails.until_end_of_day}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm disabled:bg-slate-100"
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={eventDetails.until_end_of_day}
              onChange={(e) => onEventChange({ until_end_of_day: e.target.checked })}
              className="rounded"
            />
            <span className="text-slate-700">Event runs until end of day</span>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Location Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onEventChange({ location_type: 'residential', pickup_preference: eventDetails.pickup_preference === 'same_day' ? 'next_day' : eventDetails.pickup_preference })}
              className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm ${
                eventDetails.location_type === 'residential'
                  ? 'border-blue-600 bg-blue-50 text-blue-900'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Residential
            </button>
            <button
              type="button"
              onClick={() => onEventChange({ location_type: 'commercial', pickup_preference: 'same_day', event_end_date: eventDetails.event_date })}
              className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm ${
                eventDetails.location_type === 'commercial'
                  ? 'border-purple-600 bg-purple-50 text-purple-900'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Commercial
            </button>
          </div>
        </div>

        {eventDetails.location_type === 'residential' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Pickup Preference</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onEventChange({ pickup_preference: 'next_day' })}
                className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm ${
                  eventDetails.pickup_preference === 'next_day'
                    ? 'border-green-600 bg-green-50 text-green-900'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                Next Day (Free)
              </button>
              <button
                type="button"
                onClick={() => onEventChange({ pickup_preference: 'same_day', event_end_date: eventDetails.event_date })}
                disabled={eventDetails.event_date !== eventDetails.event_end_date}
                className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm ${
                  eventDetails.pickup_preference === 'same_day'
                    ? 'border-orange-600 bg-orange-50 text-orange-900'
                    : eventDetails.event_date !== eventDetails.event_end_date
                    ? 'border-slate-200 bg-slate-100 opacity-50'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                Same Day (+{formatCurrency(pricingRules?.same_day_fee_cents || 5000)})
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Event Address</label>
          <AddressAutocomplete
            value={eventDetails.address_line1}
            onSelect={onAddressSelect}
            placeholder="Enter event address"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Address Line 2 (optional)</label>
          <input
            type="text"
            value={eventDetails.address_line2}
            onChange={(e) => onEventChange({ address_line2: e.target.value })}
            placeholder="Apt, Suite, Unit, etc."
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Setup Surface</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onEventChange({ can_stake: true, surface: 'grass' })}
              className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm ${
                eventDetails.can_stake
                  ? 'border-green-600 bg-green-50 text-green-900'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Grass
            </button>
            <button
              type="button"
              onClick={() => onEventChange({ can_stake: false, surface: 'cement' })}
              className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm ${
                !eventDetails.can_stake
                  ? 'border-orange-600 bg-orange-50 text-orange-900'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Sandbags
            </button>
          </div>
          {!eventDetails.can_stake && (
            <p className="text-xs text-amber-600 mt-1">
              Sandbag fee ({formatCurrency(pricingRules?.surface_sandbag_fee_cents || 3000)}) will be applied
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Generators</label>
          <input
            type="number"
            min="0"
            value={eventDetails.generator_qty}
            onChange={(e) => onEventChange({ generator_qty: parseInt(e.target.value) || 0 })}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
          {eventDetails.generator_qty > 0 && pricingRules?.generator_price_cents && (
            <p className="text-xs text-blue-600 mt-1">
              {eventDetails.generator_qty} × {formatCurrency(pricingRules.generator_price_cents)} = {formatCurrency(eventDetails.generator_qty * pricingRules.generator_price_cents)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
