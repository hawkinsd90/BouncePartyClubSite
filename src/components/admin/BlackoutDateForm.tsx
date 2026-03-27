import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/notifications';

interface BlackoutDateFormProps {
  onSuccess: () => void;
}

const EMPTY_FORM = {
  start_date: '',
  end_date: '',
  reason: '',
  notes: '',
  block_type: 'full' as 'full' | 'same_day_pickup',
  recurrence: 'one_time' as 'one_time' | 'annual',
  expires_at: '',
};

export function BlackoutDateForm({ onSuccess }: BlackoutDateFormProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAddDate() {
    if (!form.start_date || !form.end_date || !form.reason) {
      notifyError('Please fill in all required fields');
      return;
    }

    setAdding(true);
    try {
      const payload: Record<string, string | null> = {
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason,
        notes: form.notes || null,
        block_type: form.block_type,
        recurrence: form.recurrence,
        expires_at: form.recurrence === 'annual' && form.expires_at ? form.expires_at : null,
      };
      const { error } = await supabase.from('blackout_dates' as any).insert([payload]);
      if (error) throw error;

      notifySuccess('Blackout date added successfully');
      setForm(EMPTY_FORM);
      onSuccess();
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="bg-slate-50 rounded-xl p-6 border-2 border-slate-200">
      <h3 className="text-lg font-bold text-slate-900 mb-4">Add Blackout Date Range</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Start Date *</label>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => set('start_date', e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">End Date *</label>
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => set('end_date', e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Reason *</label>
          <input
            type="text"
            value={form.reason}
            onChange={(e) => set('reason', e.target.value)}
            placeholder="e.g., Christmas Holiday, Maintenance Day"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Block Type *</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => set('block_type', 'full')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                form.block_type === 'full'
                  ? 'border-red-500 bg-red-50'
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              <p className={`text-sm font-semibold ${form.block_type === 'full' ? 'text-red-900' : 'text-slate-700'}`}>
                Full Block
              </p>
              <p className="text-xs text-slate-500 mt-0.5">All bookings blocked</p>
            </button>
            <button
              type="button"
              onClick={() => set('block_type', 'same_day_pickup')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                form.block_type === 'same_day_pickup'
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              <p className={`text-sm font-semibold ${form.block_type === 'same_day_pickup' ? 'text-amber-900' : 'text-slate-700'}`}>
                Same-Day Pickup Block
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Blocks same-day &amp; commercial only</p>
            </button>
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Recurrence</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => set('recurrence', 'one_time')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                form.recurrence === 'one_time'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              <p className={`text-sm font-semibold ${form.recurrence === 'one_time' ? 'text-blue-900' : 'text-slate-700'}`}>
                One-Time
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Blocks only the specified dates</p>
            </button>
            <button
              type="button"
              onClick={() => set('recurrence', 'annual')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                form.recurrence === 'annual'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              <p className={`text-sm font-semibold ${form.recurrence === 'annual' ? 'text-blue-900' : 'text-slate-700'}`}>
                Annual
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Repeats every year on same dates</p>
            </button>
          </div>
        </div>

        {form.recurrence === 'annual' && (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Expires After (Optional)
            </label>
            <input
              type="date"
              value={form.expires_at}
              onChange={(e) => set('expires_at', e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg"
            />
            <p className="text-xs text-slate-500 mt-1">
              Leave blank for this annual blackout to repeat indefinitely.
            </p>
          </div>
        )}

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Notes (Optional)</label>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
      </div>

      <button
        onClick={handleAddDate}
        disabled={adding}
        className="mt-4 flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg disabled:opacity-50"
      >
        <Plus className="w-4 h-4 mr-2" />
        {adding ? 'Adding...' : 'Add Blackout Date'}
      </button>
    </div>
  );
}
