import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Calendar, UserX, MapPin, List, PartyPopper } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { showConfirm } from '../../lib/notifications';
import { BlackoutDateForm } from './blackout/BlackoutDateForm';
import { BlackoutDatesList } from './blackout/BlackoutDatesList';
import { BlackoutContactForm } from './blackout/BlackoutContactForm';
import { BlackoutContactsList } from './blackout/BlackoutContactsList';
import { BlackoutAddressForm } from './blackout/BlackoutAddressForm';
import { BlackoutAddressesList } from './blackout/BlackoutAddressesList';

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
  const [overnightHolidayOnly, setOvernightHolidayOnly] = useState(false);
  const [savingHolidaySettings, setSavingHolidaySettings] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [datesRes, contactsRes, addressesRes, pricingRes] = await Promise.all([
        supabase.from('blackout_dates' as any).select('*').order('start_date', { ascending: false }),
        supabase.from('blackout_contacts' as any).select('*').order('created_at', { ascending: false }),
        supabase.from('blackout_addresses' as any).select('*').order('created_at', { ascending: false }),
        supabase.from('pricing_rules').select('overnight_holiday_only').limit(1).maybeSingle(),
      ]);

      if (datesRes.error) throw datesRes.error;
      if (contactsRes.error) throw contactsRes.error;
      if (addressesRes.error) throw addressesRes.error;

      setDates(datesRes.data as any || []);
      setContacts(contactsRes.data as any || []);
      setAddresses(addressesRes.data as any || []);
      setOvernightHolidayOnly(pricingRes.data?.overnight_holiday_only || false);
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(type: string, id: string) {
    const confirmed = await showConfirm(
      'Are you sure you want to remove this blackout? This action cannot be undone.',
      { confirmText: 'Remove', type: 'warning' }
    );

    if (!confirmed) return;

    try {
      let error;
      if (type === 'dates') {
        ({ error } = await supabase.from('blackout_dates' as any).delete().eq('id', id));
      } else if (type === 'contacts') {
        ({ error } = await supabase.from('blackout_contacts' as any).delete().eq('id', id));
      } else {
        ({ error } = await supabase.from('blackout_addresses' as any).delete().eq('id', id));
      }

      if (error) throw error;

      notifySuccess('Blackout removed successfully');
      fetchData();
    } catch (error: any) {
      notifyError(error.message);
    }
  }

  async function handleSaveHolidaySettings() {
    setSavingHolidaySettings(true);
    try {
      const { data: pricingRule } = await supabase.from('pricing_rules').select('id').limit(1).single();

      if (!pricingRule) throw new Error('Pricing rules not found');

      const { error } = await supabase
        .from('pricing_rules')
        .update({ overnight_holiday_only: overnightHolidayOnly })
        .eq('id', pricingRule.id);

      if (error) throw error;

      notifySuccess('Holiday settings updated successfully');
      fetchData();
    } catch (error: any) {
      notifyError(error.message);
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
            <BlackoutDateForm onSuccess={fetchData} />
            <BlackoutDatesList dates={dates} onDelete={(id) => handleDelete('dates', id)} />
          </div>
        )}

        {activeTab === 'contacts' && (
          <div className="space-y-6">
            <BlackoutContactForm onSuccess={fetchData} />
            <BlackoutContactsList contacts={contacts} onDelete={(id) => handleDelete('contacts', id)} />
          </div>
        )}

        {activeTab === 'addresses' && (
          <div className="space-y-6">
            <BlackoutAddressForm onSuccess={fetchData} />
            <BlackoutAddressesList addresses={addresses} onDelete={(id) => handleDelete('addresses', id)} />
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

            {overnightHolidayOnly && (
              <div className="border-2 border-amber-300 bg-amber-50 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-200 rounded-lg">
                    <PartyPopper className="w-5 h-5 text-amber-700" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-amber-900 mb-1">Holiday Restriction Active</h4>
                    <p className="text-sm text-amber-800">
                      Overnight rentals only on holidays - same-day pickup and return blocked for holiday dates
                    </p>
                  </div>
                </div>
              </div>
            )}

            {dates.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center">
                  <Calendar className="w-5 h-5 mr-2 text-blue-600" />
                  Blackout Dates ({dates.length})
                </h3>
                <BlackoutDatesList dates={dates} onDelete={(id) => handleDelete('dates', id)} />
              </div>
            )}

            {contacts.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center">
                  <UserX className="w-5 h-5 mr-2 text-red-600" />
                  Blocked Contacts ({contacts.length})
                </h3>
                <BlackoutContactsList contacts={contacts} onDelete={(id) => handleDelete('contacts', id)} />
              </div>
            )}

            {addresses.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-green-600" />
                  Blocked Addresses ({addresses.length})
                </h3>
                <BlackoutAddressesList addresses={addresses} onDelete={(id) => handleDelete('addresses', id)} />
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
    </div>
  );
}
