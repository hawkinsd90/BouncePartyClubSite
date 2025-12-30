import { formatCurrency } from '../../lib/pricing';
import { AddressAutocomplete } from '../order/AddressAutocomplete';

interface EventDetailsEditorProps {
  editedOrder: any;
  pricingRules: any;
  onOrderChange: (updates: Partial<any>) => void;
  onAddressSelect: (addressData: any) => void;
  compact?: boolean;
  showUntilEndOfDay?: boolean;
}

export function EventDetailsEditor({
  editedOrder,
  pricingRules,
  onOrderChange,
  onAddressSelect,
  compact = false,
  showUntilEndOfDay = false,
}: EventDetailsEditorProps) {
  const containerClass = compact ? 'bg-white rounded-lg shadow p-4 sm:p-6 min-w-0' : 'space-y-6';
  const sectionClass = compact ? 'min-w-0' : 'bg-white border border-slate-200 rounded-lg p-4';
  const labelClass = compact ? 'block text-sm font-medium text-slate-700 mb-1' : 'block text-sm font-medium text-slate-700 mb-2';
  const inputClass = compact ? 'w-full px-3 py-2 border border-slate-300 rounded text-sm min-w-0' : 'w-full px-3 py-2 border border-slate-300 rounded';

  return (
    <div className={containerClass}>
      <div className={sectionClass}>
        <h3 className={compact ? 'text-base sm:text-lg font-semibold text-slate-900 mb-3 sm:mb-4' : 'font-semibold text-slate-900 mb-4'}>Event Details</h3>
        <div className="space-y-3 sm:space-y-4 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 min-w-0">
            <div className="min-w-0">
              <label className={labelClass}>Event Start Date</label>
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
                className={inputClass}
              />
            </div>

            <div className="min-w-0">
              <label className={labelClass}>Event End Date</label>
              <input
                type="date"
                value={editedOrder.event_end_date}
                onChange={(e) => onOrderChange({ event_end_date: e.target.value })}
                min={editedOrder.event_date}
                disabled={editedOrder.pickup_preference === 'same_day' || editedOrder.location_type === 'commercial'}
                className={`${inputClass} disabled:bg-slate-100`}
              />
            </div>
          </div>
          {(editedOrder.pickup_preference === 'same_day' || editedOrder.location_type === 'commercial') && (
            <p className="text-xs text-slate-500">Same-day events cannot span multiple days</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 min-w-0">
            <div className="min-w-0">
              <label className={labelClass}>Start Time</label>
              <input
                type="time"
                value={editedOrder.start_window}
                onChange={(e) => onOrderChange({ start_window: e.target.value })}
                className={inputClass}
              />
            </div>

            <div className="min-w-0">
              <label className={labelClass}>End Time</label>
              <input
                type="time"
                value={editedOrder.end_window}
                onChange={(e) => onOrderChange({ end_window: e.target.value })}
                disabled={showUntilEndOfDay && editedOrder.until_end_of_day}
                className={`${inputClass} ${showUntilEndOfDay && editedOrder.until_end_of_day ? 'disabled:bg-slate-100' : ''}`}
              />
            </div>
          </div>

          {showUntilEndOfDay && (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editedOrder.until_end_of_day}
                  onChange={(e) => onOrderChange({ until_end_of_day: e.target.checked })}
                  className="rounded"
                />
                <span className="text-slate-700">Event runs until end of day</span>
              </label>
            </div>
          )}

          <div className="min-w-0">
            <label className={labelClass}>Location Type</label>
            <div className="flex gap-2 min-w-0">
              <button
                type="button"
                onClick={() => onOrderChange({ location_type: 'residential', pickup_preference: editedOrder.pickup_preference === 'same_day' ? 'next_day' : editedOrder.pickup_preference })}
                className={`flex-1 px-3 py-2 border-2 rounded font-medium ${compact ? 'text-sm' : ''} transition-all min-w-0 ${
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
                className={`flex-1 px-3 py-2 border-2 rounded font-medium ${compact ? 'text-sm' : ''} transition-all min-w-0 ${
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
            <div className="min-w-0">
              <label className={labelClass}>Pickup Preference</label>
              <div className="flex gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => onOrderChange({ pickup_preference: 'next_day' })}
                  disabled={compact && editedOrder.event_date !== editedOrder.event_end_date}
                  className={`flex-1 px-2 sm:px-3 py-2 border-2 rounded font-medium text-xs sm:text-sm transition-all min-w-0 ${
                    editedOrder.pickup_preference === 'next_day'
                      ? 'border-green-600 bg-green-50 text-green-900'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-green-400'
                  }`}
                >
                  <span className="truncate block">Next Day (Free)</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOrderChange({ pickup_preference: 'same_day', event_end_date: editedOrder.event_date })}
                  disabled={compact && editedOrder.event_date !== editedOrder.event_end_date}
                  className={`flex-1 px-2 sm:px-3 py-2 border-2 rounded font-medium text-xs sm:text-sm transition-all min-w-0 ${
                    editedOrder.pickup_preference === 'same_day'
                      ? 'border-orange-600 bg-orange-50 text-orange-900'
                      : compact && editedOrder.event_date !== editedOrder.event_end_date
                      ? 'border-slate-200 bg-slate-100 opacity-50'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-orange-400'
                  }`}
                >
                  <span className="truncate block">Same Day (+{formatCurrency(pricingRules?.same_day_fee_cents || 5000)})</span>
                </button>
              </div>
            </div>
          )}

          {!compact && (
            <>
              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-semibold text-slate-900 mb-3">Event Address</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Street Address</label>
                    <AddressAutocomplete
                      value={editedOrder.address_line1}
                      onChange={(value) => onOrderChange({ address_line1: value })}
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

              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-semibold text-slate-900 mb-3">Setup Details</h4>
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
            </>
          )}

          {compact && (
            <>
              <div className="min-w-0">
                <label className={labelClass}>Event Address</label>
                <AddressAutocomplete
                  value={editedOrder.address_line1}
                  onChange={(value) => onOrderChange({ address_line1: value })}
                  onSelect={onAddressSelect}
                  placeholder="Enter event address"
                />
              </div>

              <div className="min-w-0">
                <label className={labelClass}>Address Line 2 (optional)</label>
                <input
                  type="text"
                  value={editedOrder.address_line2}
                  onChange={(e) => onOrderChange({ address_line2: e.target.value })}
                  placeholder="Apt, Suite, Unit, etc."
                  className={inputClass}
                />
              </div>

              <div className="min-w-0">
                <label className={labelClass}>Setup Surface</label>
                <div className="flex gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => onOrderChange({ can_stake: true, surface: 'grass' })}
                    className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm min-w-0 ${
                      editedOrder.can_stake
                        ? 'border-green-600 bg-green-50 text-green-900'
                        : 'border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    Grass
                  </button>
                  <button
                    type="button"
                    onClick={() => onOrderChange({ can_stake: false, surface: 'cement' })}
                    className={`flex-1 px-3 py-2 border-2 rounded font-medium text-sm min-w-0 ${
                      !editedOrder.can_stake
                        ? 'border-orange-600 bg-orange-50 text-orange-900'
                        : 'border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    Sandbags
                  </button>
                </div>
                {!editedOrder.can_stake && (
                  <p className="text-xs text-amber-600 mt-1">
                    Sandbag fee ({formatCurrency(pricingRules?.surface_sandbag_fee_cents || 3000)}) will be applied
                  </p>
                )}
              </div>

              <div className="min-w-0">
                <label className={labelClass}>Generators</label>
                <input
                  type="number"
                  min="0"
                  value={editedOrder.generator_qty}
                  onChange={(e) => onOrderChange({ generator_qty: parseInt(e.target.value) || 0 })}
                  className={inputClass}
                />
                {editedOrder.generator_qty > 0 && pricingRules?.generator_price_cents && (
                  <p className="text-xs text-blue-600 mt-1">
                    {editedOrder.generator_qty} × {formatCurrency(pricingRules.generator_price_cents)} = {formatCurrency(editedOrder.generator_qty * pricingRules.generator_price_cents)}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
