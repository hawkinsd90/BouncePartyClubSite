import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building2, Home as HomeIcon } from 'lucide-react';
import { HeroCarousel } from '../components/admin/HeroCarousel';
import { AddressAutocomplete } from '../components/order/AddressAutocomplete';
import { SafeStorage } from '../lib/safeStorage';
import { useAuth } from '../contexts/AuthContext';
import { useCustomerProfile } from '../contexts/CustomerProfileContext';

interface SelectedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  formatted_address: string;
}

export function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { sessionData } = useCustomerProfile();

  const [eventDate, setEventDate] = useState('');
  const [locationType, setLocationType] = useState<'residential' | 'commercial'>('residential');
  const [addressInput, setAddressInput] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null);
  const [dateError, setDateError] = useState('');
  const [addressError, setAddressError] = useState('');

  const profilePrefillApplied = useRef(false);

  useEffect(() => {
    if (
      !user ||
      profilePrefillApplied.current ||
      !sessionData.addressLine1
    ) return;

    profilePrefillApplied.current = true;

    const parts = [
      sessionData.addressLine1,
      sessionData.addressLine2,
      sessionData.city,
      sessionData.state,
      sessionData.zip,
    ].filter(Boolean);

    setAddressInput(parts.join(', '));
    setSelectedAddress({
      street: sessionData.addressLine1,
      city: sessionData.city || 'Detroit',
      state: sessionData.state || 'MI',
      zip: sessionData.zip || '',
      lat: 0,
      lng: 0,
      formatted_address: parts.join(', '),
    });
  }, [user, sessionData.addressLine1]);

  const handleAddressSelect = (address: SelectedAddress) => {
    setSelectedAddress(address);
    setAddressInput(address.formatted_address || address.street);
    setAddressError('');
  };

  const handleFindUnits = () => {
    let valid = true;

    if (!eventDate) {
      setDateError('Please select an event date.');
      valid = false;
    } else {
      setDateError('');
    }

    if (!selectedAddress?.street && !addressInput.trim()) {
      setAddressError('Please enter your event address.');
      valid = false;
    } else {
      setAddressError('');
    }

    if (!valid) return;

    const prefill: Record<string, any> = {
      event_date: eventDate,
      location_type: locationType,
    };

    if (selectedAddress?.street) {
      prefill.address = {
        street: selectedAddress.street,
        city: selectedAddress.city,
        state: selectedAddress.state,
        zip: selectedAddress.zip,
        lat: selectedAddress.lat,
        lng: selectedAddress.lng,
        formatted_address: selectedAddress.formatted_address,
      };
    } else if (addressInput.trim()) {
      prefill.address = {
        street: addressInput.trim(),
        city: sessionData.city || 'Detroit',
        state: sessionData.state || 'MI',
        zip: sessionData.zip || '',
        lat: 0,
        lng: 0,
        formatted_address: addressInput.trim(),
      };
    }

    SafeStorage.setItem('bpc_quote_prefill', prefill);
    navigate('/quote');
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="min-h-screen">
      <HeroCarousel adminControls={false} />

      <section className="bg-gradient-to-b from-blue-700 to-blue-800 py-16 sm:py-24 px-4">
        <div className="max-w-4xl mx-auto text-center text-white mb-10">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight mb-4 leading-tight">
            Make Your Party<br />Unforgettable
          </h1>
          <p className="text-lg sm:text-xl text-blue-100 max-w-2xl mx-auto">
            Premium bounce houses, water slides, and party rentals delivered across
            Detroit and surrounding areas.
          </p>
        </div>

        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
          <h2 className="text-xl font-bold text-slate-900 mb-5">Check Availability</h2>

          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Event Type</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setLocationType('residential')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    locationType === 'residential'
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <HomeIcon className="w-6 h-6" />
                  <span className="font-semibold text-sm">Residential</span>
                  <span className="text-xs text-slate-500">Home, backyard</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLocationType('commercial')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    locationType === 'commercial'
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <Building2 className="w-6 h-6" />
                  <span className="font-semibold text-sm">Commercial</span>
                  <span className="text-xs text-slate-500">School, park, church</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Event Date
                </label>
                <input
                  type="date"
                  value={eventDate}
                  min={today}
                  onChange={(e) => {
                    setEventDate(e.target.value);
                    if (e.target.value) setDateError('');
                  }}
                  className={`w-full px-4 py-3 border-2 rounded-xl text-slate-900 transition-all focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    dateError ? 'border-red-400' : 'border-slate-300'
                  }`}
                />
                {dateError && (
                  <p className="text-red-600 text-xs mt-1">{dateError}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Event Address
                </label>
                <AddressAutocomplete
                  value={addressInput}
                  onChange={setAddressInput}
                  onSelect={handleAddressSelect}
                  placeholder="Enter your address"
                />
                {addressError && (
                  <p className="text-red-600 text-xs mt-1">{addressError}</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleFindUnits}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 text-base"
            >
              <Search className="w-5 h-5" />
              Find Available Units
            </button>
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 text-center mb-12">
            Why Choose Bounce Party Club?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: 'Easy Booking',
                description: 'Book online in minutes. Get an instant quote and confirm your reservation without any hassle.',
                icon: '📋',
              },
              {
                title: 'Professional Setup',
                description: 'Our crew handles full delivery, setup, and pickup so you can focus on the fun.',
                icon: '🏗️',
              },
              {
                title: 'Clean & Safe',
                description: 'All units are sanitized between rentals and safety-inspected to keep your guests safe.',
                icon: '✅',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="text-center p-6 rounded-2xl bg-slate-50 border border-slate-100"
              >
                <div className="text-4xl mb-4">{item.icon}</div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-blue-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-slate-900 mb-4">
            Ready to bounce?
          </h2>
          <p className="text-slate-600 mb-8 text-lg">
            Browse our full selection of bounce houses, water slides, and combo units.
          </p>
          <button
            type="button"
            onClick={() => navigate('/catalog')}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg hover:shadow-xl text-base"
          >
            Browse Inflatables
          </button>
        </div>
      </section>
    </div>
  );
}
