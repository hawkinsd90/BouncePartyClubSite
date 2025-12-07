import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Search, Star, Shield, Clock, DollarSign, Home as HomeIcon, Building2, Zap } from 'lucide-react';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { HeroCarousel } from '../components/HeroCarousel';
import { useAuth } from '../contexts/AuthContext';
import { createTestBooking } from '../lib/testBooking';

export function Home() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [eventDate, setEventDate] = useState('');
  const [addressData, setAddressData] = useState<any>(null);
  const [locationType, setLocationType] = useState<'residential' | 'commercial'>('residential');
  const [addressInput, setAddressInput] = useState('');
  const [creatingTestBooking, setCreatingTestBooking] = useState(false);

  const handleCheckAvailability = (e: React.FormEvent) => {
    e.preventDefault();

    if (!eventDate) {
      alert('Please select an event date');
      return;
    }

    if (!addressData) {
      alert('Please enter an event address');
      return;
    }

    const quoteData = {
      event_date: eventDate,
      address: addressData,
      location_type: locationType,
    };

    localStorage.setItem('bpc_quote_prefill', JSON.stringify(quoteData));
    navigate('/catalog');
  };

  return (
    <div className="relative">
      {/* Admin Test Booking Button - Floating */}
      {role === 'ADMIN' && (
        <button
          onClick={async () => {
            console.log('🎬 [HOME] Create Test Booking button clicked');

            console.log('🧹 [HOME] Clearing existing localStorage data...');
            localStorage.removeItem('bpc_cart');
            localStorage.removeItem('bpc_quote_form');
            localStorage.removeItem('bpc_price_breakdown');
            localStorage.removeItem('bpc_contact_data');
            localStorage.removeItem('test_booking_tip');

            setCreatingTestBooking(true);
            console.log('⏳ [HOME] Calling createTestBooking()...');
            const result = await createTestBooking();
            console.log('📊 [HOME] createTestBooking() result:', result);
            setCreatingTestBooking(false);
            if (result.success) {
              console.log('✅ [HOME] Test booking created successfully, navigating to /checkout');
              navigate('/checkout');
            } else {
              console.error('❌ [HOME] Test booking failed:', result.error);
              alert('Failed to create test booking: ' + result.error);
            }
          }}
          disabled={creatingTestBooking}
          className="fixed top-20 left-4 sm:left-auto sm:right-4 z-50 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-3 sm:px-4 py-2 rounded-lg font-semibold transition-colors text-xs sm:text-sm shadow-lg"
        >
          <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
          {creatingTestBooking ? 'Creating...' : 'Create Test Booking'}
        </button>
      )}
      <div>
      <HeroCarousel />

      <section className="relative bg-gradient-to-br from-blue-600 to-cyan-500 text-white">
        <div className="absolute inset-0 bg-black opacity-10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 md:py-24 lg:py-32">
          <div className="max-w-3xl">
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6 leading-tight">
              Make Your Party Unforgettable
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl mb-6 sm:mb-8 text-blue-50">
              Premium bounce houses, water slides, and party rentals delivered across Detroit
              and surrounding areas.
            </p>

            <form onSubmit={handleCheckAvailability} className="bg-white rounded-lg shadow-xl p-4 sm:p-6">
              <h2 className="text-slate-900 text-base sm:text-lg font-semibold mb-3 sm:mb-4">
                Check Availability
              </h2>

              <div className="mb-3 sm:mb-4">
                <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2 sm:mb-3">
                  Event Type
                </label>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => setLocationType('residential')}
                    className={`flex flex-col items-center p-3 sm:p-4 rounded-lg border-2 transition-all ${
                      locationType === 'residential'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <HomeIcon className={`w-6 h-6 sm:w-8 sm:h-8 mb-1 sm:mb-2 ${
                      locationType === 'residential' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    <span className={`text-sm sm:text-base font-semibold ${
                      locationType === 'residential' ? 'text-blue-900' : 'text-slate-700'
                    }`}>
                      Residential
                    </span>
                    <span className="text-xs text-slate-600 mt-0.5 sm:mt-1 text-center">
                      Home, backyard
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationType('commercial')}
                    className={`flex flex-col items-center p-3 sm:p-4 rounded-lg border-2 transition-all ${
                      locationType === 'commercial'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <Building2 className={`w-6 h-6 sm:w-8 sm:h-8 mb-1 sm:mb-2 ${
                      locationType === 'commercial' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    <span className={`text-sm sm:text-base font-semibold ${
                      locationType === 'commercial' ? 'text-blue-900' : 'text-slate-700'
                    }`}>
                      Commercial
                    </span>
                    <span className="text-xs text-slate-600 mt-0.5 sm:mt-1 text-center">
                      School, park, church
                    </span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">
                    Event Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="w-full pl-9 sm:pl-10 pr-3 sm:pr-4 py-2.5 sm:py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base"
                      min={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">
                    Event Address
                  </label>
                  <AddressAutocomplete
                    value={addressInput}
                    onSelect={(address) => {
                      setAddressData(address);
                      setAddressInput(address.formatted_address);
                    }}
                    placeholder="Enter your address"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg transition-colors flex items-center justify-center text-sm sm:text-base"
              >
                <Search className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                Find Available Units
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-8 sm:mb-12">
          Why Choose Bounce Party Club?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <Star className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">
              Premium Quality
            </h3>
            <p className="text-slate-600">
              Clean, well-maintained inflatables that exceed safety standards
            </p>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
              <Shield className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">
              Safety First
            </h3>
            <p className="text-slate-600">
              Rigorous safety standards and regular equipment inspections
            </p>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-full mb-4">
              <Clock className="w-8 h-8 text-orange-600" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">
              On-Time Delivery
            </h3>
            <p className="text-slate-600">
              Punctual setup and pickup with real-time tracking
            </p>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-100 rounded-full mb-4">
              <DollarSign className="w-8 h-8 text-cyan-600" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">
              Best Prices
            </h3>
            <p className="text-slate-600">
              Competitive rates with transparent pricing and no hidden fees
            </p>
          </div>
        </div>
      </section>

      <section className="bg-slate-100 py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-3 sm:mb-4">
            Serving Wayne and the Greater Detroit Area
          </h2>
          <p className="text-base sm:text-lg md:text-xl text-slate-600 text-center mb-8 sm:mb-12 px-4">
            Free delivery within 20 miles of Wayne, MI or anywhere in Detroit. Additional travel fees apply beyond our service area.
          </p>
          <div className="text-center">
            <button
              onClick={() => navigate('/contact')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 sm:py-4 px-6 sm:px-8 rounded-lg transition-colors text-base sm:text-lg"
            >
              Get a Quote
            </button>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
