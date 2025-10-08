import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { Package, DollarSign, FileText, Download, CreditCard as Edit2, Trash2, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { ContactsList } from '../components/ContactsList';
import { InvoicesList } from '../components/InvoicesList';
import { PaymentManagement } from '../components/PaymentManagement';
import { OrdersManager } from '../components/OrdersManager';
import { InvoiceBuilder } from '../components/InvoiceBuilder';

function PendingOrderCard({ order, onUpdate }: { order: any; onUpdate: () => void }) {
  const [processing, setProcessing] = useState(false);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [streetViewLoaded, setStreetViewLoaded] = useState(false);
  const [streetViewError, setStreetViewError] = useState(false);
  const [smsConversations, setSmsConversations] = useState<any[]>([]);
  const [showSmsReply, setShowSmsReply] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [sendingSms, setSendingSms] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [customRejectionReason, setCustomRejectionReason] = useState('');
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => {
    loadOrderItems();
    loadSmsConversations();
    loadPayments();
  }, [order.id]);

  async function loadOrderItems() {
    const { data } = await supabase
      .from('order_items')
      .select('*, units(name)')
      .eq('order_id', order.id);
    if (data) setOrderItems(data);
  }

  async function loadSmsConversations() {
    const { data } = await supabase
      .from('sms_conversations')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at', { ascending: true });
    if (data) setSmsConversations(data);
  }

  async function loadPayments() {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false });
    if (data) setPayments(data);
  }

  async function handlePaymentRefresh() {
    await loadPayments();
    await onUpdate();
  }

  async function handleSendSms(customMessage?: string) {
    const messageToSend = customMessage || replyMessage;
    if (!messageToSend.trim()) return;

    setSendingSms(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: order.customers?.phone,
          message: messageToSend,
          orderId: order.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error || 'Failed to send SMS';
        throw new Error(errorMsg);
      }

      setReplyMessage('');
      setShowSmsReply(false);
      await loadSmsConversations();
      alert('SMS sent successfully!');
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      const errorMessage = error.message || 'Failed to send SMS. Please try again.';

      if (errorMessage.includes('Twilio not configured')) {
        alert('SMS cannot be sent: Twilio credentials are not configured. Please add your Twilio credentials in the Settings tab first.');
      } else if (errorMessage.includes('Incomplete Twilio configuration')) {
        alert('SMS cannot be sent: Twilio configuration is incomplete. Please check your Settings.');
      } else {
        alert(`Failed to send SMS: ${errorMessage}`);
      }
    } finally {
      setSendingSms(false);
    }
  }

  async function handleTestSms() {
    const testMessage = `Hi ${order.customers?.first_name}, this is a test message from Bounce Party Club. Your order #${order.id.slice(0, 8).toUpperCase()} is confirmed!`;
    await handleSendSms(testMessage);
  }

  const getStreetViewUrl = (heading: number = 0) => {
    const address = `${order.addresses?.line1}, ${order.addresses?.city}, ${order.addresses?.state} ${order.addresses?.zip}`;
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    return `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${encodeURIComponent(address)}&heading=${heading}&key=${apiKey}`;
  };

  const streetViewAngles = [
    { heading: 0, label: 'North View' },
    { heading: 90, label: 'East View' },
    { heading: 180, label: 'South View' },
    { heading: 270, label: 'West View' },
  ];

  async function handleApprove() {
    if (!confirm('Approve this booking? Payment will be processed and customer will be notified.')) return;

    setProcessing(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'confirmed',
          deposit_paid_cents: order.deposit_due_cents
        })
        .eq('id', order.id);

      if (error) throw error;

      await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('order_id', order.id)
        .eq('status', 'pending');

      // Generate invoice
      const { data: invoiceNumberData } = await supabase.rpc('generate_invoice_number');
      const invoiceNumber = invoiceNumberData || `INV-${Date.now()}`;

      const totalCents = order.subtotal_cents + order.travel_fee_cents +
                        order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents;

      await supabase.from('invoices').insert({
        invoice_number: invoiceNumber,
        order_id: order.id,
        customer_id: order.customer_id,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: order.event_date,
        status: 'sent',
        subtotal_cents: order.subtotal_cents,
        tax_cents: order.tax_cents,
        travel_fee_cents: order.travel_fee_cents,
        surface_fee_cents: order.surface_fee_cents,
        same_day_pickup_fee_cents: order.same_day_pickup_fee_cents,
        total_cents: totalCents,
        paid_amount_cents: order.deposit_paid_cents || 0,
        payment_method: 'card',
      });

      alert('Booking approved! Invoice generated. Customer will receive confirmation.');
      onUpdate();
    } catch (error) {
      console.error('Error approving order:', error);
      alert('Error approving order. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleReject(reason?: string) {
    if (!reason) {
      setShowRejectionModal(true);
      return;
    }

    setProcessing(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', order.id);

      if (error) throw error;

      await supabase
        .from('payments')
        .update({ status: 'cancelled' })
        .eq('order_id', order.id)
        .eq('status', 'pending');

      const rejectionMessage = `Hi ${order.customers?.first_name}, unfortunately we cannot accommodate your booking for ${format(new Date(order.event_date), 'MMMM d, yyyy')}. Reason: ${reason}. Please contact us if you have questions.`;

      await handleSendSms(rejectionMessage);

      setShowRejectionModal(false);
      setCustomRejectionReason('');
      alert('Booking rejected and customer notified via SMS.');
      onUpdate();
    } catch (error) {
      console.error('Error rejecting order:', error);
      alert('Error rejecting order. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  const preGeneratedRejections = [
    'Units not available for selected date',
    'Location outside service area',
    'Weather conditions unsafe for event',
    'Insufficient setup space at location',
    'Unable to verify venue permissions',
    'Event date conflicts with existing booking',
  ];

  return (
    <div className="border border-slate-200 rounded-lg p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            {order.customers?.first_name} {order.customers?.last_name}
          </h3>
          <p className="text-sm text-slate-600">{order.customers?.email}</p>
          <p className="text-sm text-slate-600">{order.customers?.phone}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-600">Order ID</p>
          <p className="font-mono text-sm font-semibold">{order.id.slice(0, 8).toUpperCase()}</p>
          <p className="text-xs text-slate-500 mt-1">
            {format(new Date(order.created_at), 'MMM d, yyyy h:mm a')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 p-4 bg-slate-50 rounded-lg">
        <div>
          <p className="text-sm font-medium text-slate-700">Event Date & Time</p>
          <p className="text-slate-900">{format(new Date(order.event_date), 'EEEE, MMMM d, yyyy')}</p>
          <p className="text-slate-600 text-sm">{order.start_window} - {order.end_window}</p>
          {order.end_date && order.end_date !== order.event_date && (
            <p className="text-slate-600 text-sm mt-1">Ends: {format(new Date(order.end_date), 'MMM d, yyyy')}</p>
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">Event Location</p>
          <p className="text-slate-900">{order.addresses?.line1}</p>
          <p className="text-slate-600 text-sm">{order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}</p>
          <p className="text-slate-600 text-sm capitalize mt-1">{order.location_type} • {order.surface}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="p-3 bg-white border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-600 mb-1">Generator</p>
          <p className="text-sm font-semibold text-slate-900">{order.generator_selected ? 'Yes' : 'No'}</p>
        </div>
        <div className="p-3 bg-white border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-600 mb-1">Sandbags</p>
          <p className="text-sm font-semibold text-slate-900">{!order.can_use_stakes ? 'Required' : 'Not Needed'}</p>
        </div>
        <div className="p-3 bg-white border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-600 mb-1">Pickup</p>
          <p className="text-sm font-semibold text-slate-900">{order.overnight_allowed ? 'Next Day' : 'Same Day'}</p>
        </div>
        <div className="p-3 bg-white border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-600 mb-1">Pets</p>
          <p className="text-sm font-semibold text-slate-900">{order.has_pets ? 'Yes' : 'No'}</p>
        </div>
      </div>

      {order.special_details && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm font-medium text-slate-700 mb-2">Special Details from Customer</p>
          <p className="text-slate-900 whitespace-pre-wrap">{order.special_details}</p>
        </div>
      )}

      {import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
        <div className="mb-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
            <p className="text-sm font-medium text-slate-700">Street View Assessment - Multiple Angles</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            {streetViewAngles.map(({ heading, label }) => (
              <div key={heading} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-200">
                  <p className="text-xs font-medium text-slate-700">{label}</p>
                </div>
                <div className="relative">
                  {!streetViewError ? (
                    <img
                      src={getStreetViewUrl(heading)}
                      alt={label}
                      className="w-full h-48 object-cover"
                      onError={() => setStreetViewError(true)}
                    />
                  ) : (
                    <div className="w-full h-48 bg-slate-100 flex items-center justify-center">
                      <p className="text-slate-500 text-xs">Not available</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="bg-slate-50 px-4 py-2 border-t border-slate-200 text-xs text-slate-600">
            Note: Street View images may not reflect current conditions. Verify details during delivery.
          </div>
        </div>
      )}

      <div className="mb-4 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
          <p className="text-sm font-medium text-slate-700">Complete Order Details</p>
        </div>
        <div className="p-4">
          <div className="space-y-3">
            {orderItems.map((item) => (
              <div key={item.id} className="flex justify-between items-start pb-3 border-b border-slate-100 last:border-0 last:pb-0">
                <div>
                  <p className="font-medium text-slate-900">{item.units?.name}</p>
                  <p className="text-sm text-slate-600">{item.wet_or_dry === 'water' ? 'Water Mode' : 'Dry Mode'} • Qty: {item.qty}</p>
                </div>
                <p className="font-semibold text-slate-900">{formatCurrency(item.unit_price_cents * item.qty)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Subtotal:</span>
              <span className="font-semibold text-slate-900">{formatCurrency(order.subtotal_cents)}</span>
            </div>
            {order.travel_fee_cents > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 font-semibold">Travel Fee:</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(order.travel_fee_cents)}</span>
                </div>
                {order.travel_total_miles != null && order.travel_base_radius_miles != null ? (
                  order.travel_is_flat_fee ? (
                    <div className="ml-4 text-xs text-slate-500">
                      Flat zone rate for {order.addresses?.zip}
                    </div>
                  ) : (
                    <div className="ml-4 text-xs text-slate-500 space-y-0.5">
                      <div>Total distance: {Number(order.travel_total_miles).toFixed(1)} miles</div>
                      <div>Free zone: {Number(order.travel_base_radius_miles).toFixed(1)} miles</div>
                      <div>Charged miles: {Number(order.travel_chargeable_miles || 0).toFixed(1)} miles × {formatCurrency(order.travel_per_mile_cents || 0)}/mile</div>
                    </div>
                  )
                ) : (
                  <div className="ml-4 text-xs text-slate-500">
                    (breakdown not available for older orders)
                  </div>
                )}
              </div>
            )}
            {order.surface_fee_cents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Surface Fee (Sandbags):</span>
                <span className="font-semibold text-slate-900">{formatCurrency(order.surface_fee_cents)}</span>
              </div>
            )}
            {order.same_day_pickup_fee_cents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Same Day Pickup Fee:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(order.same_day_pickup_fee_cents)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Tax:</span>
              <span className="font-semibold text-slate-900">{formatCurrency(order.tax_cents)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-slate-600 mb-1">Total Order Amount</p>
          <p className="text-2xl font-bold text-slate-900">
            {formatCurrency(order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents)}
          </p>
        </div>
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-slate-600 mb-1">Customer Plans to Pay</p>
          <p className="text-2xl font-bold text-green-700">
            {formatCurrency(order.deposit_due_cents)}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Balance Due: {formatCurrency(order.balance_due_cents)}
          </p>
        </div>
      </div>

      {smsConversations.length > 0 && (
        <div className="mb-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
            <p className="text-sm font-medium text-slate-700">SMS Conversation</p>
          </div>
          <div className="max-h-64 overflow-y-auto p-4 space-y-3">
            {smsConversations.map((sms) => (
              <div
                key={sms.id}
                className={`flex ${sms.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs px-4 py-2 rounded-lg ${
                    sms.direction === 'outbound'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 text-slate-900'
                  }`}
                >
                  <p className="text-sm">{sms.message_body}</p>
                  <p className={`text-xs mt-1 ${sms.direction === 'outbound' ? 'text-blue-100' : 'text-slate-500'}`}>
                    {format(new Date(sms.created_at), 'MMM d, h:mm a')}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200 p-3">
            {!showSmsReply ? (
              <button
                onClick={() => setShowSmsReply(true)}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                Reply via SMS
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder="Type your message..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSendSms}
                    disabled={sendingSms || !replyMessage.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    {sendingSms ? 'Sending...' : 'Send SMS'}
                  </button>
                  <button
                    onClick={() => {
                      setShowSmsReply(false);
                      setReplyMessage('');
                    }}
                    className="text-slate-600 hover:text-slate-700 px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mb-4">
        <PaymentManagement order={order} payments={payments} onRefresh={handlePaymentRefresh} />
      </div>

      <div className="flex gap-3 mb-3">
        <button
          onClick={handleTestSms}
          disabled={sendingSms}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          {sendingSms ? 'Sending...' : 'Send Test SMS'}
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleApprove}
          disabled={processing}
          className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          {processing ? 'Processing...' : 'Approve & Process Payment'}
        </button>
        <button
          onClick={() => handleReject()}
          disabled={processing}
          className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          {processing ? 'Processing...' : 'Reject Booking'}
        </button>
      </div>

      {showRejectionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Select Rejection Reason</h3>
            <div className="space-y-2 mb-4">
              {preGeneratedRejections.map((reason) => (
                <button
                  key={reason}
                  onClick={() => handleReject(reason)}
                  className="w-full text-left px-4 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm text-slate-700"
                >
                  {reason}
                </button>
              ))}
            </div>
            <div className="border-t border-slate-200 pt-4 mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Or write a custom reason:
              </label>
              <textarea
                value={customRejectionReason}
                onChange={(e) => setCustomRejectionReason(e.target.value)}
                placeholder="Enter custom rejection reason..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none"
                rows={3}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleReject(customRejectionReason)}
                disabled={!customRejectionReason.trim() || processing}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Send Custom Reason
              </button>
              <button
                onClick={() => {
                  setShowRejectionModal(false);
                  setCustomRejectionReason('');
                }}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'pending' | 'inventory' | 'orders' | 'contacts' | 'invoices' | 'settings' | 'changelog' | 'calculator'>('pending');
  const [units, setUnits] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [pricingRules, setPricingRules] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [twilioSettings, setTwilioSettings] = useState({
    account_sid: '',
    auth_token: '',
    from_number: ''
  });
  const [stripeSettings, setStripeSettings] = useState({
    secret_key: '',
    publishable_key: ''
  });
  const [adminEmail, setAdminEmail] = useState('');
  const [savingTwilio, setSavingTwilio] = useState(false);
  const [savingStripe, setSavingStripe] = useState(false);
  const [smsTemplates, setSmsTemplates] = useState<any[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [unitsRes, ordersRes, pricingRes, settingsRes, templatesRes] = await Promise.all([
        supabase.from('units').select('*').order('name'),
        supabase.from('orders').select(`
          *,
          customers (first_name, last_name, email, phone),
          addresses (line1, city, state, zip)
        `).order('created_at', { ascending: false }).limit(20),
        supabase.from('pricing_rules').select('*').limit(1).maybeSingle(),
        supabase.from('admin_settings').select('*').in('key', ['twilio_account_sid', 'twilio_auth_token', 'twilio_from_number', 'admin_email', 'stripe_secret_key', 'stripe_publishable_key']),
        supabase.from('sms_message_templates').select('*').order('template_name'),
      ]);

      if (unitsRes.data) setUnits(unitsRes.data);
      if (ordersRes.data) setOrders(ordersRes.data);
      if (pricingRes.data) setPricingRules(pricingRes.data);
      if (templatesRes.data) setSmsTemplates(templatesRes.data);

      if (settingsRes.data) {
        const settings: any = {};
        const stripeSet: any = {};
        settingsRes.data.forEach((s: any) => {
          if (s.key === 'twilio_account_sid') settings.account_sid = s.value;
          if (s.key === 'twilio_auth_token') settings.auth_token = s.value;
          if (s.key === 'twilio_from_number') settings.from_number = s.value;
          if (s.key === 'admin_email') setAdminEmail(s.value);
          if (s.key === 'stripe_secret_key') stripeSet.secret_key = s.value;
          if (s.key === 'stripe_publishable_key') stripeSet.publishable_key = s.value;
        });
        setTwilioSettings(settings);
        setStripeSettings(stripeSet);
      }
    } catch (error) {
      console.error('Error loading admin data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveTwilioSettings() {
    setSavingTwilio(true);
    try {
      const updates = [
        { key: 'twilio_account_sid', value: twilioSettings.account_sid, description: 'Twilio Account SID for SMS notifications' },
        { key: 'twilio_auth_token', value: twilioSettings.auth_token, description: 'Twilio Auth Token for SMS notifications' },
        { key: 'twilio_from_number', value: twilioSettings.from_number, description: 'Twilio phone number to send SMS from (E.164 format)' },
        { key: 'admin_email', value: adminEmail, description: 'Admin email address for error notifications and alerts' },
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from('admin_settings')
          .update({ value: update.value })
          .eq('key', update.key);

        if (error) {
          console.error('Error updating setting:', update.key, error);
          throw new Error(`Failed to update ${update.key}: ${error.message}`);
        }
      }

      alert('Settings saved successfully!');
    } catch (error: any) {
      console.error('Error saving settings:', error);
      const errorMessage = error.message || 'Failed to save settings. Please try again.';

      if (errorMessage.includes('row-level security')) {
        alert('Permission denied: You must be logged in as an admin user to update settings. Please make sure you are logged in as admin@bouncepartyclub.com');
      } else {
        alert(`Failed to save settings: ${errorMessage}`);
      }
    } finally {
      setSavingTwilio(false);
    }
  }

  async function handleSaveStripeSettings() {
    setSavingStripe(true);
    try {
      const updates = [
        { key: 'stripe_secret_key', value: stripeSettings.secret_key },
        { key: 'stripe_publishable_key', value: stripeSettings.publishable_key },
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from('admin_settings')
          .update({ value: update.value })
          .eq('key', update.key);

        if (error) {
          console.error('Error updating Stripe setting:', update.key, error);
          throw new Error(`Failed to update ${update.key}: ${error.message}`);
        }
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`;
      const testResponse = await fetch(apiUrl, {
        method: 'OPTIONS',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      });

      if (testResponse.ok) {
        alert('Stripe settings saved successfully! The payment system is now ready.');
      } else {
        alert('Stripe settings saved, but there may be an issue with the edge function. Please test a payment.');
      }
    } catch (error: any) {
      console.error('Error saving Stripe settings:', error);
      const errorMessage = error.message || 'Failed to save settings. Please try again.';

      if (errorMessage.includes('row-level security')) {
        alert('Permission denied: You must be logged in as an admin user to update settings.');
      } else {
        alert(`Failed to save Stripe settings: ${errorMessage}`);
      }
    } finally {
      setSavingStripe(false);
    }
  }

  async function handleSaveTemplate() {
    if (!editingTemplate) return;

    setSavingTemplate(true);
    try {
      const { error } = await supabase
        .from('sms_message_templates')
        .update({ message_template: editingTemplate.message_template })
        .eq('id', editingTemplate.id);

      if (error) throw error;

      alert('Template saved successfully!');
      setEditingTemplate(null);
      await loadData();
    } catch (error) {
      console.error('Error saving template:', error);
      alert('Failed to save template. Please try again.');
    } finally {
      setSavingTemplate(false);
    }
  }

  const handleExportMenu = () => {
    alert('Menu export feature coming soon - will generate PNG/PDF with current pricing');
  };

  async function handleDeleteUnit(unitId: string, unitName: string) {
    if (!confirm(`Are you sure you want to delete "${unitName}"?`)) return;

    try {
      const { error } = await supabase.from('units').delete().eq('id', unitId);
      if (error) throw error;

      alert('Unit deleted successfully');
      loadData();
    } catch (error) {
      console.error('Error deleting unit:', error);
      alert('Failed to delete unit');
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-slate-900">Admin Dashboard</h1>
        <button
          onClick={handleExportMenu}
          className="flex items-center bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          <Download className="w-5 h-5 mr-2" />
          Export Menu
        </button>
      </div>

      <div className="flex gap-2 mb-8 overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'overview'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors relative ${
            activeTab === 'pending'
              ? 'bg-amber-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-amber-600'
          }`}
        >
          Pending Review
          {orders.filter(o => o.status === 'pending_review').length > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
              {orders.filter(o => o.status === 'pending_review').length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'inventory'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Inventory
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'orders'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Orders
        </button>
        <button
          onClick={() => setActiveTab('contacts')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'contacts'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Contacts
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'invoices'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Invoices
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'settings'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Settings
        </button>
        <button
          onClick={() => setActiveTab('changelog')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'changelog'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Changelog
        </button>
        <button
          onClick={() => setActiveTab('calculator')}
          className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            activeTab === 'calculator'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
          }`}
        >
          Travel Calculator
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Package className="w-8 h-8 text-blue-600" />
              <span className="text-3xl font-bold text-slate-900">{units.length}</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Total Units</h3>
            <p className="text-sm text-slate-600">Active inventory items</p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <FileText className="w-8 h-8 text-green-600" />
              <span className="text-3xl font-bold text-slate-900">{orders.length}</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Recent Orders</h3>
            <p className="text-sm text-slate-600">Last 20 bookings</p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <DollarSign className="w-8 h-8 text-cyan-600" />
              <span className="text-3xl font-bold text-slate-900">
                {formatCurrency(
                  orders
                    .filter((o) => o.status === 'confirmed')
                    .reduce((sum, o) => sum + o.subtotal_cents, 0)
                )}
              </span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Total Revenue</h3>
            <p className="text-sm text-slate-600">Confirmed bookings</p>
          </div>
        </div>
      )}

      {activeTab === 'pending' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Pending Review</h2>
            <button
              onClick={loadData}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Refresh
            </button>
          </div>

          {orders.filter(o => o.status === 'pending_review').length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-600 mb-2">No pending bookings</p>
              <p className="text-sm text-slate-500">New bookings will appear here for review</p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders
                .filter(o => o.status === 'pending_review')
                .map((order) => (
                  <PendingOrderCard key={order.id} order={order} onUpdate={loadData} />
                ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'inventory' && (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="p-6 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-slate-900">Inventory Management</h2>
            <button
              onClick={() => navigate('/admin/inventory/new')}
              className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Unit
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Unit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Price (Dry)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Price (Water)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Capacity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {units.map((unit) => (
                  <tr key={unit.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{unit.name}</div>
                          <div className="text-sm text-slate-500">{unit.dimensions}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-slate-900">{unit.type}</span>
                      {unit.is_combo && (
                        <span className="ml-2 inline-flex text-xs font-semibold px-2 py-1 rounded bg-cyan-100 text-cyan-800">
                          COMBO
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                      {formatCurrency(unit.price_dry_cents)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                      {unit.price_water_cents ? formatCurrency(unit.price_water_cents) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                      {unit.capacity} kids
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex text-xs font-semibold px-2 py-1 rounded ${
                          unit.active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {unit.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => navigate(`/admin/inventory/edit/${unit.id}`)}
                        className="text-blue-600 hover:text-blue-700 mr-3"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteUnit(unit.id, unit.name)}
                        className="text-red-600 hover:text-red-700"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <OrdersManager />
        </div>
      )}

      {activeTab === 'changelog' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Admin Settings Changelog</h2>
          <p className="text-slate-600 mb-4">
            View all changes made to admin settings, including who made the changes and when.
          </p>
          <div className="text-center py-12 text-slate-500">
            <p>Changelog feature coming soon...</p>
            <p className="text-sm mt-2">Will display all admin setting changes with timestamps and user tracking</p>
          </div>
        </div>
      )}

      {activeTab === 'calculator' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Travel Fee Calculator</h2>
          <p className="text-slate-600 mb-4">
            Calculate travel fees for phone estimates by entering a customer address.
          </p>
          <div className="text-center py-12 text-slate-500">
            <p>Travel fee calculator coming soon...</p>
            <p className="text-sm mt-2">Will show distance calculation and fee breakdown</p>
          </div>
        </div>
      )}

      {activeTab === 'pricing' && pricingRules && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Pricing Configuration</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Base Radius (miles)
                </label>
                <input
                  type="number"
                  value={pricingRules.base_radius_miles}
                  readOnly
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Per Mile After Base
                </label>
                <input
                  type="text"
                  value={formatCurrency(pricingRules.per_mile_after_base_cents)}
                  readOnly
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Sandbag Fee
                </label>
                <input
                  type="text"
                  value={formatCurrency(pricingRules.surface_sandbag_fee_cents)}
                  readOnly
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Residential Multiplier
                </label>
                <input
                  type="text"
                  value={pricingRules.residential_multiplier}
                  readOnly
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Commercial Multiplier
                </label>
                <input
                  type="text"
                  value={pricingRules.commercial_multiplier}
                  readOnly
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Overnight Holiday Only
                </label>
                <input
                  type="text"
                  value={pricingRules.overnight_holiday_only ? 'Yes' : 'No'}
                  readOnly
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Included Cities
              </label>
              <div className="flex flex-wrap gap-2">
                {(pricingRules.included_city_list_json as string[]).map((city: string) => (
                  <span
                    key={city}
                    className="inline-flex px-3 py-1 bg-blue-100 text-blue-800 text-sm font-semibold rounded"
                  >
                    {city}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Same-Day Pickup Fee Matrix
              </label>
              <div className="overflow-x-auto">
                <table className="w-full border border-slate-200 rounded-lg">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        Units
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        Generator
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        Min Subtotal
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        Fee
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(pricingRules.same_day_matrix_json as any[]).map((rule: any, idx: number) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 text-sm text-slate-900">{rule.units}</td>
                        <td className="px-4 py-2 text-sm text-slate-900">
                          {rule.generator ? 'Yes' : 'No'}
                        </td>
                        <td className="px-4 py-2 text-sm text-slate-900">
                          {formatCurrency(rule.subtotal_ge_cents)}
                        </td>
                        <td className="px-4 py-2 text-sm font-semibold text-slate-900">
                          {formatCurrency(rule.fee_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => navigate('/admin/pricing/edit')}
                className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                <Edit2 className="w-4 h-4 mr-2" />
                Edit Pricing
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'contacts' && <ContactsList />}

      {activeTab === 'invoices' && (
        <div className="space-y-8">
          <InvoiceBuilder />
          <InvoicesList />
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Stripe Payment Settings</h2>

            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-slate-700 mb-2">
                Configure your Stripe secret key to enable payment processing for bookings.
              </p>
              <p className="text-sm text-slate-600 mb-2">
                Get your keys from <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 underline">Stripe Dashboard</a>
              </p>
              <p className="text-sm text-amber-700 font-medium">
                Important: Use test keys (sk_test_...) for testing and live keys (sk_live_...) for production.
              </p>
            </div>

            <div className="space-y-4 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Stripe Secret Key
                </label>
                <input
                  type="password"
                  value={stripeSettings.secret_key}
                  onChange={(e) => setStripeSettings({ ...stripeSettings, secret_key: e.target.value })}
                  placeholder="sk_test_... or sk_live_..."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  This key is securely stored and used by the payment processing system
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Stripe Publishable Key
                </label>
                <input
                  type="text"
                  value={stripeSettings.publishable_key}
                  onChange={(e) => setStripeSettings({ ...stripeSettings, publishable_key: e.target.value })}
                  placeholder="pk_test_... or pk_live_..."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  This key is used on the frontend to display the payment form
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSaveStripeSettings}
                  disabled={savingStripe || !stripeSettings.secret_key || !stripeSettings.publishable_key}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
                >
                  {savingStripe ? 'Saving...' : 'Save Stripe Settings'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">SMS Notification Settings</h2>

            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-slate-700 mb-2">
                Configure your Twilio credentials to enable SMS notifications when customers book rentals.
              </p>
              <p className="text-sm text-slate-600">
                Get your credentials from <a href="https://console.twilio.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 underline">Twilio Console</a>
              </p>
            </div>

          <div className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Twilio Account SID
              </label>
              <input
                type="text"
                value={twilioSettings.account_sid}
                onChange={(e) => setTwilioSettings({ ...twilioSettings, account_sid: e.target.value })}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Twilio Auth Token
              </label>
              <input
                type="password"
                value={twilioSettings.auth_token}
                onChange={(e) => setTwilioSettings({ ...twilioSettings, auth_token: e.target.value })}
                placeholder="********************************"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Twilio Phone Number
              </label>
              <input
                type="tel"
                value={twilioSettings.from_number}
                onChange={(e) => setTwilioSettings({ ...twilioSettings, from_number: e.target.value })}
                placeholder="+15551234567"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Must be in E.164 format (e.g., +15551234567)
              </p>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Admin Email for Error Notifications
              </label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                All application errors will be sent to this email with detailed stack traces
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSaveTwilioSettings}
                disabled={savingTwilio || !twilioSettings.account_sid || !twilioSettings.auth_token || !twilioSettings.from_number}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
              >
                {savingTwilio ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
        </div>
      )}

      {activeTab === 'sms_templates' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">SMS Message Templates</h2>

          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-slate-700 mb-2">
              Customize the SMS messages sent to customers. Use these variables in your templates:
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{customer_first_name}'}</code>
              <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{customer_last_name}'}</code>
              <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{customer_full_name}'}</code>
              <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{order_id}'}</code>
              <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{event_date}'}</code>
              <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{total_amount}'}</code>
              <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{balance_amount}'}</code>
              <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{rejection_reason}'}</code>
            </div>
          </div>

          <div className="space-y-4">
            {smsTemplates.map((template) => (
              <div key={template.id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-semibold text-slate-900">{template.template_name}</h3>
                    <p className="text-sm text-slate-600">{template.description}</p>
                  </div>
                  <button
                    onClick={() => setEditingTemplate(template)}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    Edit
                  </button>
                </div>
                <div className="mt-3 p-3 bg-slate-50 rounded border border-slate-200">
                  <p className="text-sm text-slate-700 font-mono whitespace-pre-wrap">{template.message_template}</p>
                </div>
              </div>
            ))}
          </div>

          {editingTemplate && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Edit Template: {editingTemplate.template_name}</h3>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Message Template
                  </label>
                  <textarea
                    value={editingTemplate.message_template}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, message_template: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono resize-none"
                    rows={6}
                  />
                </div>

                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs font-medium text-slate-700 mb-2">Available Variables:</p>
                  <div className="flex flex-wrap gap-2">
                    <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{customer_first_name}'}</code>
                    <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{customer_last_name}'}</code>
                    <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{customer_full_name}'}</code>
                    <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{order_id}'}</code>
                    <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{event_date}'}</code>
                    <code className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono">{'{total_amount}'}</code>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleSaveTemplate}
                    disabled={savingTemplate}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {savingTemplate ? 'Saving...' : 'Save Template'}
                  </button>
                  <button
                    onClick={() => setEditingTemplate(null)}
                    className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Admin() {
  return <AdminDashboard />;
}
