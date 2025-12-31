import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { CreditCard, CheckCircle, Loader2, AlertCircle, Printer } from 'lucide-react';
import { StripeCheckoutForm } from '../components/payment/StripeCheckoutForm';
import { completeOrderAfterPayment } from '../lib/orderCreation';
import { RentalTerms } from '../components/waiver/RentalTerms';
import { PrintableInvoice } from '../components/invoice/PrintableInvoice';
import { ORDER_STATUS } from '../lib/constants/statuses';
import { getOrderById } from '../lib/queries/orders';

export function Invoice() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Record<string, any> | null>(null);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [address, setAddress] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [responsibilityAccepted, setResponsibilityAccepted] = useState(false);
  const [isAdminSent, setIsAdminSent] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  useEffect(() => {
    if (orderId) {
      loadOrder(orderId);
    }
  }, [orderId]);

  const loadOrder = async (id: string) => {
    try {
      setLoading(true);
      setError(null);

      const { data: orderData, error: orderError } = await getOrderById(id);

      if (orderError) throw orderError;
      if (!orderData) throw new Error('Invoice not found');

      const { data: invoiceLink } = await supabase
        .from('invoice_links')
        .select('id')
        .eq('order_id', id)
        .maybeSingle();

      setIsAdminSent(!!invoiceLink);

      if (orderData.status === ORDER_STATUS.CANCELLED) {
        setError('This invoice has been cancelled.');
        setLoading(false);
        return;
      }

      const depositPaid = orderData.deposit_required
        ? (orderData.deposit_paid_cents ?? 0) >= orderData.deposit_due_cents
        : true;

      if (depositPaid && orderData.status !== ORDER_STATUS.DRAFT) {
        setPaymentSuccess(true);
      }

      setOrder(orderData);
      setCustomer(orderData.customers as any);
      setAddress(orderData.addresses as any);
      setOrderItems(orderData.order_items as any);
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
          p_start_date: order.event_date,
          p_end_date: order.event_end_date,
        }
      );

      if (availabilityError) {
        console.error('Availability check error:', availabilityError);
        throw new Error('Unable to verify availability. Please try again.');
      }

      const unavailable = (availabilityData as any)?.filter((item: any) => !item.available);
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
    if (!orderId) {
      alert('Order ID is missing. Please try again.');
      return;
    }
    try {
      // Update the responsibility acceptance field
      const fieldToUpdate = order.pickup_preference === 'next_day'
        ? 'overnight_responsibility_accepted'
        : 'same_day_responsibility_accepted';

      await supabase
        .from('orders')
        .update({ [fieldToUpdate]: true })
        .eq('id', orderId);

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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center border-2 border-slate-100">
          <div className="w-20 h-20 bg-gradient-to-br from-red-400 to-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <AlertCircle className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Invoice Not Available</h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-4 px-8 rounded-xl transition-all shadow-lg hover:shadow-xl"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (paymentSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-2xl w-full border-2 border-slate-100">
          <div className="text-center mb-8">
            <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
              <CheckCircle className="w-16 h-16 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-slate-900 mb-3 tracking-tight">
              {isAdminSent ? 'Booking Confirmed!' : 'Payment Received!'}
            </h1>
            <p className="text-slate-600">
              {isAdminSent
                ? 'Your booking is confirmed and ready for your event!'
                : 'Your booking is being reviewed by our team.'}
            </p>
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
                <span className="text-slate-600">Status:</span>
                <p className="font-semibold text-green-600">
                  {isAdminSent ? 'CONFIRMED' : 'PENDING REVIEW'}
                </p>
              </div>
              <div>
                <span className="text-slate-600">Event Date:</span>
                <p className="font-semibold text-slate-900">{order.event_date}</p>
              </div>
              <div>
                <span className="text-slate-600">Balance Due:</span>
                <p className="font-semibold text-slate-900">
                  {formatCurrency(order.balance_due_cents)}
                </p>
              </div>
              <div>
                <span className="text-slate-600">Deposit Paid:</span>
                <p className="font-semibold text-green-600">
                  {formatCurrency(order.deposit_due_cents)}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 text-sm text-slate-600 mb-8">
            <p>
              A confirmation email has been sent to{' '}
              <span className="font-semibold text-slate-900">{customer.email}</span>.
            </p>
            {isAdminSent ? (
              <>
                <p className="text-green-700 font-semibold">
                  ✅ Your booking is confirmed! We'll contact you 24-48 hours before your event to coordinate delivery details.
                </p>
                <p>
                  The remaining balance of {formatCurrency(order.balance_due_cents)} is due on the day of your event.
                </p>
              </>
            ) : (
              <p>
                Our admin team will review your booking and contact you within 24 hours to confirm your delivery time window and finalize your reservation.
              </p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-900">
              <strong>Keep this page open</strong> or bookmark it to access your order details.
              You can also find your confirmation email for order information.
            </p>
          </div>

          <button
            onClick={() => navigate('/')}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-4 px-8 rounded-xl transition-all shadow-lg hover:shadow-xl"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const totalCents = order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents;

  const transformedQuoteData = {
    event_date: order.event_date,
    start_window: order.start_window,
    address_line1: address.line1,
    address_line2: address.line2,
    city: address.city,
    state: address.state,
    zip: address.zip,
    location_type: order.location_type,
  };

  const transformedPriceBreakdown = {
    subtotal_cents: order.subtotal_cents,
    travel_fee_cents: order.travel_fee_cents,
    travel_fee_display_name: order.travel_total_miles > 0
      ? `Travel Fee (${parseFloat(order.travel_total_miles).toFixed(1)} mi)`
      : 'Travel Fee',
    surface_fee_cents: order.surface_fee_cents,
    same_day_pickup_fee_cents: order.same_day_pickup_fee_cents,
    generator_fee_cents: order.generator_fee_cents || 0,
    tax_cents: order.tax_cents,
    total_cents: totalCents,
    deposit_due_cents: order.deposit_due_cents,
    balance_due_cents: order.balance_due_cents,
  };

  const transformedCart = orderItems.map((item: any) => ({
    unit_name: item.units.name,
    wet_or_dry: item.wet_or_dry,
    unit_price_cents: item.unit_price_cents * item.qty,
  }));

  const transformedContactData = {
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    business_name: customer.business_name,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-2 border-slate-100">
          <div className="bg-blue-600 text-white p-6">
            <h1 className="text-3xl font-bold mb-2">Invoice</h1>
            <p className="text-blue-100">Order #{orderId?.slice(0, 8).toUpperCase()}</p>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-slate-50 rounded-lg p-6 text-center border-2 border-slate-200">
              <Printer className="w-12 h-12 text-blue-600 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">View Full Invoice</h3>
              <p className="text-slate-600 mb-4">
                Click below to view and print the detailed invoice
              </p>
              <button
                onClick={() => setShowInvoiceModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors inline-flex items-center gap-2"
              >
                <Printer className="w-5 h-5" />
                View Invoice
              </button>
            </div>

            <div className="border-t border-slate-200 pt-4 space-y-2">
              <div className="flex justify-between text-lg font-bold text-slate-900 pt-2">
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

            <div className="mt-6">
              <RentalTerms />
            </div>

            {order.deposit_required && order.deposit_paid_cents === 0 && (
              <>
                <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={responsibilityAccepted}
                      onChange={(e) => setResponsibilityAccepted(e.target.checked)}
                      className="mt-0.5 mr-3"
                    />
                    <p className="text-sm text-amber-900 font-medium">
                      {order.pickup_preference === 'next_day' ? (
                        <>⚠️ I understand the inflatable will remain on my property overnight and I am legally responsible for its safety and security until pickup the next morning. *</>
                      ) : (
                        <>⚠️ I understand I am legally responsible for the inflatable until Bounce Party Club picks it up {order.location_type === 'commercial' ? 'by 7:00 PM' : 'this evening'}. *</>
                      )}
                    </p>
                  </label>
                </div>

                <div className="bg-blue-50 rounded-lg p-6 text-center mt-6">
                  <CreditCard className="w-12 h-12 text-blue-600 mx-auto mb-3" />
                  <h3 className="text-lg font-bold text-slate-900 mb-2">
                    Pay Deposit to Confirm Booking
                  </h3>
                  <p className="text-slate-600 mb-4">
                    Secure your reservation with a deposit payment of {formatCurrency(order.deposit_due_cents)}
                  </p>
                  <button
                    onClick={handlePayNow}
                    disabled={checkingAvailability || !responsibilityAccepted}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-8 rounded-lg transition-colors inline-flex items-center"
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
                  {!responsibilityAccepted && (
                    <p className="text-sm text-slate-600 mt-3">
                      Please acknowledge the responsibility agreement above to continue
                    </p>
                  )}
                </div>
              </>
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

      {showInvoiceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex justify-between items-center z-10 no-print">
              <h2 className="text-2xl font-bold text-slate-900">Invoice</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print / Save PDF
                </button>
                <button
                  onClick={() => setShowInvoiceModal(false)}
                  className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="p-4">
              <PrintableInvoice
                quoteData={transformedQuoteData}
                priceBreakdown={transformedPriceBreakdown}
                cart={transformedCart}
                contactData={transformedContactData}
                invoiceNumber={orderId?.slice(0, 8).toUpperCase()}
                isPaid={false}
              />
            </div>
          </div>
        </div>
      )}

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
