import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Calendar, UserX, MapPin, Plus, Trash2, Edit2, Save, X, List, PartyPopper } from 'lucide-react';
import { notify } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ConfirmationModal } from '../shared/ConfirmationModal';

interface BlackoutDate {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  notes: string | null;
  created_at: string;
}

interface BlackoutContact {
  id: string;
  email: string | null;
  phone: string | null;
  customer_name: string | null;
  reason: string;
  notes: string | null;
  created_at: string;
}

interface BlackoutAddress {
  id: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  zip_code: string;
  reason: string;
  notes: string | null;
  created_at: string;
}

export function BlackoutTab() {
  const [activeTab, setActiveTab] = useState<'dates' | 'contacts' | 'addresses' | 'all' | 'holidays'>('all');
  const [dates, setDates] = useState<BlackoutDate[]>([]);
  const [contacts, setContacts] = useState<BlackoutContact[]>([]);
  const [addresses, setAddresses] = useState<BlackoutAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string } | null>(null);
  const [overnightHolidayOnly, setOvernightHolidayOnly] = useState(false);
  const [savingHolidaySettings, setSavingHolidaySettings] = useState(false);

  const [newDate, setNewDate] = useState({ start_date: '', end_date: '', reason: '', notes: '' });
  const [newContact, setNewContact] = useState({ email: '', phone: '', customer_name: '', reason: '', notes: '' });
  const [newAddress, setNewAddress] = useState({ address_line1: '', address_line2: '', city: '', state: '', zip_code: '', reason: '', notes: '' });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [datesRes, contactsRes, addressesRes, pricingRes] = await Promise.all([
        supabase.from('blackout_dates').select('*').order('start_date', { ascending: false }),
        supabase.from('blackout_contacts').select('*').order('created_at', { ascending: false }),
        supabase.from('blackout_addresses').select('*').order('created_at', { ascending: false }),
        supabase.from('pricing_rules').select('overnight_holiday_only').limit(1).maybeSingle(),
      ]);

      if (datesRes.error) throw datesRes.error;
      if (contactsRes.error) throw contactsRes.error;
      if (addressesRes.error) throw addressesRes.error;

      setDates(datesRes.data || []);
      setContacts(contactsRes.data || []);
      setAddresses(addressesRes.data || []);
      setOvernightHolidayOnly(pricingRes.data?.overnight_holiday_only || false);
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddDate() {
    if (!newDate.start_date || !newDate.end_date || !newDate.reason) {
      notify('Please fill in all required fields', 'error');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase.from('blackout_dates').insert([newDate]);
      if (error) throw error;

      notify('Blackout date added successfully', 'success');
      setNewDate({ start_date: '', end_date: '', reason: '', notes: '' });
      fetchData();
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleAddContact() {
    if ((!newContact.email && !newContact.phone) || !newContact.reason) {
      notify('Please provide at least email or phone, and a reason', 'error');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase.from('blackout_contacts').insert([{
        email: newContact.email || null,
        phone: newContact.phone || null,
        customer_name: newContact.customer_name || null,
        reason: newContact.reason,
        notes: newContact.notes || null,
      }]);
      if (error) throw error;

      notify('Contact blacklisted successfully', 'success');
      setNewContact({ email: '', phone: '', customer_name: '', reason: '', notes: '' });
      fetchData();
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleAddAddress() {
    if (!newAddress.address_line1 || !newAddress.city || !newAddress.state || !newAddress.zip_code || !newAddress.reason) {
      notify('Please fill in all required fields', 'error');
      return;
    }

    setAdding(true);
    try {
      const { error } = await supabase.from('blackout_addresses').insert([{
        address_line1: newAddress.address_line1,
        address_line2: newAddress.address_line2 || null,
        city: newAddress.city,
        state: newAddress.state,
        zip_code: newAddress.zip_code,
        reason: newAddress.reason,
        notes: newAddress.notes || null,
      }]);
      if (error) throw error;

      notify('Address blacklisted successfully', 'success');
      setNewAddress({ address_line1: '', address_line2: '', city: '', state: '', zip_code: '', reason: '', notes: '' });
      fetchData();
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(type: string, id: string) {
    try {
      let error;
      if (type === 'dates') {
        ({ error } = await supabase.from('blackout_dates').delete().eq('id', id));
      } else if (type === 'contacts') {
        ({ error } = await supabase.from('blackout_contacts').delete().eq('id', id));
      } else {
        ({ error } = await supabase.from('blackout_addresses').delete().eq('id', id));
      }

      if (error) throw error;

      notify('Blackout removed successfully', 'success');
      setDeleteConfirm(null);
      fetchData();
    } catch (error: any) {
      notify(error.message, 'error');
    }
  }

  async function handleSaveHolidaySettings() {
    setSavingHolidaySettings(true);
    try {
      const { error } = await supabase
        .from('pricing_rules')
        .update({ overnight_holiday_only: overnightHolidayOnly })
        .eq('id', (await supabase.from('pricing_rules').select('id').limit(1).single()).data.id);

      if (error) throw error;

      notify('Holiday settings updated successfully', 'success');
      fetchData(); // Refresh to update the count
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setSavingHolidaySettings(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Blackout Management</h2>
        <p className="text-slate-600 mb-6">
          Block specific dates, contacts, or addresses from booking. This helps prevent bookings on holidays,
          from problem customers, or at restricted locations.
        </p>

        <div className="flex gap-2 border-b border-slate-200 mb-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === 'all'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <List className="w-5 h-5" />
            All Blackouts ({dates.length + contacts.length + addresses.length + (overnightHolidayOnly ? 1 : 0)})
          </button>
          <button
            onClick={() => setActiveTab('dates')}
            className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === 'dates'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-5 h-5" />
            Dates ({dates.length})
          </button>
          <button
            onClick={() => setActiveTab('contacts')}
            className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === 'contacts'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserX className="w-5 h-5" />
            Contacts ({contacts.length})
          </button>
          <button
            onClick={() => setActiveTab('addresses')}
            className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === 'addresses'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MapPin className="w-5 h-5" />
            Addresses ({addresses.length})
          </button>
          <button
            onClick={() => setActiveTab('holidays')}
            className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === 'holidays'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PartyPopper className="w-5 h-5" />
            Holiday Settings
          </button>
        </div>

        {activeTab === 'dates' && (
          <div className="space-y-6">
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
                      </div>
                      <p className="text-slate-700"><strong>Reason:</strong> {date.reason}</p>
                      {date.notes && <p className="text-sm text-slate-600 mt-1">{date.notes}</p>}
                      <p className="text-xs text-slate-500 mt-2">Added: {new Date(date.created_at).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => setDeleteConfirm({ type: 'dates', id: date.id })}
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
          </div>
        )}

        {activeTab === 'contacts' && (
          <div className="space-y-6">
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
                    placeholder="e.g., Payment disputes, Property damage"
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

            <div className="space-y-3">
              {contacts.map((contact) => (
                <div key={contact.id} className="border-2 border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <UserX className="w-5 h-5 text-red-600" />
                        {contact.customer_name && <span className="font-bold text-slate-900">{contact.customer_name}</span>}
                      </div>
                      {contact.email && <p className="text-slate-700"><strong>Email:</strong> {contact.email}</p>}
                      {contact.phone && <p className="text-slate-700"><strong>Phone:</strong> {contact.phone}</p>}
                      <p className="text-slate-700 mt-2"><strong>Reason:</strong> {contact.reason}</p>
                      {contact.notes && <p className="text-sm text-slate-600 mt-1">{contact.notes}</p>}
                      <p className="text-xs text-slate-500 mt-2">Added: {new Date(contact.created_at).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => setDeleteConfirm({ type: 'contacts', id: contact.id })}
                      className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
              {contacts.length === 0 && (
                <p className="text-center text-slate-500 py-8">No blocked contacts</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'addresses' && (
          <div className="space-y-6">
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

            <div className="space-y-3">
              {addresses.map((address) => (
                <div key={address.id} className="border-2 border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="w-5 h-5 text-red-600" />
                        <span className="font-bold text-slate-900">Blocked Address</span>
                      </div>
                      <p className="text-slate-700">{address.address_line1}</p>
                      {address.address_line2 && <p className="text-slate-700">{address.address_line2}</p>}
                      <p className="text-slate-700">{address.city}, {address.state} {address.zip_code}</p>
                      <p className="text-slate-700 mt-2"><strong>Reason:</strong> {address.reason}</p>
                      {address.notes && <p className="text-sm text-slate-600 mt-1">{address.notes}</p>}
                      <p className="text-xs text-slate-500 mt-2">Added: {new Date(address.created_at).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => setDeleteConfirm({ type: 'addresses', id: address.id })}
                      className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
              {addresses.length === 0 && (
                <p className="text-center text-slate-500 py-8">No blocked addresses</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'all' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-6">
              <h3 className="font-bold text-blue-900 mb-2">All Active Blackouts</h3>
              <p className="text-sm text-blue-800">
                This view shows all currently active blackout situations across dates, contacts, and addresses.
              </p>
            </div>

            {dates.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center">
                  <Calendar className="w-5 h-5 mr-2 text-blue-600" />
                  Blackout Dates ({dates.length})
                </h3>
                <div className="space-y-3">
                  {dates.map((date) => (
                    <div key={date.id} className="border-2 border-slate-200 rounded-xl p-4 bg-white">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Calendar className="w-5 h-5 text-blue-600" />
                            <span className="font-bold text-slate-900">
                              {new Date(date.start_date).toLocaleDateString()} - {new Date(date.end_date).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-slate-700"><strong>Reason:</strong> {date.reason}</p>
                          {date.notes && <p className="text-sm text-slate-600 mt-1">{date.notes}</p>}
                        </div>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'dates', id: date.id })}
                          className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {contacts.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center">
                  <UserX className="w-5 h-5 mr-2 text-red-600" />
                  Blocked Contacts ({contacts.length})
                </h3>
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    <div key={contact.id} className="border-2 border-slate-200 rounded-xl p-4 bg-white">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <UserX className="w-5 h-5 text-red-600" />
                            {contact.customer_name && <span className="font-bold text-slate-900">{contact.customer_name}</span>}
                          </div>
                          {contact.email && <p className="text-slate-700"><strong>Email:</strong> {contact.email}</p>}
                          {contact.phone && <p className="text-slate-700"><strong>Phone:</strong> {contact.phone}</p>}
                          <p className="text-slate-700 mt-2"><strong>Reason:</strong> {contact.reason}</p>
                          {contact.notes && <p className="text-sm text-slate-600 mt-1">{contact.notes}</p>}
                        </div>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'contacts', id: contact.id })}
                          className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {addresses.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-red-600" />
                  Blocked Addresses ({addresses.length})
                </h3>
                <div className="space-y-3">
                  {addresses.map((address) => (
                    <div key={address.id} className="border-2 border-slate-200 rounded-xl p-4 bg-white">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <MapPin className="w-5 h-5 text-red-600" />
                            <span className="font-bold text-slate-900">Blocked Address</span>
                          </div>
                          <p className="text-slate-700">{address.address_line1}</p>
                          {address.address_line2 && <p className="text-slate-700">{address.address_line2}</p>}
                          <p className="text-slate-700">{address.city}, {address.state} {address.zip_code}</p>
                          <p className="text-slate-700 mt-2"><strong>Reason:</strong> {address.reason}</p>
                          {address.notes && <p className="text-sm text-slate-600 mt-1">{address.notes}</p>}
                        </div>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'addresses', id: address.id })}
                          className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {overnightHolidayOnly && (
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center">
                  <PartyPopper className="w-5 h-5 mr-2 text-amber-600" />
                  Holiday Restrictions (1)
                </h3>
                <div className="space-y-3">
                  <div className="border-2 border-amber-300 rounded-xl p-4 bg-amber-50">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <PartyPopper className="w-5 h-5 text-amber-600" />
                          <span className="font-bold text-slate-900">Overnight Holiday Only Restriction</span>
                        </div>
                        <p className="text-slate-700">Only overnight rentals are allowed on holidays. Same-day pickups are blocked.</p>
                        <p className="text-sm text-slate-600 mt-2">This applies to all holiday dates in the system.</p>
                      </div>
                      <button
                        onClick={() => setActiveTab('holidays')}
                        className="text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors"
                        title="Manage in Holiday Settings"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {dates.length === 0 && contacts.length === 0 && addresses.length === 0 && !overnightHolidayOnly && (
              <p className="text-center text-slate-500 py-8">No active blackouts</p>
            )}
          </div>
        )}

        {activeTab === 'holidays' && (
          <div className="space-y-6">
            <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 mb-6">
              <h3 className="font-bold text-amber-900 mb-2">Holiday Booking Restrictions</h3>
              <p className="text-sm text-amber-800">
                Configure special restrictions for holiday bookings. These settings help manage availability during busy holiday periods.
              </p>
            </div>

            <div className="bg-white border-2 border-slate-200 rounded-xl p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center">
                <PartyPopper className="w-5 h-5 mr-2 text-amber-600" />
                Overnight Holiday Only
              </h3>
              <p className="text-slate-600 mb-4">
                When enabled, only overnight rentals will be allowed on holidays. Same-day pickup and return will be blocked for holiday dates.
              </p>
              <div className="flex items-center gap-4">
                <select
                  value={overnightHolidayOnly ? 'yes' : 'no'}
                  onChange={(e) => setOvernightHolidayOnly(e.target.value === 'yes')}
                  className="px-4 py-2 border-2 border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none"
                >
                  <option value="no">No - Allow same-day pickups on holidays</option>
                  <option value="yes">Yes - Only allow overnight rentals on holidays</option>
                </select>
                <button
                  onClick={handleSaveHolidaySettings}
                  disabled={savingHolidaySettings}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {savingHolidaySettings ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
              {overnightHolidayOnly && (
                <div className="mt-4 bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-900">
                    <strong>Active:</strong> Only overnight rentals are currently allowed on holidays. Same-day pickups are blocked.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border-2 border-slate-200 rounded-xl p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-2">Tip: Use Blackout Dates for Holidays</h3>
              <p className="text-slate-600">
                To completely block bookings on specific holidays (like Christmas or Thanksgiving), go to the <strong>Dates</strong> tab
                and add blackout date ranges. For partial restrictions (like overnight-only), use the setting above instead.
              </p>
            </div>
          </div>
        )}
      </div>

      {deleteConfirm && (
        <ConfirmationModal
          isOpen={true}
          title="Remove Blackout"
          message="Are you sure you want to remove this blackout? This action cannot be undone."
          confirmLabel="Remove"
          confirmStyle="danger"
          onConfirm={() => handleDelete(deleteConfirm.type, deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
