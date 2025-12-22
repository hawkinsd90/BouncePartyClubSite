import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/notifications';

interface BlackoutAddressFormProps {
  onSuccess: () => void;
}

export function BlackoutAddressForm({ onSuccess }: BlackoutAddressFormProps) {
  const [newAddress, setNewAddress] = useState({
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    zip_code: '',
    reason: '',
    notes: ''
  });
  const [adding, setAdding] = useState(false);

  async function handleAddAddress() {
    if (!newAddress.address_line1 || !newAddress.city || !newAddress.state || !newAddress.zip_code || !newAddress.reason) {
      notifyError('Please fill in all required fields');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase.from('blackout_addresses' as any).insert([{
        address_line1: newAddress.address_line1,
        address_line2: newAddress.address_line2 || null,
        city: newAddress.city,
        state: newAddress.state,
        zip_code: newAddress.zip_code,
        reason: newAddress.reason,
        notes: newAddress.notes || null,
      }]);
      if (error) throw error;

      notifySuccess('Address blacklisted successfully');
      setNewAddress({ address_line1: '', address_line2: '', city: '', state: '', zip_code: '', reason: '', notes: '' });
      onSuccess();
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="bg-slate-50 rounded-xl p-6 border-2 border-slate-200">
      <h3 className="text-lg font-bold text-slate-900 mb-4">Add Blocked Address</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Address Line 1</label>
          <input
            type="text"
            value={newAddress.address_line1}
            onChange={(e) => setNewAddress({ ...newAddress, address_line1: e.target.value })}
            placeholder="123 Main St"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Address Line 2 (Optional)</label>
          <input
            type="text"
            value={newAddress.address_line2}
            onChange={(e) => setNewAddress({ ...newAddress, address_line2: e.target.value })}
            placeholder="Apt 4B"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">City</label>
          <input
            type="text"
            value={newAddress.city}
            onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })}
            placeholder="Detroit"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">State</label>
          <input
            type="text"
            value={newAddress.state}
            onChange={(e) => setNewAddress({ ...newAddress, state: e.target.value })}
            placeholder="MI"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">ZIP Code</label>
          <input
            type="text"
            value={newAddress.zip_code}
            onChange={(e) => setNewAddress({ ...newAddress, zip_code: e.target.value })}
            placeholder="48201"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Reason</label>
          <input
            type="text"
            value={newAddress.reason}
            onChange={(e) => setNewAddress({ ...newAddress, reason: e.target.value })}
            placeholder="e.g., Restricted area, Safety concerns"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Notes (Optional)</label>
          <textarea
            value={newAddress.notes}
            onChange={(e) => setNewAddress({ ...newAddress, notes: e.target.value })}
            rows={2}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
      </div>
      <button
        onClick={handleAddAddress}
        disabled={adding}
        className="mt-4 flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg disabled:opacity-50"
      >
        <Plus className="w-4 h-4 mr-2" />
        {adding ? 'Adding...' : 'Add Blocked Address'}
      </button>
    </div>
  );
}
