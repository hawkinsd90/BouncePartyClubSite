import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Search,
  Star,
  Shield,
  Clock,
  DollarSign,
  Home as HomeIcon,
  Building2,
  Zap,
  ExternalLink,
  Sun,
} from 'lucide-react';
import { AddressAutocomplete } from '../components/order/AddressAutocomplete';
import { HeroCarousel } from '../components/admin/HeroCarousel';
import { SafeStorage } from '../lib/safeStorage';
import { useAuth } from '../contexts/AuthContext';
import { useCustomerProfile } from '../contexts/CustomerProfileContext';
import { createTestBooking } from '../lib/testBooking';
import { notifyError } from '../lib/notifications';
import { createLogger } from '../lib/logger';
import { supabase } from '../lib/supabase';

const log = createLogger('Home');

interface GoogleReview {
  id: string;
  reviewer_name: string;
  reviewer_initial: string;
  rating: number;
  review_text: string;
  review_date: string;
  google_review_url: string | null;
  display_order: number;
}

export function Home() {
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();
  const { sessionData, loading: profileLoading } = useCustomerProfile();

  const [eventDate, setEventDate] = useState('');
  const [addressData, setAddressData] = useState<any>(null);
  const [locationType, setLocationType] = useState<'residential' | 'commercial'>('residential');
  const [addressInput, setAddressInput] = useState('');
  const [creatingTestBooking, setCreatingTestBooking] = useState(false);
  const [reviews, setReviews] = useState<GoogleReview[]>([]);
  const [averageRating, setAverageRating] = useState(5.0);
  const [addressAutofilled, setAddressAutofilled] = useState(false);

  useEffect(() => {
    loadReviews();
  }, []);

  useEffect(() => {
    if (user && !profileLoading && !addressAutofilled && sessionData.addressLine1) {
      const formattedAddress = `${sessionData.addressLine1}${sessionData.addressLine2 ? ', ' + sessionData.addressLine2 : ''}, ${sessionData.city}, ${sessionData.state} ${sessionData.zip}`;

      setAddressInput(formattedAddress);
      setAddressData({
        formatted_address: formattedAddress,
        street: sessionData.addressLine1,
        line1: sessionData.addressLine1,
        line2: sessionData.addressLine2,
        city: sessionData.city,
        state: sessionData.state,
        zip: sessionData.zip,
      });
      setAddressAutofilled(true);
    }
  }, [user, profileLoading, sessionData, addressAutofilled]);

  async function loadReviews() {
    try {
      const { data, error } = await supabase
        .from('google_reviews')
        .select('*')
        .eq('is_active', true)
        .gte('rating', 4)
        .order('display_order', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setReviews(data);
        const avg = data.reduce((sum, review) => sum + review.rating, 0) / data.length;
        setAverageRating(Math.round(avg * 10) / 10);
      }
    } catch (error) {
      console.error('Error loading reviews:', error);
    }
  }

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

    SafeStorage.setItem('bpc_quote_prefill', quoteData, { expirationDays: 7 });
    navigate('/catalog');
  };

  return (
    <div className="relative">
      <HeroCarousel
        adminControls={
          isAdmin ? (
            <button
              onClick={async () => {
                log.info('Create Test Booking button clicked');
                setCreatingTestBooking(true);

                log.info('Calling createTestBooking');
                const result = await createTestBooking();
                log.debug('createTestBooking result', result);

                setCreatingTestBooking(false);

                if (result.success) {
                  log.info('Test booking created successfully, navigating to /checkout');
                  navigate('/checkout');
                } else {
                  log.error('Test booking failed', result.error);
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

      <style>{`
        @keyframes ribbon-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ribbon-scroll { animation: ribbon-scroll 28s linear infinite; }
        .ribbon-scroll:hover { animation-play-state: paused; }
      `}</style>
      <div className="relative" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.25))' }}>
        <svg className="absolute top-0 left-0 h-full" style={{ width: '28px', zIndex: 10 }} viewBox="0 0 28 48" preserveAspectRatio="none">
          <polygon points="28,0 28,48 0,24" fill="#d97706" />
          <polygon points="28,0 28,6 4,24 28,42 28,48 0,24" fill="rgba(0,0,0,0.12)" />
        </svg>
        <svg className="absolute top-0 right-0 h-full" style={{ width: '28px', zIndex: 10 }} viewBox="0 0 28 48" preserveAspectRatio="none">
          <polygon points="0,0 0,48 28,24" fill="#d97706" />
          <polygon points="0,0 0,6 24,24 0,42 0,48 28,24" fill="rgba(0,0,0,0.12)" />
        </svg>
        <div className="overflow-hidden" style={{ background: 'linear-gradient(180deg, #f59e0b 0%, #d97706 50%, #b45309 100%)', borderTop: '2px solid rgba(255,255,255,0.25)', borderBottom: '2px solid rgba(0,0,0,0.18)' }}>
          <div className="ribbon-scroll flex items-center whitespace-nowrap py-3" style={{ width: 'max-content' }}>
            {[...Array(6)].map((_, i) => (
              <span key={i} className="flex items-center gap-3 px-8">
                <Sun className="w-4 h-4 text-yellow-100 flex-shrink-0" style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,180,0.8))' }} />
                <span className="text-sm sm:text-base font-extrabold tracking-widest text-white uppercase" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35), 0 0 12px rgba(255,220,100,0.25)' }}>
                  We Specialize in ALL DAY Rentals
                </span>
                <span className="text-amber-200 font-bold text-xs tracking-wider uppercase" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
                  · Delivered in the morning, picked up the next morning ·
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

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
              <h2 className="text-slate-900 text-xl sm:text-2xl font-bold mb-5 sm:mb-6">
                Check Availability
              </h2>

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
                    <HomeIcon
                      className={`w-7 h-7 sm:w-9 sm:h-9 mb-2 sm:mb-3 ${
                        locationType === 'residential' ? 'text-blue-600' : 'text-slate-400'
                      }`}
                    />
                    <span
                      className={`text-sm sm:text-base font-bold ${
                        locationType === 'residential' ? 'text-blue-900' : 'text-slate-700'
                      }`}
                    >
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
                    <Building2
                      className={`w-7 h-7 sm:w-9 sm:h-9 mb-2 sm:mb-3 ${
                        locationType === 'commercial' ? 'text-blue-600' : 'text-slate-400'
                      }`}
                    />
                    <span
                      className={`text-sm sm:text-base font-bold ${
                        locationType === 'commercial' ? 'text-blue-900' : 'text-slate-700'
                      }`}
                    >
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
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 pointer-events-none z-10" />
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      style={{ fontSize: '16px' }}
                      className="w-full pl-10 sm:pl-11 pr-3 sm:pr-4 py-3 sm:py-3.5 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 font-medium transition-all appearance-none"
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

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="text-left">
          <button
            onClick={() => navigate('/contact')}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-4 sm:py-5 px-8 sm:px-10 rounded-xl transition-all shadow-xl hover:shadow-2xl text-lg sm:text-xl"
          >
            Get a Quote
          </button>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-20 lg:py-24">
        <h2 className="text-2xl sm:text-4xl lg:text-5xl font-bold text-slate-900 text-center mb-6 sm:mb-16 tracking-tight">
          Why Choose Bounce Party Club?
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-10">
          <div className="text-center group">
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 bg-gradient-to-br from-blue-100 to-blue-50 rounded-xl sm:rounded-2xl mb-2 sm:mb-5 shadow-md group-hover:shadow-xl transition-shadow">
              <Star className="w-7 h-7 sm:w-10 sm:h-10 text-blue-600" />
            </div>
            <h3 className="text-base sm:text-2xl font-bold text-slate-900 mb-1 sm:mb-3">
              Premium Quality
            </h3>
            <p className="text-slate-600 leading-snug sm:leading-relaxed text-xs sm:text-base hidden sm:block">
              Clean, well-maintained inflatables that exceed safety standards
            </p>
          </div>

          <div className="text-center group">
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 bg-gradient-to-br from-green-100 to-green-50 rounded-xl sm:rounded-2xl mb-2 sm:mb-5 shadow-md group-hover:shadow-xl transition-shadow">
              <Shield className="w-7 h-7 sm:w-10 sm:h-10 text-green-600" />
            </div>
            <h3 className="text-base sm:text-2xl font-bold text-slate-900 mb-1 sm:mb-3">
              Safety First
            </h3>
            <p className="text-slate-600 leading-snug sm:leading-relaxed text-xs sm:text-base hidden sm:block">
              Rigorous safety standards and regular equipment inspections
            </p>
          </div>

          <div className="text-center group">
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 bg-gradient-to-br from-orange-100 to-orange-50 rounded-xl sm:rounded-2xl mb-2 sm:mb-5 shadow-md group-hover:shadow-xl transition-shadow">
              <Clock className="w-7 h-7 sm:w-10 sm:h-10 text-orange-600" />
            </div>
            <h3 className="text-base sm:text-2xl font-bold text-slate-900 mb-1 sm:mb-3">
              On-Time Delivery
            </h3>
            <p className="text-slate-600 leading-snug sm:leading-relaxed text-xs sm:text-base hidden sm:block">
              Punctual setup and pickup with real-time tracking
            </p>
          </div>

          <div className="text-center group">
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 bg-gradient-to-br from-cyan-100 to-cyan-50 rounded-xl sm:rounded-2xl mb-2 sm:mb-5 shadow-md group-hover:shadow-xl transition-shadow">
              <DollarSign className="w-7 h-7 sm:w-10 sm:h-10 text-cyan-600" />
            </div>
            <h3 className="text-base sm:text-2xl font-bold text-slate-900 mb-1 sm:mb-3">
              Best Prices
            </h3>
            <p className="text-slate-600 leading-snug sm:leading-relaxed text-xs sm:text-base hidden sm:block">
              Competitive rates with transparent pricing and no hidden fees
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white py-16 sm:py-20 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 text-center mb-3 sm:mb-4 tracking-tight">
            What Our Customers Say
          </h2>

          <div className="flex items-center justify-center mb-10 sm:mb-12">
            <div className="flex items-center">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-6 h-6 sm:w-7 sm:h-7 fill-yellow-400 text-yellow-400" />
              ))}
            </div>
            <span className="ml-3 text-2xl sm:text-3xl font-bold text-slate-900">
              {averageRating.toFixed(1)}
            </span>
            <span className="ml-2 text-lg sm:text-xl text-slate-600">on Google</span>
          </div>

          {reviews.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8 sm:mb-10 max-w-6xl mx-auto">
              {reviews.map((review) => (
                <div key={review.id} className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-6 sm:p-8 shadow-lg">
                  <div className="flex items-start mb-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
                      {review.reviewer_initial}
                    </div>

                    <div className="ml-4 flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-bold text-slate-900 text-lg">{review.reviewer_name}</h3>
                        <div className="flex">
                          {[...Array(5)].map((_, i) => (
                            <Star
                              key={i}
                              className={`w-4 h-4 ${
                                i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      <p className="text-slate-600 text-sm mb-3">{review.review_date}</p>
                      <p className="text-slate-700 text-base leading-relaxed">
                        "{review.review_text}"
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-6 sm:p-8 lg:p-10 shadow-lg max-w-3xl mx-auto mb-8 sm:mb-10">
              <p className="text-center text-slate-600">Loading reviews...</p>
            </div>
          )}

          <div className="text-center">
            <a
              href="https://www.google.com/maps/place/Bounce+Party+Club/@42.280800,-83.386300,15z/data=!4m6!3m5!1s0x0:0x0!8m2!3d42.280800!4d-83.386300!16s%2Fg%2F11y3g7k9qy"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-blue-600 hover:text-blue-700 font-semibold text-lg transition-colors"
            >
              Read more reviews on Google
              <ExternalLink className="w-5 h-5 ml-2" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}