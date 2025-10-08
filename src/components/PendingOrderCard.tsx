import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { format } from 'date-fns';
import { OrderDetailModal } from './OrderDetailModal';
import { Edit2 } from 'lucide-react';

export function PendingOrderCard({ order, onUpdate }: { order: any; onUpdate: () => void }) {
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
  const [showEditModal, setShowEditModal] = useState(false);

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

  const isDraft = order.status === 'draft';
  const paymentUrl = `${window.location.origin}/checkout/${order.id}`;

  async function handleCopyPaymentLink() {
    try {
      await navigator.clipboard.writeText(paymentUrl);
      alert('Payment link copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy:', error);
      alert(`Payment link: ${paymentUrl}`);
    }
  }

  async function handleSendPaymentLink() {
    const message = `Hi ${order.customers?.first_name}, your invoice is ready! Please complete payment to secure your booking: ${paymentUrl}`;
    await handleSendSms(message);
  }

  return (
    <div className="border border-blue-300 bg-blue-50 rounded-lg p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            {order.customers?.first_name} {order.customers?.last_name}
          </h3>
          <p className="text-sm text-slate-600">{order.customers?.email}</p>
          <p className="text-sm text-slate-600">{order.customers?.phone}</p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2 mb-2">
            <button
              onClick={() => setShowEditModal(true)}
              className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition-colors"
            >
              <Edit2 className="w-3 h-3" />
              Edit Order
            </button>
          </div>
          <p className="text-sm text-slate-600">Order ID</p>
          <p className="font-mono text-sm font-semibold">{order.id.slice(0, 8).toUpperCase()}</p>
          <p className="text-xs text-slate-500 mt-1">
            {format(new Date(order.created_at), 'MMM d, yyyy h:mm a')}
          </p>
          <div className="mt-2">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-orange-600 text-white">
              {isDraft ? 'DRAFT - NEEDS DEPOSIT' : 'PENDING REVIEW'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4 p-4 bg-white rounded-lg">
        <div>
          <h4 className="text-sm font-medium text-slate-500 mb-1">Event Date & Time</h4>
          <p className="text-base text-slate-900 font-medium">
            {format(new Date(order.event_date), 'EEEE, MMMM d, yyyy')}
          </p>
          <p className="text-sm text-slate-600">
            {order.start_window} - {order.end_window}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-medium text-slate-500 mb-1">Event Location</h4>
          <p className="text-base text-slate-900">
            {order.addresses?.line1}
            {order.addresses?.line2 && `, ${order.addresses.line2}`}
          </p>
          <p className="text-sm text-slate-600">
            {order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}
          </p>
          <p className="text-sm text-slate-600 capitalize">
            {order.location_type} + {order.surface || 'Not Specified'}
          </p>
        </div>
      </div>

      <div className="mb-4 p-3 bg-white rounded-lg border border-slate-200">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">Generator</div>
            <div className="font-medium text-slate-900">{order.generator_required ? 'Yes' : 'No'}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">Surface</div>
            <div className="font-medium text-slate-900 capitalize">{order.surface || 'Not Needed'}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">Pickup</div>
            <div className="font-medium text-slate-900">{order.same_day_pickup_fee_cents > 0 ? 'Same Day' : 'Not Specified'}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">Pets</div>
            <div className="font-medium text-slate-900">{order.has_pets ? 'Yes' : 'No'}</div>
          </div>
        </div>
        {order.special_details && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <span className="text-slate-600 text-sm">Special Details:</span>
            <p className="mt-1 text-sm text-slate-900">{order.special_details}</p>
          </div>
        )}
      </div>

      <div className="mb-4 p-4 bg-white rounded-lg">
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Street View Assessment - Multiple Angles</h4>
        <div className="text-xs text-slate-500 mb-3">
          Non-client test message may still display during delivery. Walk down during delivery.
        </div>
        <div className="grid grid-cols-2 gap-3">
          {streetViewAngles.map(angle => (
            <div key={angle.heading} className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{angle.label}</div>
              <img
                src={getStreetViewUrl(angle.heading)}
                alt={angle.label}
                className="w-full h-48 object-cover"
                onLoad={() => setStreetViewLoaded(true)}
                onError={() => setStreetViewError(true)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 p-4 bg-white rounded-lg">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Complete Order Details</h4>
        <div className="space-y-2 text-sm">
          {orderItems.map(item => (
            <div key={item.id} className="flex justify-between py-1">
              <span className="text-slate-700">• {item.units?.name} ({item.wet_or_dry}) x{item.qty}</span>
              <span className="font-medium text-slate-900">{formatCurrency(item.unit_price_cents * item.qty)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-200 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Subtotal</span>
            <span className="font-medium">{formatCurrency(order.subtotal_cents)}</span>
          </div>
          <div>
            <div className="flex justify-between">
              <span className="text-slate-600">Travel Fee</span>
              <span className="font-medium">{formatCurrency(order.travel_fee_cents)}</span>
            </div>
            {order.travel_fee_breakdown && (
              <div className="ml-4 mt-1 space-y-0.5 text-xs text-slate-500">
                <div>Total distance: {order.travel_fee_breakdown.total_distance_miles} miles</div>
                <div>Charge miles: {order.travel_fee_breakdown.chargeable_miles} miles × ${(order.travel_fee_breakdown.rate_per_mile / 100).toFixed(2)}/mile</div>
              </div>
            )}
          </div>
          {order.surface_fee_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-600">Surface Fee: {order.surface}</span>
              <span className="font-medium">{formatCurrency(order.surface_fee_cents)}</span>
            </div>
          )}
          {order.same_day_pickup_fee_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-600">Same Day Pickup Fee</span>
              <span className="font-medium">{formatCurrency(order.same_day_pickup_fee_cents)}</span>
          </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-600">Tax</span>
            <span className="font-medium">{formatCurrency(order.tax_cents)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-slate-300 font-bold">
            <span>Total</span>
            <span>{formatCurrency(order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents)}</span>
          </div>
        </div>
      </div>

      {smsConversations.length > 0 && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">SMS Conversation</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {smsConversations.map(msg => (
              <div key={msg.id} className={`text-sm ${msg.direction === 'inbound' ? 'text-blue-900' : 'text-slate-700'}`}>
                <span className="font-medium">{msg.direction === 'inbound' ? 'Customer' : 'You'}:</span> {msg.message_body}
                <div className="text-xs text-slate-500">{format(new Date(msg.created_at), 'MMM d, h:mm a')}</div>
              </div>
            ))}
          </div>
          {!showSmsReply && (
            <button
              onClick={() => setShowSmsReply(true)}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Reply via SMS
            </button>
          )}
          {showSmsReply && (
            <div className="mt-3">
              <textarea
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                placeholder="Type your message..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                rows={3}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => handleSendSms()}
                  disabled={sendingSms || !replyMessage.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-1 rounded text-sm font-medium"
                >
                  {sendingSms ? 'Sending...' : 'Send'}
                </button>
                <button
                  onClick={() => {
                    setShowSmsReply(false);
                    setReplyMessage('');
                  }}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-1 rounded text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <button
            onClick={handleTestSms}
            disabled={sendingSms}
            className="mt-2 text-sm text-slate-600 hover:text-slate-800 underline"
          >
            Send test SMS
          </button>
        </div>
      )}

      <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200">
        <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center">
          <span className="mr-2">💳</span> Payment Management
        </h4>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <div className="text-xs text-green-700 mb-1">Total Paid</div>
            <div className="text-lg font-bold text-green-900">
              {formatCurrency((order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0))}
            </div>
            <div className="text-xs text-green-700 mt-1">
              Deposit: {formatCurrency(order.deposit_paid_cents || 0)}<br />
              Balance: {formatCurrency(order.balance_paid_cents || 0)}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-xs text-slate-700 mb-1">Balance Due</div>
            <div className="text-lg font-bold text-slate-900">
              {formatCurrency(order.balance_due_cents)}
            </div>
          </div>
        </div>

        {order.stripe_customer_id && order.stripe_payment_method_id ? (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 flex items-start text-sm">
            <span className="text-blue-600 mr-2">✓</span>
            <div className="text-blue-900">
              <strong>Payment method on file</strong><br />
              You can charge the customer's card for remaining balance or damage fees.
            </div>
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 flex items-start text-sm">
            <span className="text-yellow-600 mr-2">⚠</span>
            <div className="text-yellow-900">
              <strong>No payment method on file</strong><br />
              Customer needs to complete payment first before you can charge additional fees.
            </div>
          </div>
        )}

        {payments.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <h5 className="text-sm font-semibold text-slate-700 mb-2">Payment History</h5>
            <div className="space-y-2">
              {payments.map((payment) => (
                <div key={payment.id} className="flex justify-between items-center p-2 bg-slate-50 rounded text-sm">
                  <div>
                    <div className="font-medium text-slate-900 capitalize">
                      {payment.payment_type?.replace('_', ' ') || 'Payment'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {format(new Date(payment.created_at), 'MMM d, yyyy h:mm a')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold ${
                      payment.status === 'succeeded' ? 'text-green-600' :
                      payment.status === 'failed' ? 'text-red-600' : 'text-slate-600'
                    }`}>
                      {formatCurrency(payment.amount_cents)}
                    </div>
                    <div className="text-xs capitalize text-slate-500">{payment.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isDraft ? (
        <div className="space-y-3">
          <div className="p-4 bg-white rounded-lg border border-blue-200">
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Payment Link</h4>
            <p className="text-xs text-slate-600 mb-3">Send this link to the customer to collect deposit payment:</p>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={paymentUrl}
                readOnly
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50"
              />
              <button
                onClick={handleCopyPaymentLink}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Copy Link
              </button>
            </div>
            <button
              onClick={handleSendPaymentLink}
              disabled={sendingSms}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              {sendingSms ? 'Sending...' : 'Send Payment Link via SMS'}
            </button>
          </div>
          <button
            onClick={() => handleReject()}
            disabled={processing}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Cancel Order
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={processing}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {processing ? 'Processing...' : 'Accept'}
          </button>
          <button
            onClick={() => handleReject()}
            disabled={processing}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            Reject
          </button>
        </div>
      )}

      {showRejectionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Reject Booking</h3>
            <p className="text-sm text-slate-600 mb-4">Select a reason or enter custom:</p>
            <div className="space-y-2 mb-4">
              {preGeneratedRejections.map(reason => (
                <button
                  key={reason}
                  onClick={() => handleReject(reason)}
                  className="w-full text-left px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm text-slate-700"
                >
                  {reason}
                </button>
              ))}
            </div>
            <textarea
              value={customRejectionReason}
              onChange={(e) => setCustomRejectionReason(e.target.value)}
              placeholder="Or enter custom reason..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4"
              rows={3}
            />
            <div className="flex gap-3">
              <button
                onClick={() => customRejectionReason.trim() && handleReject(customRejectionReason)}
                disabled={!customRejectionReason.trim()}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg"
              >
                Reject with Custom
              </button>
              <button
                onClick={() => {
                  setShowRejectionModal(false);
                  setCustomRejectionReason('');
                }}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <OrderDetailModal
          order={order}
          onClose={() => setShowEditModal(false)}
          onUpdate={() => {
            setShowEditModal(false);
            onUpdate();
          }}
        />
      )}
    </div>
  );
}
