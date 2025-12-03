import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { CheckCircle, Loader2, CreditCard, Shield, AlertCircle } from 'lucide-react';

export function InvoiceAcceptance() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [invoiceLink, setInvoiceLink] = useState<any>(null);
  const [order, setOrder] = useState<any>(null);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [customerInfo, setCustomerInfo] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    business_name: '',
  });
  const [cardOnFileConsent, setCardOnFileConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadInvoiceData();
  }, [token]);

  async function loadInvoiceData() {
    try {
      // Get invoice link
      const { data: linkData, error: linkError } = await supabase
        .from('invoice_links')
        .select('*')
        .eq('link_token', token)
        .maybeSingle();

      if (linkError || !linkData) {
        setError('Invalid or expired invoice link');
        setLoading(false);
        return;
      }

      if (new Date(linkData.expires_at) < new Date()) {
        setError('This invoice link has expired');
        setLoading(false);
        return;
      }

      setInvoiceLink(linkData);

      // Get order details
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*, customers(*), addresses(*)')
        .eq('id', linkData.order_id)
        .single();

      if (orderError || !orderData) {
        setError('Order not found');
        setLoading(false);
        return;
      }

      setOrder(orderData);

      // Get order items
      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('*, units(*)')
        .eq('order_id', linkData.order_id);

      if (!itemsError && items) {
        setOrderItems(items);
      }

      // Pre-fill customer info if available
      if (orderData.customers) {
        setCustomerInfo({
          first_name: orderData.customers.first_name || '',
          last_name: orderData.customers.last_name || '',
          email: orderData.customers.email || '',
          phone: orderData.customers.phone || '',
          business_name: orderData.customers.business_name || '',
        });
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading invoice:', err);
      setError('Failed to load invoice');
      setLoading(false);
    }
  }

  async function handleAcceptInvoice() {
    if (!cardOnFileConsent || !smsConsent) {
      alert('Please accept both authorization and consent terms');
      return;
    }

    // If customer info not filled, require it
    if (!invoiceLink.customer_filled && (!customerInfo.first_name || !customerInfo.last_name || !customerInfo.email || !customerInfo.phone)) {
      alert('Please fill in all required customer information');
      return;
    }

    setProcessing(true);

    try {
      // If customer info was provided and not already in DB, create customer
      let customerId = order.customer_id;

      if (!invoiceLink.customer_filled && customerInfo.email) {
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert([customerInfo])
          .select()
          .single();

        if (customerError) throw customerError;
        customerId = newCustomer.id;

        // Update order with customer ID
        await supabase
          .from('orders')
          .update({
            customer_id: customerId,
            card_on_file_consent: cardOnFileConsent,
            sms_consent: smsConsent,
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        // Mark invoice link as customer filled
        await supabase
          .from('invoice_links')
          .update({ customer_filled: true })
          .eq('id', invoiceLink.id);
      } else {
        // Just update consent flags
        await supabase
          .from('orders')
          .update({
            card_on_file_consent: cardOnFileConsent,
            sms_consent: smsConsent,
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);
      }

      // If deposit is $0, just mark as accepted
      if (invoiceLink.deposit_cents === 0) {
        await supabase
          .from('orders')
          .update({
            status: 'awaiting_customer_approval',
          })
          .eq('id', order.id);

        alert('Invoice accepted! You will receive a confirmation shortly.');
        navigate('/');
        return;
      }

      // Otherwise, proceed to payment
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId: order.id,
            depositCents: invoiceLink.deposit_cents,
            tipCents: 0,
            customerEmail: customerInfo.email,
            customerName: `${customerInfo.first_name} ${customerInfo.last_name}`,
            origin: window.location.origin,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe
      window.location.href = data.url;
    } catch (err: any) {
      console.error('Error accepting invoice:', err);
      alert('Failed to process invoice: ' + err.message);
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8 text-center">
          <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Invalid Invoice Link</h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-8 mb-6">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Invoice from Bounce Party Club</h1>
            <p className="text-slate-600">Review and accept your order details below</p>
          </div>

          <div className="mb-8 p-6 bg-slate-50 rounded-lg">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Event Details</h2>
            <div className="space-y-2 text-sm">
              <p><strong>Date:</strong> {order.event_date}</p>
              <p><strong>Time:</strong> {order.start_window} - {order.end_window}</p>
              <p><strong>Location:</strong> {order.addresses?.line1}, {order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}</p>
              <p><strong>Location Type:</strong> <span className="capitalize">{order.location_type}</span></p>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Order Items</h2>
            <div className="space-y-3">
              {orderItems.map((item) => (
                <div key={item.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-lg">
                  <div>
                    <p className="font-medium text-slate-900">{item.units?.name}</p>
                    <p className="text-sm text-slate-600 capitalize">
                      {item.wet_or_dry === 'water' ? 'Water Mode' : 'Dry Mode'} × {item.qty}
                    </p>
                  </div>
                  <p className="font-semibold text-slate-900">
                    {formatCurrency(item.unit_price_cents * item.qty)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Invoice Summary</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Subtotal:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(order.subtotal_cents)}</span>
              </div>
              {order.discount_cents > 0 && (
                <div className="flex justify-between text-sm text-red-700">
                  <span>Discount:</span>
                  <span className="font-semibold">-{formatCurrency(order.discount_cents)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Tax (6%):</span>
                <span className="font-semibold text-slate-900">{formatCurrency(order.tax_cents)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-blue-300">
                <span className="font-bold text-slate-900">Total:</span>
                <span className="text-xl font-bold text-slate-900">{formatCurrency(order.total_cents)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-blue-300">
                <span className="text-slate-600">
                  {invoiceLink.deposit_cents === 0 ? 'Payment Required:' : 'Deposit Due Today:'}
                </span>
                <span className="text-lg font-bold text-blue-600">
                  {formatCurrency(invoiceLink.deposit_cents)}
                </span>
              </div>
              {invoiceLink.deposit_cents > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Balance Due at Event:</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(order.total_cents - invoiceLink.deposit_cents)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {!invoiceLink.customer_filled && (
            <div className="mb-8">
              <h2 className="text-xl font-bold text-slate-900 mb-4">Your Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">First Name *</label>
                  <input
                    type="text"
                    required
                    value={customerInfo.first_name}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, first_name: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={customerInfo.last_name}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, last_name: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Email *</label>
                  <input
                    type="email"
                    required
                    value={customerInfo.email}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Phone *</label>
                  <input
                    type="tel"
                    required
                    value={customerInfo.phone}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                    placeholder="(313) 555-0123"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Business Name (Optional)</label>
                  <input
                    type="text"
                    value={customerInfo.business_name}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, business_name: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="mb-8 space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-900 mb-2 flex items-center">
                <Shield className="w-5 h-5 mr-2 text-green-600" />
                Card-on-File Authorization
              </h3>
              <p className="text-sm text-slate-700 mb-3">
                I authorize Bounce Party Club LLC to securely store my payment method and charge it for incidentals including damage, excess cleaning, or late fees as itemized in a receipt. I understand that any charges will be accompanied by photographic evidence and a detailed explanation.
              </p>
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={cardOnFileConsent}
                  onChange={(e) => setCardOnFileConsent(e.target.checked)}
                  className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                  required
                />
                <span className="ml-3 text-sm text-slate-700">
                  I have read and agree to the card-on-file authorization terms above. *
                </span>
              </label>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-900 mb-2">SMS Notifications Consent</h3>
              <p className="text-sm text-slate-700 mb-3">
                By providing my phone number and checking the box below, I consent to receive transactional SMS text messages from Bounce Party Club LLC at the phone number provided. These messages may include order confirmations, delivery updates, and service-related notifications about my booking. Message frequency varies. Message and data rates may apply. You can reply STOP to opt-out at any time.
              </p>
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                  required
                />
                <span className="ml-3 text-sm text-slate-700">
                  I consent to receive SMS notifications about my booking and agree to the terms above. *
                </span>
              </label>
            </div>
          </div>

          <button
            onClick={handleAcceptInvoice}
            disabled={processing || !cardOnFileConsent || !smsConsent}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center"
          >
            {processing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : invoiceLink.deposit_cents === 0 ? (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Accept Invoice
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5 mr-2" />
                Accept & Pay {formatCurrency(invoiceLink.deposit_cents)}
              </>
            )}
          </button>

          <p className="text-xs text-slate-500 text-center mt-4">
            {invoiceLink.deposit_cents === 0
              ? 'By accepting, you acknowledge the order details above'
              : 'Your payment information is secured with industry-standard encryption'}
          </p>
        </div>
      </div>
    </div>
  );
}
