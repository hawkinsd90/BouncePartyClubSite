import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/notifications';

interface BlackoutDateFormProps {
  onSuccess: () => void;
}

export function BlackoutDateForm({ onSuccess }: BlackoutDateFormProps) {
  const [newDate, setNewDate] = useState({ start_date: '', end_date: '', reason: '', notes: '' });
  const [adding, setAdding] = useState(false);

  async function handleAddDate() {
    if (!newDate.start_date || !newDate.end_date || !newDate.reason) {
      notifyError('Please fill in all required fields');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase.from('blackout_dates' as any).insert([newDate]);
      if (error) throw error;

      notifySuccess('Blackout date added successfully');
      setNewDate({ start_date: '', end_date: '', reason: '', notes: '' });
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
          <label className="block text-sm font-medium text-slate-700 mb-2">Start Date</label>
          <input
            type="date"
            value={newDate.start_date}
            onChange={(e) => setNewDate({ ...newDate, start_date: e.target.value })}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">End Date</label>
          <input
            type="date"
            value={newDate.end_date}
            onChange={(e) => setNewDate({ ...newDate, end_date: e.target.value })}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Reason</label>
          <input
            type="text"
            value={newDate.reason}
            onChange={(e) => setNewDate({ ...newDate, reason: e.target.value })}
            placeholder="e.g., Christmas Holiday, Maintenance Day"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Notes (Optional)</label>
          <textarea
            value={newDate.notes}
            onChange={(e) => setNewDate({ ...newDate, notes: e.target.value })}
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
