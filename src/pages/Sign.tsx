import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FileCheck, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import SignaturePad from '../components/SignaturePad';
import WaiverViewer from '../components/WaiverViewer';
import {
  WAIVER_TEXT,
  WAIVER_VERSION,
  INITIALS_REQUIRED,
  ELECTRONIC_CONSENT_TEXT,
} from '../lib/waiverContent';

interface OrderData {
  id: string;
  customer_id: string;
  start_date: string;
  end_date: string | null;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  address: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    zip: string;
  };
  waiver_signed_at: string | null;
  signed_waiver_url: string | null;
}

export default function Sign() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderData | null>(null);

  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [initials, setInitials] = useState<Record<string, string>>({});
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [electronicConsent, setElectronicConsent] = useState(false);

  // Renter Information State
  const [renterName, setRenterName] = useState('');
  const [renterPhone, setRenterPhone] = useState('');
  const [renterEmail, setRenterEmail] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [eventAddressLine1, setEventAddressLine1] = useState('');
  const [eventAddressLine2, setEventAddressLine2] = useState('');
  const [eventCity, setEventCity] = useState('');
  const [eventState, setEventState] = useState('');
  const [eventZip, setEventZip] = useState('');
  const [homeAddressLine1, setHomeAddressLine1] = useState('');
  const [homeAddressLine2, setHomeAddressLine2] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [homeState, setHomeState] = useState('');
  const [homeZip, setHomeZip] = useState('');
  const [sameAsEventAddress, setSameAsEventAddress] = useState(false);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  const loadOrder = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: orderError } = await supabase
        .from('orders')
        .select(`
          id,
          customer_id,
          start_date,
          end_date,
          waiver_signed_at,
          signed_waiver_url,
          customer:customers(*),
          address:addresses(*)
        `)
        .eq('id', orderId!)
        .single();

      if (orderError) throw orderError;
      if (!data) throw new Error('Order not found');

      if (data.waiver_signed_at && data.signed_waiver_url) {
        setError('This waiver has already been signed.');
      }

      setOrder(data as unknown as OrderData);

      // Auto-fill typed name and renter information from order
      const customer = data.customer as any;
      const fullName = `${customer.first_name} ${customer.last_name}`;
      setTypedName(fullName);
      setRenterName(fullName);
      setRenterPhone(customer.phone || '');
      setRenterEmail(customer.email || '');
      setEventDate(data.start_date || '');
      setEventEndDate(data.end_date || '');

      // Auto-fill address from related address record
      const address = data.address as any;
      if (address) {
        setEventAddressLine1(address.line1 || '');
        setEventAddressLine2(address.line2 || '');
        setEventCity(address.city || '');
        setEventState(address.state || '');
        setEventZip(address.zip || '');
      }
    } catch (err: any) {
      console.error('Error loading order:', err);
      setError(err.message || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  const handleInitialsChange = (section: string, value: string) => {
    setInitials((prev) => ({ ...prev, [section]: value }));
  };

  const isFormValid = () => {
    if (!hasScrolledToBottom) return false;
    if (!renterName.trim()) return false;
    if (!renterPhone.trim()) return false;
    if (!renterEmail.trim()) return false;
    if (!eventDate) return false;
    if (!eventAddressLine1.trim()) return false;
    if (!eventCity.trim()) return false;
    if (!eventState.trim()) return false;
    if (!eventZip.trim()) return false;
    if (!typedName.trim()) return false;
    if (!signatureDataUrl) return false;
    if (!electronicConsent) return false;

    const allInitialsProvided = INITIALS_REQUIRED.every(
      (section) => initials[section]?.trim().length >= 2
    );
    if (!allInitialsProvided) return false;

    return true;
  };

  const scrollToFirstIncomplete = () => {
    const elements = [
      { condition: !hasScrolledToBottom, id: 'waiver-section' },
      { condition: !renterName.trim(), id: 'renter-name' },
      { condition: !renterPhone.trim(), id: 'renter-phone' },
      { condition: !renterEmail.trim(), id: 'renter-email' },
      { condition: !eventDate, id: 'event-date' },
      { condition: !eventAddressLine1.trim(), id: 'event-address-line1' },
      { condition: !eventCity.trim(), id: 'event-city' },
      { condition: !eventState.trim(), id: 'event-state' },
      { condition: !eventZip.trim(), id: 'event-zip' },
      { condition: !INITIALS_REQUIRED.every((s) => initials[s]?.trim().length >= 2), id: 'waiver-section' },
      { condition: !typedName.trim(), id: 'typed-name' },
      { condition: !signatureDataUrl, id: 'signature-pad' },
      { condition: !electronicConsent, id: 'electronic-consent' },
    ];

    const firstIncomplete = elements.find((el) => el.condition);
    if (firstIncomplete) {
      const element = document.getElementById(firstIncomplete.id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.focus();
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid() || !order) {
      scrollToFirstIncomplete();
      setError('Please complete all required fields');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-signature`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId: order.id,
            customerId: order.customer_id,
            // Renter information snapshot
            renterName,
            renterPhone,
            renterEmail,
            eventDate,
            eventEndDate: eventEndDate || null,
            eventAddressLine1,
            eventAddressLine2: eventAddressLine2 || '',
            eventCity,
            eventState,
            eventZip,
            homeAddressLine1: homeAddressLine1 || '',
            homeAddressLine2: homeAddressLine2 || '',
            homeCity: homeCity || '',
            homeState: homeState || '',
            homeZip: homeZip || '',
            // Signature artifacts
            signatureDataUrl,
            initialsData: initials,
            typedName,
            waiverVersion: WAIVER_VERSION,
            waiverText: WAIVER_TEXT,
            electronicConsentText: ELECTRONIC_CONSENT_TEXT,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save signature');
      }

      navigate(`/customer-portal?signatureComplete=true`);
    } catch (err: any) {
      console.error('Error submitting signature:', err);
      setError(err.message || 'Failed to submit signature');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading waiver...</p>
        </div>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Unable to Load Waiver</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/customer-portal')}
            className="w-full bg-blue-600 text-white rounded-lg px-6 py-3 font-semibold hover:bg-blue-700"
          >
            Return to Portal
          </button>
        </div>
      </div>
    );
  }

  if (order?.waiver_signed_at) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <FileCheck className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Already Signed</h2>
          <p className="text-gray-600 mb-6">
            This waiver was signed on {new Date(order.waiver_signed_at).toLocaleDateString()}.
          </p>
          <button
            onClick={() => navigate('/customer-portal')}
            className="w-full bg-blue-600 text-white rounded-lg px-6 py-3 font-semibold hover:bg-blue-700"
          >
            Return to Portal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl overflow-hidden">
          <Link to="/" className="block bg-white px-8 py-4 border-b border-gray-200 hover:bg-gray-50 transition-colors">
            <img
              src="/bounce party club logo.png"
              alt="Bounce Party Club"
              className="h-16 object-contain"
            />
          </Link>
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6">
            <h1 className="text-3xl font-bold text-white mb-2">Electronic Waiver Signature</h1>
            <p className="text-blue-100">
              Please review and sign the liability waiver for your rental
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-8">
            <div id="waiver-section">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                1. Review Liability Waiver
              </h3>
              <WaiverViewer
                waiverText={WAIVER_TEXT}
                onScrollToBottom={setHasScrolledToBottom}
                initialsRequired={INITIALS_REQUIRED}
                onInitialsChange={handleInitialsChange}
                initials={initials}
              />
            </div>

            <div className="border-t-2 border-gray-200 pt-8">
              <h3 className="text-xl font-semibold text-gray-900 mb-6">
                2. Renter Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name *
                  </label>
                  <input
                    id="renter-name"
                    type="text"
                    value={renterName}
                    onChange={(e) => setRenterName(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="John Doe"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone *
                  </label>
                  <input
                    id="renter-phone"
                    type="tel"
                    value={renterPhone}
                    onChange={(e) => setRenterPhone(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="(313) 555-0123"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email *
                  </label>
                  <input
                    id="renter-email"
                    type="email"
                    value={renterEmail}
                    onChange={(e) => setRenterEmail(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="john@example.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rental Date *
                  </label>
                  <input
                    id="event-date"
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rental End Date
                  </label>
                  <input
                    id="event-end-date"
                    type="date"
                    value={eventEndDate}
                    onChange={(e) => setEventEndDate(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="md:col-span-2">
                  <h4 className="font-semibold text-gray-900 mb-3">Address of Event *</h4>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Street Address *
                  </label>
                  <input
                    id="event-address-line1"
                    type="text"
                    value={eventAddressLine1}
                    onChange={(e) => setEventAddressLine1(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="123 Main St"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Apt, Suite, etc. (optional)
                  </label>
                  <input
                    id="event-address-line2"
                    type="text"
                    value={eventAddressLine2}
                    onChange={(e) => setEventAddressLine2(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Apt 4B"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    City *
                  </label>
                  <input
                    id="event-city"
                    type="text"
                    value={eventCity}
                    onChange={(e) => setEventCity(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Wayne"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    State *
                  </label>
                  <input
                    id="event-state"
                    type="text"
                    value={eventState}
                    onChange={(e) => setEventState(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="MI"
                    maxLength={2}
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ZIP Code *
                  </label>
                  <input
                    id="event-zip"
                    type="text"
                    value={eventZip}
                    onChange={(e) => setEventZip(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="48184"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <h4 className="font-semibold text-gray-900 mb-3 mt-4">
                    Home Address (if different from event address)
                  </h4>
                  <label className="flex items-center gap-2 cursor-pointer mb-4">
                    <input
                      type="checkbox"
                      checked={sameAsEventAddress}
                      onChange={(e) => {
                        setSameAsEventAddress(e.target.checked);
                        if (e.target.checked) {
                          setHomeAddressLine1('');
                          setHomeAddressLine2('');
                          setHomeCity('');
                          setHomeState('');
                          setHomeZip('');
                        }
                      }}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Same as event address</span>
                  </label>
                </div>

                {!sameAsEventAddress && (
                  <>
                    <div className="md:col-span-2">
                      <input
                        id="home-address-line1"
                        type="text"
                        value={homeAddressLine1}
                        onChange={(e) => setHomeAddressLine1(e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Street Address"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <input
                        id="home-address-line2"
                        type="text"
                        value={homeAddressLine2}
                        onChange={(e) => setHomeAddressLine2(e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Apt, Suite, etc."
                      />
                    </div>

                    <div>
                      <input
                        id="home-city"
                        type="text"
                        value={homeCity}
                        onChange={(e) => setHomeCity(e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="City"
                      />
                    </div>

                    <div>
                      <input
                        id="home-state"
                        type="text"
                        value={homeState}
                        onChange={(e) => setHomeState(e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="State"
                        maxLength={2}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <input
                        id="home-zip"
                        type="text"
                        value={homeZip}
                        onChange={(e) => setHomeZip(e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="ZIP Code"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="border-t-2 border-gray-200 pt-8">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                3. Enter Your Full Legal Name
              </h3>
              <input
                id="typed-name"
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="John Doe"
                required
              />
              <p className="text-sm text-gray-600 mt-2">
                This must match your legal name as it appears on your ID
              </p>
            </div>

            <div className="border-t-2 border-gray-200 pt-8">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                4. Draw Your Signature
              </h3>
              <div id="signature-pad">
                <SignaturePad
                  onSignatureChange={setSignatureDataUrl}
                  disabled={submitting}
                />
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Draw your signature using your mouse, touchpad, or touch screen
              </p>
            </div>

            <div className="border-t-2 border-gray-200 pt-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <label id="electronic-consent" className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={electronicConsent}
                    onChange={(e) => setElectronicConsent(e.target.checked)}
                    className="mt-1 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-900 mb-1">
                      Electronic Signature Consent
                    </p>
                    <p className="text-sm text-gray-700">{ELECTRONIC_CONSENT_TEXT}</p>
                  </div>
                </label>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-1 bg-gray-200 text-gray-700 rounded-lg px-6 py-4 font-semibold hover:bg-gray-300 transition-colors"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg px-6 py-4 font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <FileCheck className="w-5 h-5" />
                    Sign Waiver
                  </>
                )}
              </button>
            </div>

            <p className="text-xs text-gray-500 text-center">
              By clicking "Sign Waiver", you acknowledge that you have read and understood the
              entire waiver, and your electronic signature is legally binding.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
