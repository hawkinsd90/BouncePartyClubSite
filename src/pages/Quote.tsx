import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  formatCurrency,
  calculatePrice,
  calculateDrivingDistance,
  type PricingRules,
} from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { MapPin, Calendar, Home, Building2, Droplets, Trash2, Zap, AlertCircle, CheckCircle2, Clock, Sun, Anchor, XCircle } from 'lucide-react';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { checkMultipleUnitsAvailability } from '../lib/availability';

interface CartItem {
  unit_id: string;
  unit_name: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  qty: number;
  is_combo?: boolean;
  isAvailable?: boolean;
}

interface QuoteFormData {
  event_date: string;
  event_end_date: string;
  start_window: string;
  end_window: string;
  until_end_of_day: boolean;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  location_type: 'residential' | 'commercial';
  pickup_preference: 'same_day' | 'next_day';
  same_day_responsibility_accepted: boolean;
  can_stake: boolean;
  has_generator: boolean;
  has_pets: boolean;
  special_details: string;
}

export function Quote() {
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRules | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const [formData, setFormData] = useState<QuoteFormData>({
    event_date: '',
    event_end_date: '',
    start_window: '09:00',
    end_window: '17:00',
    until_end_of_day: false,
    address_line1: '',
    address_line2: '',
    city: 'Detroit',
    state: 'MI',
    zip: '',
    lat: 0,
    lng: 0,
    location_type: 'residential',
    pickup_preference: 'next_day',
    same_day_responsibility_accepted: false,
    can_stake: true,
    has_generator: false,
    has_pets: false,
    special_details: '',
  });
  const [priceBreakdown, setPriceBreakdown] = useState<any>(null);

  useEffect(() => {
    loadCart();
    loadPricingRules();
    loadPrefillData();
  }, []);

  useEffect(() => {
    if (formData.event_date && !formData.event_end_date) {
      setFormData(prev => ({ ...prev, event_end_date: prev.event_date }));
    }
  }, [formData.event_date]);

  useEffect(() => {
    if (cart.length > 0 && pricingRules && formData.zip && formData.lat && formData.lng) {
      calculatePricing();
    }
  }, [cart, pricingRules, formData]);

  useEffect(() => {
    if (cart.length > 0 && formData.event_date && formData.event_end_date) {
      const timer = setTimeout(() => {
        checkCartAvailability();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [formData.event_date, formData.event_end_date]);

  useEffect(() => {
    if (formData.location_type === 'commercial') {
      setFormData(prev => ({ ...prev, pickup_preference: 'same_day' }));
    }
  }, [formData.location_type]);

  useEffect(() => {
    const isSameDayRestricted = (formData.location_type === 'residential' && formData.pickup_preference === 'same_day') || formData.location_type === 'commercial';

    if (isSameDayRestricted) {
      setFormData(prev => ({
        ...prev,
        event_end_date: prev.event_date,
        until_end_of_day: false,
        end_window: prev.end_window > '19:00' ? '19:00' : prev.end_window,
      }));
    }
  }, [formData.pickup_preference, formData.location_type, formData.event_date]);

  function loadPrefillData() {
    const prefillData = localStorage.getItem('bpc_quote_prefill');
    if (prefillData) {
      try {
        const data = JSON.parse(prefillData);
        if (data.event_date) {
          setFormData(prev => ({
            ...prev,
            event_date: data.event_date,
            event_end_date: data.event_date,
          }));
        }
        if (data.address) {
          setAddressInput(data.address.formatted_address || data.address.street || '');
          setFormData(prev => ({
            ...prev,
            address_line1: data.address.street || '',
            city: data.address.city || 'Detroit',
            state: data.address.state || 'MI',
            zip: data.address.zip || '',
            lat: data.address.lat || 0,
            lng: data.address.lng || 0,
          }));
        }
        if (data.location_type) {
          setFormData(prev => ({
            ...prev,
            location_type: data.location_type,
          }));
        }
      } catch (error) {
        console.error('Error loading prefill data:', error);
      }
    }
  }

  function loadCart() {
    const savedCart = JSON.parse(localStorage.getItem('bpc_cart') || '[]');
    setCart(savedCart);

    // Also restore form data from localStorage if it exists
    const savedFormData = localStorage.getItem('bpc_quote_form');
    if (savedFormData) {
      try {
        const parsedFormData = JSON.parse(savedFormData);
        // Exclude same_day_responsibility_accepted - user must re-check each time
        const { same_day_responsibility_accepted, ...safeFormData } = parsedFormData;
        setFormData(prev => ({
          ...prev,
          ...safeFormData,
        }));

        // Also restore the address input if available
        if (parsedFormData.address_line1) {
          setAddressInput(`${parsedFormData.address_line1}, ${parsedFormData.city}, ${parsedFormData.state} ${parsedFormData.zip}`);
        }
      } catch (error) {
        console.error('Error loading saved form data:', error);
      }
    }
  }

  async function loadPricingRules() {
    const { data, error } = await supabase
      .from('pricing_rules')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error loading pricing rules:', error);
      return;
    }

    if (data) {
      setPricingRules({
        base_radius_miles: parseFloat(data.base_radius_miles),
        included_city_list_json: data.included_city_list_json as string[],
        per_mile_after_base_cents: data.per_mile_after_base_cents,
        zone_overrides_json: data.zone_overrides_json as any[],
        surface_sandbag_fee_cents: data.surface_sandbag_fee_cents,
        residential_multiplier: parseFloat(data.residential_multiplier),
        commercial_multiplier: parseFloat(data.commercial_multiplier),
        same_day_matrix_json: data.same_day_matrix_json as any[],
        overnight_holiday_only: data.overnight_holiday_only,
        extra_day_pct: parseFloat(data.extra_day_pct),
      });
    }
  }

  async function checkCartAvailability() {
    if (!formData.event_date || !formData.event_end_date || cart.length === 0) return;

    const checks = cart.map(item => ({
      unitId: item.unit_id,
      eventStartDate: formData.event_date,
      eventEndDate: formData.event_end_date,
    }));

    const results = await checkMultipleUnitsAvailability(checks);

    const updatedCart = cart.map((item, index) => ({
      ...item,
      isAvailable: results[index]?.isAvailable ?? true,
    }));

    setCart(updatedCart);
    localStorage.setItem('bpc_cart', JSON.stringify(updatedCart));
  }

  async function calculatePricing() {
    if (!pricingRules) return;

    const distance_miles = await calculateDrivingDistance(
      HOME_BASE.lat,
      HOME_BASE.lng,
      formData.lat,
      formData.lng
    );

    const startDate = new Date(formData.event_date);
    const endDate = new Date(formData.event_end_date);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const num_days = Math.max(1, daysDiff + 1);

    const breakdown = calculatePrice({
      items: cart,
      location_type: formData.location_type,
      surface: formData.can_stake ? 'grass' : 'cement',
      can_use_stakes: formData.can_stake,
      overnight_allowed: formData.pickup_preference === 'next_day',
      num_days,
      distance_miles,
      city: formData.city,
      zip: formData.zip,
      has_generator: formData.has_generator,
      rules: pricingRules,
    });

    setPriceBreakdown(breakdown);
  }

  function updateCartItem(index: number, updates: Partial<CartItem>) {
    const newCart = [...cart];
    newCart[index] = { ...newCart[index], ...updates };
    setCart(newCart);
    localStorage.setItem('bpc_cart', JSON.stringify(newCart));
  }

  function removeFromCart(index: number) {
    const newCart = cart.filter((_, i) => i !== index);
    setCart(newCart);
    localStorage.setItem('bpc_cart', JSON.stringify(newCart));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (cart.length === 0) {
      alert('Please add at least one inflatable to your quote.');
      return;
    }

    const unavailableItems = cart.filter(item => item.isAvailable === false);
    if (unavailableItems.length > 0) {
      const unavailableNames = unavailableItems.map(item => item.unit_name).join(', ');
      alert(`The following inflatables are not available for your selected dates: ${unavailableNames}. Please choose different dates or remove these items.`);
      return;
    }

    if (formData.pickup_preference === 'same_day' && !formData.same_day_responsibility_accepted) {
      alert('Please accept the responsibility agreement for same-day pickup.');
      return;
    }

    await checkCartAvailability();

    const stillUnavailable = cart.filter(item => item.isAvailable === false);
    if (stillUnavailable.length > 0) {
      const unavailableNames = stillUnavailable.map(item => item.unit_name).join(', ');
      alert(`Sorry, the following inflatables were just booked by another customer: ${unavailableNames}. Please choose different dates or remove these items.`);
      return;
    }

    localStorage.setItem('bpc_quote_form', JSON.stringify(formData));
    localStorage.setItem('bpc_price_breakdown', JSON.stringify(priceBreakdown));
    navigate('/checkout');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold text-slate-900 mb-8">Your Cart & Quote</h1>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Your Cart</h2>
              {cart.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-600 mb-4">Your cart is empty</p>
                  <button
                    type="button"
                    onClick={() => navigate('/catalog')}
                    className="text-blue-600 hover:text-blue-700 font-semibold"
                  >
                    Browse Inflatables
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {cart.map((item, index) => (
                    <div
                      key={index}
                      className={`p-4 border rounded-lg space-y-3 ${
                        item.isAvailable === false
                          ? 'border-red-300 bg-red-50'
                          : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-slate-900">{item.unit_name}</h3>
                            {item.isAvailable === false && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                <XCircle className="w-3 h-3" />
                                Not Available
                              </span>
                            )}
                          </div>
                          <span className="text-sm text-slate-600">Qty: {item.qty}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFromCart(index)}
                          className="text-red-600 hover:text-red-700 ml-4"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>

                      {item.isAvailable === false && formData.event_date && (
                        <div className="text-sm text-red-700 bg-red-100 px-3 py-2 rounded">
                          This inflatable is already booked for the selected dates. Please choose different dates or remove this item.
                        </div>
                      )}

                      {item.is_combo && (
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-2">
                            Select Mode
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => updateCartItem(index, { wet_or_dry: 'dry' })}
                              className={`flex items-center justify-center p-2 rounded-lg border-2 transition-all text-sm ${
                                item.wet_or_dry === 'dry'
                                  ? 'border-blue-600 bg-blue-50 text-blue-900'
                                  : 'border-slate-300 text-slate-700 hover:border-blue-400'
                              }`}
                            >
                              <Sun className={`w-4 h-4 mr-1.5 ${
                                item.wet_or_dry === 'dry' ? 'text-blue-600' : 'text-slate-400'
                              }`} />
                              Dry Mode
                            </button>
                            <button
                              type="button"
                              onClick={() => updateCartItem(index, { wet_or_dry: 'water' })}
                              className={`flex items-center justify-center p-2 rounded-lg border-2 transition-all text-sm ${
                                item.wet_or_dry === 'water'
                                  ? 'border-blue-600 bg-blue-50 text-blue-900'
                                  : 'border-slate-300 text-slate-700 hover:border-blue-400'
                              }`}
                            >
                              <Droplets className={`w-4 h-4 mr-1.5 ${
                                item.wet_or_dry === 'water' ? 'text-blue-600' : 'text-slate-400'
                              }`} />
                              Water Mode
                            </button>
                          </div>
                        </div>
                      )}

                      {!item.is_combo && (
                        <div className="flex items-center text-sm text-slate-600">
                          {item.wet_or_dry === 'water' ? (
                            <>
                              <Droplets className="w-4 h-4 mr-1.5 text-blue-500" />
                              Water Mode
                            </>
                          ) : (
                            <>
                              <Sun className="w-4 h-4 mr-1.5 text-amber-500" />
                              Dry Mode
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => navigate('/catalog')}
                    className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-colors font-medium"
                  >
                    + Add More Inflatables
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
                <MapPin className="w-6 h-6 mr-2 text-blue-600" />
                Event Address
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Street Address *
                  </label>
                  <AddressAutocomplete
                    value={addressInput}
                    onSelect={(address) => {
                      setAddressInput(address.formatted_address);
                      setFormData({
                        ...formData,
                        address_line1: address.street,
                        city: address.city,
                        state: address.state,
                        zip: address.zip,
                        lat: address.lat,
                        lng: address.lng,
                      });
                    }}
                    placeholder="Enter event address"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Suite/Unit (Optional - for business locations only)
                  </label>
                  <input
                    type="text"
                    value={formData.address_line2}
                    onChange={(e) =>
                      setFormData({ ...formData, address_line2: e.target.value })
                    }
                    placeholder="Suite 100"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Note: We cannot deliver to apartments
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      City *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      State *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      ZIP Code *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.zip}
                      onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Event Details</h2>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-3">
                  Event Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, location_type: 'residential' })}
                    className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${
                      formData.location_type === 'residential'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <Home className={`w-8 h-8 mb-2 ${
                      formData.location_type === 'residential' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    <span className={`font-semibold ${
                      formData.location_type === 'residential' ? 'text-blue-900' : 'text-slate-700'
                    }`}>
                      Residential
                    </span>
                    <span className="text-xs text-slate-600 mt-1 text-center">
                      Home, backyard
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, location_type: 'commercial' })}
                    className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${
                      formData.location_type === 'commercial'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <Building2 className={`w-8 h-8 mb-2 ${
                      formData.location_type === 'commercial' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    <span className={`font-semibold ${
                      formData.location_type === 'commercial' ? 'text-blue-900' : 'text-slate-700'
                    }`}>
                      Commercial
                    </span>
                    <span className="text-xs text-slate-600 mt-1 text-center">
                      School, park, church
                    </span>
                  </button>
                </div>
              </div>

              {formData.location_type === 'residential' && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-700 mb-3">
                    When do you need pickup?
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, pickup_preference: 'next_day', same_day_responsibility_accepted: false })}
                      className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${
                        formData.pickup_preference === 'next_day'
                          ? 'border-green-600 bg-green-50'
                          : 'border-slate-300 hover:border-green-400'
                      }`}
                    >
                      <Clock className={`w-8 h-8 mb-2 ${
                        formData.pickup_preference === 'next_day' ? 'text-green-600' : 'text-slate-400'
                      }`} />
                      <span className={`font-semibold text-center ${
                        formData.pickup_preference === 'next_day' ? 'text-green-900' : 'text-slate-700'
                      }`}>
                        Next Morning
                      </span>
                      <span className="text-xs text-slate-600 mt-1 text-center">
                        Pickup 6 AM - 1:30 PM
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, pickup_preference: 'same_day' })}
                      className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${
                        formData.pickup_preference === 'same_day'
                          ? 'border-orange-600 bg-orange-50'
                          : 'border-slate-300 hover:border-orange-400'
                      }`}
                    >
                      <Clock className={`w-8 h-8 mb-2 ${
                        formData.pickup_preference === 'same_day' ? 'text-orange-600' : 'text-slate-400'
                      }`} />
                      <span className={`font-semibold text-center ${
                        formData.pickup_preference === 'same_day' ? 'text-orange-900' : 'text-slate-700'
                      }`}>
                        Same Day
                      </span>
                      <span className="text-xs text-slate-600 mt-1 text-center">
                        Additional fees apply
                      </span>
                    </button>
                  </div>
                  {formData.pickup_preference === 'next_day' && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs text-amber-900 font-medium">
                        ⚠️ Overnight Responsibility: You understand the inflatable will remain on your property overnight and you are legally responsible for its safety and security until pickup the next morning.
                      </p>
                    </div>
                  )}
                  {formData.pickup_preference === 'same_day' && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <label className="flex items-start cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.same_day_responsibility_accepted}
                          onChange={(e) =>
                            setFormData({ ...formData, same_day_responsibility_accepted: e.target.checked })
                          }
                          className="mt-0.5 mr-3"
                          required
                        />
                        <p className="text-xs text-amber-900 font-medium">
                          ⚠️ I understand I am legally responsible for the inflatable until Bounce Party Club picks it up this evening. *
                        </p>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {formData.location_type === 'residential' && (
                <div className="mb-6">
                  <div className="p-4 bg-slate-50 border border-slate-300 rounded-lg">
                    <label className="flex items-start cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.has_pets}
                        onChange={(e) => setFormData({ ...formData, has_pets: e.target.checked })}
                        className="mt-1 mr-3"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          We have pets at this location
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                          This helps our crew prepare for arrival and look out for pet waste or loose animals during setup.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {formData.location_type === 'commercial' && (
                <div className="mb-6">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-3">
                    <p className="text-sm text-blue-900">
                      <strong>Commercial events require same-day pickup by 7:00 PM.</strong> This ensures safety at parks, churches, schools, and other public locations.
                    </p>
                  </div>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <label className="flex items-start cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.same_day_responsibility_accepted}
                        onChange={(e) =>
                          setFormData({ ...formData, same_day_responsibility_accepted: e.target.checked })
                        }
                        className="mt-0.5 mr-3"
                        required
                      />
                      <p className="text-xs text-amber-900 font-medium">
                        ⚠️ I understand I am legally responsible for the inflatable until Bounce Party Club picks it up by 7:00 PM. *
                      </p>
                    </label>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Event Start Date *
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="date"
                      required
                      value={formData.event_date}
                      onChange={(e) => {
                        const newStartDate = e.target.value;
                        const oldStartDate = formData.event_date;
                        const oldEndDate = formData.event_end_date;

                        if (oldStartDate && oldEndDate && newStartDate) {
                          const oldStart = new Date(oldStartDate);
                          const oldEnd = new Date(oldEndDate);
                          const dayOffset = Math.round((oldEnd.getTime() - oldStart.getTime()) / (1000 * 60 * 60 * 24));

                          const newStart = new Date(newStartDate);
                          const newEnd = new Date(newStart);
                          newEnd.setDate(newEnd.getDate() + dayOffset);

                          setFormData({
                            ...formData,
                            event_date: newStartDate,
                            event_end_date: newEnd.toISOString().split('T')[0]
                          });
                        } else {
                          setFormData({ ...formData, event_date: newStartDate });
                        }
                      }}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Event End Date *
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="date"
                      required
                      value={formData.event_end_date}
                      onChange={(e) =>
                        setFormData({ ...formData, event_end_date: e.target.value })
                      }
                      min={formData.event_date || new Date().toISOString().split('T')[0]}
                      disabled={(formData.location_type === 'residential' && formData.pickup_preference === 'same_day') || formData.location_type === 'commercial'}
                      className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 disabled:bg-slate-100"
                    />
                    {((formData.location_type === 'residential' && formData.pickup_preference === 'same_day') || formData.location_type === 'commercial') && (
                      <p className="text-xs text-slate-500 mt-1">Same-day events cannot span multiple days</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Start Time *
                  </label>
                  <input
                    type="time"
                    required
                    value={formData.start_window}
                    onChange={(e) =>
                      setFormData({ ...formData, start_window: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    End Time *
                  </label>
                  <div className="space-y-2">
                    <input
                      type="time"
                      required={!formData.until_end_of_day}
                      disabled={formData.until_end_of_day}
                      value={formData.end_window}
                      onChange={(e) => {
                        let newTime = e.target.value;
                        const isSameDayRestricted = (formData.location_type === 'residential' && formData.pickup_preference === 'same_day') || formData.location_type === 'commercial';
                        if (isSameDayRestricted && newTime > '19:00') {
                          newTime = '19:00';
                        }
                        setFormData({ ...formData, end_window: newTime });
                      }}
                      max={(formData.location_type === 'residential' && formData.pickup_preference === 'same_day') || formData.location_type === 'commercial' ? '19:00' : undefined}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 disabled:bg-slate-100"
                    />
                    {((formData.location_type === 'residential' && formData.pickup_preference === 'same_day') || formData.location_type === 'commercial') && (
                      <p className="text-xs text-slate-500">Max 7:00 PM for same-day pickup</p>
                    )}
                    <label className="flex items-center text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={formData.until_end_of_day}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            until_end_of_day: e.target.checked,
                            end_window: e.target.checked ? '23:59' : formData.end_window,
                          })
                        }
                        disabled={(formData.location_type === 'residential' && formData.pickup_preference === 'same_day') || formData.location_type === 'commercial'}
                        className="mr-2 disabled:opacity-50"
                      />
                      <span className={(formData.location_type === 'residential' && formData.pickup_preference === 'same_day') || formData.location_type === 'commercial' ? 'opacity-50' : ''}>
                        Until end of day
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Setup Details</h2>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-3">
                  Can we anchor the inflatable with stakes? *
                </label>
                <div className="flex items-start gap-3 mb-4 p-3 bg-slate-50 rounded-lg">
                  <Anchor className="w-5 h-5 text-slate-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-600">
                    Stakes are driven into grass to secure the inflatable. If stakes cannot be used (cement surface, no grass, etc.), we'll provide sandbags which will be added to your quote.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, can_stake: true })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      formData.can_stake
                        ? 'border-green-600 bg-green-50'
                        : 'border-slate-300 hover:border-green-400'
                    }`}
                  >
                    <CheckCircle2 className={`w-8 h-8 mx-auto mb-2 ${
                      formData.can_stake ? 'text-green-600' : 'text-slate-400'
                    }`} />
                    <p className={`font-semibold text-center ${
                      formData.can_stake ? 'text-green-900' : 'text-slate-700'
                    }`}>
                      Yes
                    </p>
                    <p className="text-xs text-slate-600 text-center mt-1">
                      Grass surface available
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, can_stake: false })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      !formData.can_stake
                        ? 'border-orange-600 bg-orange-50'
                        : 'border-slate-300 hover:border-orange-400'
                    }`}
                  >
                    <AlertCircle className={`w-8 h-8 mx-auto mb-2 ${
                      !formData.can_stake ? 'text-orange-600' : 'text-slate-400'
                    }`} />
                    <p className={`font-semibold text-center ${
                      !formData.can_stake ? 'text-orange-900' : 'text-slate-700'
                    }`}>
                      No
                    </p>
                    <p className="text-xs text-slate-600 text-center mt-1">
                      Sandbags required
                    </p>
                  </button>
                </div>
              </div>

              <div className="p-6 bg-amber-50 border-2 border-amber-400 rounded-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Zap className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-amber-900">Power Source Required!</h3>
                    <p className="text-sm text-amber-800">Please verify electrical requirements</p>
                  </div>
                </div>
                <label className="flex items-start cursor-pointer p-4 bg-white rounded-lg border-2 border-amber-300 hover:border-amber-500 transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.has_generator}
                    onChange={(e) =>
                      setFormData({ ...formData, has_generator: e.target.checked })
                    }
                    className="mt-1 mr-4 w-5 h-5"
                  />
                  <div>
                    <p className="text-base font-bold text-slate-900 mb-2">
                      I need a generator (no power outlet available)
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      <strong>Check this box if:</strong> There is NO standard electrical outlet within 50 feet of the setup location. We'll provide a generator to power the inflatable blower. Each generator can power up to 2 blowers. <strong className="text-amber-800">Additional rental fees apply.</strong>
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-4">Special Details</h2>
              <p className="text-sm text-slate-600 mb-4">
                Tell us about your event! Is it a birthday party? Any special setup instructions? Special needs we should know about?
              </p>
              <textarea
                value={formData.special_details}
                onChange={(e) => setFormData({ ...formData, special_details: e.target.value })}
                rows={6}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
                placeholder="Example: It's my daughter's 8th birthday party! We're expecting about 20 kids. Please call 15 minutes before arrival so we can make sure the driveway is clear."
              />
              <p className="text-xs text-slate-500 mt-2">
                This information will be saved with your order and visible to our crew for better service.
              </p>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-md p-6 sticky top-24">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Quote Summary</h2>

              {cart.length === 0 ? (
                <p className="text-slate-600 text-center py-8">Add items to see your quote</p>
              ) : !priceBreakdown ? (
                <div className="text-center py-8">
                  <p className="text-slate-600">Complete event details to see pricing</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700 mb-3">Order Items:</p>

                    {cart.map((item, index) => (
                      <div key={index} className="text-sm text-slate-600 flex items-start">
                        <span className="text-blue-600 mr-2">•</span>
                        <span>{item.unit_name} ({item.wet_or_dry})</span>
                      </div>
                    ))}

                    {priceBreakdown.travel_fee_cents > 0 && (
                      <div className="text-sm text-slate-600 flex items-start mt-2">
                        <span className="text-blue-600 mr-2">•</span>
                        <span>Travel Fee</span>
                      </div>
                    )}

                    {priceBreakdown.surface_fee_cents > 0 && (
                      <div className="text-sm text-slate-600 flex items-start">
                        <span className="text-blue-600 mr-2">•</span>
                        <span>Sandbag Fee</span>
                      </div>
                    )}

                    {priceBreakdown.same_day_pickup_fee_cents > 0 && (
                      <div className="text-sm text-slate-600 flex items-start">
                        <span className="text-blue-600 mr-2">•</span>
                        <span>Same-Day Pickup Fee</span>
                      </div>
                    )}

                    {priceBreakdown.generator_fee_cents > 0 && (
                      <div className="text-sm text-slate-600 flex items-start">
                        <span className="text-blue-600 mr-2">•</span>
                        <span>Generator Rental ({Math.ceil(cart.reduce((sum, item) => sum + item.qty, 0) / 2)} unit{Math.ceil(cart.reduce((sum, item) => sum + item.qty, 0) / 2) > 1 ? 's' : ''})</span>
                      </div>
                    )}

                    {priceBreakdown.tax_cents > 0 && (
                      <div className="text-sm text-slate-600 flex items-start">
                        <span className="text-blue-600 mr-2">•</span>
                        <span>Tax (6%)</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-slate-200">
                    <p className="text-sm text-slate-500 italic text-center">Pricing will be shown on the checkout page</p>
                  </div>

                  {cart.some(item => item.isAvailable === false) && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800 font-medium text-center">
                        Some inflatables are not available for the selected dates. Please choose different dates or remove unavailable items.
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={cart.some(item => item.isAvailable === false)}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed disabled:hover:bg-slate-400"
                  >
                    Continue to Checkout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
