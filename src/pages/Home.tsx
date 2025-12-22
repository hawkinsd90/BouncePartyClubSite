import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Search, Star, Shield, Clock, DollarSign, Home as HomeIcon, Building2, Zap } from 'lucide-react';
import { AddressAutocomplete } from '../components/order/AddressAutocomplete';
import { HeroCarousel } from '../components/admin/HeroCarousel';
import { useAuth } from '../contexts/AuthContext';
import { createTestBooking } from '../lib/testBooking';
import { notifyError } from '../lib/notifications';

export function Home() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [eventDate, setEventDate] = useState('');
  const [addressData, setAddressData] = useState<any>(null);
  const [locationType, setLocationType] = useState<'residential' | 'commercial'>('residential');
  const [addressInput, setAddressInput] = useState('');
  const [creatingTestBooking, setCreatingTestBooking] = useState(false);

  const handleCheckAvailability = (e: React.FormEvent) => {
    e.preventDefault();

    if (!eventDate) {
      notifyError('Please select an event date');
      return;
    }

    if (!addressData) {
      notifyError('Please enter an event address');
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
      <HeroCarousel
        adminControls={
          isAdmin ? (
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
                  notifyError('Failed to create test booking: ' + result.error);
                }
              }}
              disabled={creatingTestBooking}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-3 sm:px-4 py-2 rounded-lg inline-flex items-center gap-2 font-semibold transition-colors text-xs sm:text-sm shadow-md"
            >
              <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
              {creatingTestBooking ? 'Creating...' : 'Create Test Booking'}
            </button>
          ) : undefined
        }
      />

      <section className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-cyan-600 text-white overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE2YzAtMS4xLjktMiAyLTJoMTZjMS4xIDAgMiAuOSAyIDJ2MTZjMCAxLjEtLjkgMi0yIDJIMzhjLTEuMSAwLTItLjktMi0yVjE2eiIvPjwvZz48L2c+PC9zdmc+')] opacity-20"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 md:py-28 lg:py-36">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold mb-4 sm:mb-6 leading-tight text-balance">
              Make Your Party Unforgettable
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl mb-8 sm:mb-10 text-blue-50 leading-relaxed text-pretty">
              Premium bounce houses, water slides, and party rentals delivered across Detroit and surrounding areas.
            </p>

            <form onSubmit={handleCheckAvailability} className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
              <h2 className="text-slate-900 text-xl sm:text-2xl font-bold mb-5 sm:mb-6">Check Availability</h2>

              <div className="mb-5 sm:mb-6">
                <label className="block text-sm sm:text-base font-semibold text-slate-700 mb-3 sm:mb-4">
                  Event Type
                </label>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={() => setLocationType('residential')}
                    className={`flex flex-col items-center p-4 sm:p-5 rounded-xl border-2 transition-all shadow-sm hover:shadow-md ${
                      locationType === 'residential'
                        ? 'border-blue-600 bg-blue-50 shadow-md'
                        : 'border-slate-300 hover:border-blue-400 bg-white'
                    }`}
                  >
                    <HomeIcon className={`w-7 h-7 sm:w-9 sm:h-9 mb-2 sm:mb-3 ${
                      locationType === 'residential' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    <span className={`text-sm sm:text-base font-bold ${
                      locationType === 'residential' ? 'text-blue-900' : 'text-slate-700'
                    }`}>
                      Residential
                    </span>
                    <span className="text-xs sm:text-sm text-slate-600 mt-1 sm:mt-1.5 text-center">
                      Home, backyard
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationType('commercial')}
                    className={`flex flex-col items-center p-4 sm:p-5 rounded-xl border-2 transition-all shadow-sm hover:shadow-md ${
                      locationType === 'commercial'
                        ? 'border-blue-600 bg-blue-50 shadow-md'
                        : 'border-slate-300 hover:border-blue-400 bg-white'
                    }`}
                  >
                    <Building2 className={`w-7 h-7 sm:w-9 sm:h-9 mb-2 sm:mb-3 ${
                      locationType === 'commercial' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    <span className={`text-sm sm:text-base font-bold ${
                      locationType === 'commercial' ? 'text-blue-900' : 'text-slate-700'
                    }`}>
                      Commercial
                    </span>
                    <span className="text-xs sm:text-sm text-slate-600 mt-1 sm:mt-1.5 text-center">
                      School, park, church
                    </span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 mb-5 sm:mb-6">
                <div>
                  <label className="block text-sm sm:text-base font-semibold text-slate-700 mb-2.5">
                    Event Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 text-sm sm:text-base font-medium transition-all"
                      min={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm sm:text-base font-semibold text-slate-700 mb-2.5">
                    Event Address
                  </label>
                  <AddressAutocomplete
                    value={addressInput}
                    onChange={(value) => setAddressInput(value)}
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
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center text-base sm:text-lg"
              >
                <Search className="w-5 h-5 sm:w-6 sm:h-6 mr-2.5" />
                Find Available Units
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 text-center mb-12 sm:mb-16 tracking-tight">
          Why Choose Bounce Party Club?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10">
          <div className="text-center group">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-100 to-blue-50 rounded-2xl mb-5 shadow-md group-hover:shadow-xl transition-shadow">
              <Star className="w-10 h-10 text-blue-600" />
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">
              Premium Quality
            </h3>
            <p className="text-slate-600 leading-relaxed text-base">
              Clean, well-maintained inflatables that exceed safety standards
            </p>
          </div>

          <div className="text-center group">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl mb-5 shadow-md group-hover:shadow-xl transition-shadow">
              <Shield className="w-10 h-10 text-green-600" />
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">
              Safety First
            </h3>
            <p className="text-slate-600 leading-relaxed text-base">
              Rigorous safety standards and regular equipment inspections
            </p>
          </div>

          <div className="text-center group">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-orange-100 to-orange-50 rounded-2xl mb-5 shadow-md group-hover:shadow-xl transition-shadow">
              <Clock className="w-10 h-10 text-orange-600" />
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">
              On-Time Delivery
            </h3>
            <p className="text-slate-600 leading-relaxed text-base">
              Punctual setup and pickup with real-time tracking
            </p>
          </div>

          <div className="text-center group">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-cyan-100 to-cyan-50 rounded-2xl mb-5 shadow-md group-hover:shadow-xl transition-shadow">
              <DollarSign className="w-10 h-10 text-cyan-600" />
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">
              Best Prices
            </h3>
            <p className="text-slate-600 leading-relaxed text-base">
              Competitive rates with transparent pricing and no hidden fees
            </p>
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-br from-slate-50 to-slate-100 py-16 sm:py-20 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 text-center mb-4 sm:mb-5 tracking-tight text-balance">
            Serving Wayne and the Greater Detroit Area
          </h2>
          <p className="text-lg sm:text-xl md:text-2xl text-slate-600 text-center mb-10 sm:mb-12 px-4 leading-relaxed max-w-4xl mx-auto text-pretty">
            Free delivery within 20 miles of Wayne, MI or anywhere in Detroit. Additional travel fees apply beyond our service area.
          </p>
          <div className="text-center">
            <button
              onClick={() => navigate('/contact')}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-4 sm:py-5 px-8 sm:px-10 rounded-xl transition-all shadow-xl hover:shadow-2xl text-lg sm:text-xl"
            >
              Get a Quote
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
