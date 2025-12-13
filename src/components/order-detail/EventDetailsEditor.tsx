import { formatCurrency } from '../../lib/pricing';
import { AddressAutocomplete } from '../AddressAutocomplete';

interface EventDetailsEditorProps {
  editedOrder: any;
  pricingRules: any;
  onOrderChange: (updates: Partial<any>) => void;
  onAddressSelect: (addressData: any) => void;
}

export function EventDetailsEditor({ editedOrder, pricingRules, onOrderChange, onAddressSelect }: EventDetailsEditorProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold text-slate-900 mb-4">Event Details</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Event Start Date</label>
              <input
                type="date"
                value={editedOrder.event_date}
                onChange={(e) => {
                  const newStart = e.target.value;
                  onOrderChange({
                    event_date: newStart,
                    event_end_date: newStart > editedOrder.event_end_date ? newStart : editedOrder.event_end_date
                  });
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Event End Date</label>
              <input
                type="date"
                value={editedOrder.event_end_date}
                onChange={(e) => onOrderChange({ event_end_date: e.target.value })}
                min={editedOrder.event_date}
                disabled={editedOrder.pickup_preference === 'same_day' || editedOrder.location_type === 'commercial'}
                className="w-full px-3 py-2 border border-slate-300 rounded disabled:bg-slate-100"
              />
            </div>
          </div>
          {(editedOrder.pickup_preference === 'same_day' || editedOrder.location_type === 'commercial') && (
            <p className="text-xs text-slate-500">Same-day events cannot span multiple days</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Start Time</label>
              <input
                type="time"
                value={editedOrder.start_window}
                onChange={(e) => onOrderChange({ start_window: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">End Time</label>
              <input
                type="time"
                value={editedOrder.end_window}
                onChange={(e) => onOrderChange({ end_window: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Location Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOrderChange({ location_type: 'residential', pickup_preference: editedOrder.pickup_preference === 'same_day' ? 'next_day' : editedOrder.pickup_preference })}
                className={`flex-1 px-3 py-2 border-2 rounded font-medium transition-all ${
                  editedOrder.location_type === 'residential'
                    ? 'border-blue-600 bg-blue-50 text-blue-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'
                }`}
              >
                Residential
              </button>
              <button
                type="button"
                onClick={() => onOrderChange({ location_type: 'commercial', pickup_preference: 'same_day', event_end_date: editedOrder.event_date })}
                className={`flex-1 px-3 py-2 border-2 rounded font-medium transition-all ${
                  editedOrder.location_type === 'commercial'
                    ? 'border-purple-600 bg-purple-50 text-purple-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-purple-400'
                }`}
              >
                Commercial
              </button>
            </div>
          </div>

          {editedOrder.location_type === 'residential' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Pickup Preference</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOrderChange({ pickup_preference: 'next_day' })}
                  className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm transition-all ${
                    editedOrder.pickup_preference === 'next_day'
                      ? 'border-green-600 bg-green-50 text-green-900'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-green-400'
                  }`}
                >
                  Next Day (Free)
                </button>
                <button
                  type="button"
                  onClick={() => onOrderChange({ pickup_preference: 'same_day', event_end_date: editedOrder.event_date })}
                  className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm transition-all ${
                    editedOrder.pickup_preference === 'same_day'
                      ? 'border-orange-600 bg-orange-50 text-orange-900'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-orange-400'
                  }`}
                >
                  Same Day (+{formatCurrency(pricingRules?.same_day_fee_cents || 5000)})
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold text-slate-900 mb-4">Event Address</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Street Address</label>
            <AddressAutocomplete
              value={editedOrder.address_line1}
              onSelect={onAddressSelect}
              placeholder="Enter event address"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Address Line 2 (optional)</label>
            <input
              type="text"
              value={editedOrder.address_line2}
              onChange={(e) => onOrderChange({ address_line2: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              placeholder="Apt, Suite, Unit, etc."
            />
          </div>
          <p className="text-xs text-amber-600">Address changes will recalculate travel fees when saved</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold text-slate-900 mb-4">Setup Details</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Setup Surface</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOrderChange({ can_stake: true, surface: 'grass' })}
                className={`flex-1 px-3 py-2 border-2 rounded font-medium transition-all ${
                  editedOrder.can_stake
                    ? 'border-green-600 bg-green-50 text-green-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-green-400'
                }`}
              >
                Grass
              </button>
              <button
                type="button"
                onClick={() => onOrderChange({ can_stake: false, surface: 'cement' })}
                className={`flex-1 px-3 py-2 border-2 rounded font-medium transition-all ${
                  !editedOrder.can_stake
                    ? 'border-orange-600 bg-orange-50 text-orange-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-orange-400'
                }`}
              >
                Sandbags
              </button>
            </div>
            {!editedOrder.can_stake && (
              <p className="text-xs text-amber-600 mt-1">Sandbag fee ({formatCurrency(pricingRules?.surface_sandbag_fee_cents || 3000)}) will be applied</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Generators</label>
            <input
              type="number"
              min="0"
              value={editedOrder.generator_qty}
              onChange={(e) => {
                const qty = parseInt(e.target.value) || 0;
                onOrderChange({ generator_qty: qty });
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded"
            />
            {editedOrder.generator_qty > 0 && pricingRules?.generator_price_cents && (
              <p className="text-xs text-blue-600 mt-1">
                {editedOrder.generator_qty} × {formatCurrency(pricingRules.generator_price_cents)} = {formatCurrency(editedOrder.generator_qty * pricingRules.generator_price_cents)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
