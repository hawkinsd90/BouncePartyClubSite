import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { CreditCard, CheckCircle, Loader2, AlertCircle, Calendar, MapPin, Package } from 'lucide-react';
import { StripeCheckoutForm } from '../components/StripeCheckoutForm';
import { completeOrderAfterPayment } from '../lib/orderCreation';

export function Invoice() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [address, setAddress] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  useEffect(() => {
    if (orderId) {
      loadOrder(orderId);
    }
  }, [orderId]);

  const loadOrder = async (id: string) => {
    try {
      setLoading(true);
      setError(null);

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          customers (*),
          addresses (*),
          order_items (
            *,
            units (*)
          )
        `)
        .eq('id', id)
        .single();

      if (orderError) throw orderError;
      if (!orderData) throw new Error('Invoice not found');

      if (orderData.status === 'cancelled') {
        setError('This invoice has been cancelled.');
        setLoading(false);
        return;
      }

      // Check if deposit has been paid
      // If deposit_required = true and deposit has been paid, show success
      // If deposit_required = false, no payment needed (manual invoice)
      const depositPaid = orderData.deposit_required
        ? (orderData.deposit_paid_cents ?? 0) >= orderData.deposit_due_cents
        : true; // No deposit required means consider it "paid"

      if (depositPaid && orderData.status !== 'draft') {
        setPaymentSuccess(true);
      }

      setOrder(orderData);
      setCustomer(orderData.customers);
      setAddress(orderData.addresses);
      setOrderItems(orderData.order_items);
      setLoading(false);
    } catch (err: any) {
      console.error('Error loading invoice:', err);
      setError(err.message || 'Failed to load invoice');
      setLoading(false);
    }
  };

  const handlePayNow = async () => {
    
    if (!orderId) {
      setError('Missing order ID for payment.');
      return;
    }
    setCheckingAvailability(true);

    try {
      const unitIds = orderItems.map(item => item.unit_id);

      const { data: availabilityData, error: availabilityError } = await supabase.rpc(
        'check_unit_availability',
        {
          p_unit_ids: unitIds,
          p_start_date: order.start_date,
          p_end_date: order.end_date,
        }
      );

      if (availabilityError) {
        console.error('Availability check error:', availabilityError);
        throw new Error('Unable to verify availability. Please try again.');
      }

      const unavailable = availabilityData?.filter((item: any) => !item.available);
      if (unavailable && unavailable.length > 0) {
        const unitNames = unavailable.map((item: any) => item.unit_name).join(', ');

        await supabase
          .from('orders')
          .update({ status: 'cancelled' })
          .eq('id', orderId);

        alert(
          `Sorry, these units are no longer available for your selected dates: ${unitNames}\n\nThis invoice has been cancelled. Please contact us at (313) 889-3860 to create a new booking.`
        );

        setError('Invoice cancelled due to unavailability');
        setCheckingAvailability(false);
        return;
      }

      setShowPaymentForm(true);
      setCheckingAvailability(false);
    } catch (error: any) {
      console.error('Error checking availability:', error);
      alert(
        `Unable to verify availability: ${error.message}\n\nPlease try again or contact us at (313) 889-3860.`
      );
      setCheckingAvailability(false);
    }
  };

  const handlePaymentSuccess = async () => {
    try {
      await completeOrderAfterPayment(orderId!, 'payment_intent_id');
      setPaymentSuccess(true);
      setShowPaymentForm(false);
    } catch (error: any) {
      console.error('Error completing payment:', error);
      alert(
        `Payment succeeded but failed to finalize booking: ${error.message}\n\nPlease contact us at (313) 889-3860 with your order confirmation.`
      );
    }
  };

  const handlePaymentError = (error: string) => {
    alert(`Payment failed: ${error}\n\nPlease try again or contact us at (313) 889-3860 for assistance.`);
    setShowPaymentForm(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Invoice Not Available</h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (paymentSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-2xl w-full">
          <div className="text-center mb-8">
            <div className="bg-green-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Payment Received!</h1>
            <p className="text-slate-600">Your booking is being reviewed by our team.</p>
          </div>

          <div className="bg-slate-50 rounded-lg p-6 mb-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-600">Order ID:</span>
                <p className="font-mono font-semibold text-slate-900">
                  {orderId?.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <div>
                <span className="text-slate-600">Event Date:</span>
                <p className="font-semibold text-slate-900">{order.event_date}</p>
              </div>
              <div>
                <span className="text-slate-600">Deposit Paid:</span>
                <p className="font-semibold text-green-600">
                  {formatCurrency(order.deposit_due_cents)}
                </p>
              </div>
              <div>
                <span className="text-slate-600">Balance Due:</span>
                <p className="font-semibold text-slate-900">
                  {formatCurrency(order.balance_due_cents)}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 text-sm text-slate-600 mb-8">
            <p>
              A confirmation email has been sent to{' '}
              <span className="font-semibold text-slate-900">{customer.email}</span>.
            </p>
            <p>
              Our admin team will review your booking and contact you within 24 hours to confirm your delivery time window and finalize your reservation.
            </p>
          </div>

          <button
            onClick={() => navigate('/')}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const totalCents = order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-blue-600 text-white p-6">
            <h1 className="text-3xl font-bold mb-2">Invoice</h1>
            <p className="text-blue-100">Order #{orderId?.slice(0, 8).toUpperCase()}</p>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-500 uppercase mb-2">Customer</h2>
                <p className="font-semibold text-slate-900">{customer.first_name} {customer.last_name}</p>
                <p className="text-slate-600">{customer.email}</p>
                <p className="text-slate-600">{customer.phone}</p>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-500 uppercase mb-2">Event Details</h2>
                <div className="flex items-start mb-2">
                  <Calendar className="w-4 h-4 text-blue-600 mr-2 mt-1" />
                  <div>
                    <p className="font-semibold text-slate-900">{order.event_date}</p>
                    <p className="text-sm text-slate-600">
                      {order.start_window} - {order.end_window}
                    </p>
                  </div>
                </div>
                <div className="flex items-start">
                  <MapPin className="w-4 h-4 text-blue-600 mr-2 mt-1" />
                  <div className="text-sm text-slate-600">
                    <p>{address.line1}</p>
                    {address.line2 && <p>{address.line2}</p>}
                    <p>{address.city}, {address.state} {address.zip}</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase mb-4 flex items-center">
                <Package className="w-4 h-4 mr-2" />
                Items
              </h2>
              <div className="space-y-3">
                {orderItems.map((item, index) => (
                  <div key={index} className="flex justify-between items-center py-3 border-b border-slate-200">
                    <div>
                      <p className="font-semibold text-slate-900">{item.units.name}</p>
                      <p className="text-sm text-slate-600">
                        {item.wet_or_dry} {item.qty > 1 && `× ${item.qty}`}
                      </p>
                    </div>
                    <p className="font-semibold text-slate-900">
                      {formatCurrency(item.unit_price_cents * item.qty)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 space-y-2">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>{formatCurrency(order.subtotal_cents)}</span>
              </div>
              {order.travel_fee_cents > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Travel Fee</span>
                  <span>{formatCurrency(order.travel_fee_cents)}</span>
                </div>
              )}
              {order.surface_fee_cents > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Surface Fee</span>
                  <span>{formatCurrency(order.surface_fee_cents)}</span>
                </div>
              )}
              {order.same_day_pickup_fee_cents > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Same Day Pickup Fee</span>
                  <span>{formatCurrency(order.same_day_pickup_fee_cents)}</span>
                </div>
              )}
              {order.tax_cents > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Tax</span>
                  <span>{formatCurrency(order.tax_cents)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-300">
                <span>Total</span>
                <span>{formatCurrency(totalCents)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600 pt-2">
                <span>Deposit Due</span>
                <span className="font-semibold">{formatCurrency(order.deposit_due_cents)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>Balance Due at Event</span>
                <span className="font-semibold">{formatCurrency(order.balance_due_cents)}</span>
              </div>
            </div>

            {order.deposit_required && order.deposit_paid_cents === 0 && (
              <div className="bg-blue-50 rounded-lg p-6 text-center">
                <CreditCard className="w-12 h-12 text-blue-600 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-slate-900 mb-2">
                  Pay Deposit to Confirm Booking
                </h3>
                <p className="text-slate-600 mb-4">
                  Secure your reservation with a deposit payment of {formatCurrency(order.deposit_due_cents)}
                </p>
                <button
                  onClick={handlePayNow}
                  disabled={checkingAvailability}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-8 rounded-lg transition-colors inline-flex items-center"
                >
                  {checkingAvailability ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Checking Availability...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-5 h-5 mr-2" />
                      Pay Now
                    </>
                  )}
                </button>
              </div>
            )}

            {!order.deposit_required && (
              <div className="bg-slate-50 rounded-lg p-6 text-center">
                <p className="text-slate-600">
                  This is a manual invoice. No deposit payment required.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPaymentForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Payment Information</h2>
            <p className="text-slate-600 mb-6">
              Enter your payment details to complete your booking.
            </p>
            <StripeCheckoutForm
              orderId={orderId || ''}
              depositCents={order.deposit_due_cents}
              customerEmail={customer.email}
              customerName={`${customer.first_name} ${customer.last_name}`}
              onSuccess={handlePaymentSuccess}
              onError={handlePaymentError}
            />
          </div>
        </div>
      )}
    </div>
  );
}
