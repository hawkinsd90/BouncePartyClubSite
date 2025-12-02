import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
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

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  const loadOrder = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: orderError } = await supabase
        .from('orders')
        .select('id, customer_id, waiver_signed_at, signed_waiver_url, customer:customers(*)')
        .eq('id', orderId!)
        .single();

      if (orderError) throw orderError;
      if (!data) throw new Error('Order not found');

      if (data.waiver_signed_at && data.signed_waiver_url) {
        setError('This waiver has already been signed.');
      }

      setOrder(data as unknown as OrderData);
      setTypedName(`${data.customer.first_name} ${data.customer.last_name}`);
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
    if (!typedName.trim()) return false;
    if (!signatureDataUrl) return false;
    if (!electronicConsent) return false;

    const allInitialsProvided = INITIALS_REQUIRED.every(
      (section) => initials[section]?.trim().length >= 2
    );
    if (!allInitialsProvided) return false;

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid() || !order) {
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
            signerName: typedName,
            signerEmail: order.customer.email,
            signerPhone: order.customer.phone,
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
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6">
            <h1 className="text-3xl font-bold text-white mb-2">Electronic Waiver Signature</h1>
            <p className="text-blue-100">
              Please review and sign the liability waiver for your rental
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-8">
            <div>
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

            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                2. Enter Your Full Legal Name
              </h3>
              <input
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

            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                3. Draw Your Signature
              </h3>
              <SignaturePad
                onSignatureChange={setSignatureDataUrl}
                disabled={submitting}
              />
              <p className="text-sm text-gray-600 mt-2">
                Draw your signature using your mouse, touchpad, or touch screen
              </p>
            </div>

            <div className="border-t-2 border-gray-200 pt-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <label className="flex items-start gap-3 cursor-pointer">
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
                onClick={() => navigate('/customer-portal')}
                className="flex-1 bg-gray-200 text-gray-700 rounded-lg px-6 py-4 font-semibold hover:bg-gray-300 transition-colors"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isFormValid() || submitting}
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
