import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/notifications';

interface BlackoutContactFormProps {
  onSuccess: () => void;
}

export function BlackoutContactForm({ onSuccess }: BlackoutContactFormProps) {
  const [newContact, setNewContact] = useState({ email: '', phone: '', customer_name: '', reason: '', notes: '' });
  const [adding, setAdding] = useState(false);

  async function handleAddContact() {
    if ((!newContact.email && !newContact.phone) || !newContact.reason) {
      notifyError('Please provide at least email or phone, and a reason');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase.from('blackout_contacts' as any).insert([{
        email: newContact.email || null,
        phone: newContact.phone || null,
        customer_name: newContact.customer_name || null,
        reason: newContact.reason,
        notes: newContact.notes || null,
      }]);
      if (error) throw error;

      notifySuccess('Contact blacklisted successfully');
      setNewContact({ email: '', phone: '', customer_name: '', reason: '', notes: '' });
      onSuccess();
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="bg-slate-50 rounded-xl p-6 border-2 border-slate-200">
      <h3 className="text-lg font-bold text-slate-900 mb-4">Add Blocked Contact</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
          <input
            type="email"
            value={newContact.email}
            onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
            placeholder="customer@example.com"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Phone</label>
          <input
            type="tel"
            value={newContact.phone}
            onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
            placeholder="+1234567890"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Customer Name (Optional)</label>
          <input
            type="text"
            value={newContact.customer_name}
            onChange={(e) => setNewContact({ ...newContact, customer_name: e.target.value })}
            placeholder="John Doe"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Reason</label>
          <input
            type="text"
            value={newContact.reason}
            onChange={(e) => setNewContact({ ...newContact, reason: e.target.value })}
            placeholder="e.g., Payment issues, Inappropriate behavior"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">Notes (Optional)</label>
          <textarea
            value={newContact.notes}
            onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
            rows={2}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          />
        </div>
      </div>
      <button
        onClick={handleAddContact}
        disabled={adding}
        className="mt-4 flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg disabled:opacity-50"
      >
        <Plus className="w-4 h-4 mr-2" />
        {adding ? 'Adding...' : 'Add Blocked Contact'}
      </button>
    </div>
  );
}
