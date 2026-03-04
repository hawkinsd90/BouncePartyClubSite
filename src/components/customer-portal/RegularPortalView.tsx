import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { FileText, CreditCard, CheckCircle, Image as ImageIcon, MapPin, Printer, Calendar, MapPinIcon, X } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { formatOrderId } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import WaiverTab from '../waiver/WaiverTab';
import { PaymentTab } from './PaymentTab';
import { PicturesTab } from './PicturesTab';
import { LotPicturesTab } from './LotPicturesTab';
import { CancelOrderModal } from './CancelOrderModal';
import { showToast } from '../../lib/notifications';

interface RegularPortalViewProps {
  order: any;
  orderId: string;
  onReload: () => void;
}

export function RegularPortalView({ order, orderId, onReload }: RegularPortalViewProps) {
  const isPendingReview = order.status === 'pending_review';
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [showLotPicturesModal, setShowLotPicturesModal] = useState(isPendingReview);
  const [showPicturesModal, setShowPicturesModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => {
    loadPayments();

    // Check URL params for payment status
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');

    if (paymentStatus === 'success') {
      showToast('Payment successful! Thank you.', 'success');
      onReload();
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'canceled') {
      showToast('Payment was canceled. You can try again anytime.', 'info');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [onReload]);

  async function loadPayments() {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPayments(data || []);
    } catch (error) {
      console.error('Error loading payments:', error);
    }
  }

  const balanceDue = order.balance_due_cents - (order.balance_paid_cents || 0);
  const needsWaiver = !order.waiver_signed_at;
  const needsPayment = balanceDue > 0;
  const canCancel = ['draft', 'pending_review', 'awaiting_customer_approval', 'confirmed'].includes(
    order.status
  );

  async function handlePayment() {
    try {
      // Create a Stripe Checkout session for balance payment
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-balance-payment`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: orderId,
          amountCents: balanceDue,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create payment session');
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      showToast(error.message || 'Failed to process payment', 'error');
    }
  }

  async function handleSubmitPictures(files: File[], notes: string) {
    try {
      const uploadPromises = files.map(async (file) => {
        // Create unique file path
        const fileExt = file.name.split('.').pop();
        const fileName = `${orderId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('order-pictures')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // Save metadata to database
        const { error: dbError } = await supabase
          .from('order_pictures' as any)
          .insert({
            order_id: orderId,
            file_path: fileName,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            notes: notes || null,
            uploaded_by: null, // Anonymous upload from customer portal
          });

        if (dbError) throw dbError;

        return fileName;
      });

      await Promise.all(uploadPromises);

      showToast(
        `Successfully uploaded ${files.length} picture${files.length > 1 ? 's' : ''}`,
        'success'
      );
    } catch (error) {
      console.error('Error submitting pictures:', error);
      showToast('Failed to upload pictures. Please try again.', 'error');
      throw error;
    }
  }

  const totalPaid = (order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0);
  const successfulPayments = payments.filter(p => p.status === 'succeeded');

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-8 py-6 text-white">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold">Customer Portal</h1>
                <p className="mt-2">Order #{formatOrderId(order.id)}</p>
                <p className="text-sm opacity-90">
                  Event Date: {format(new Date(order.event_date), 'MMMM d, yyyy')} at{' '}
                  {order.start_window}
                </p>
              </div>
              {canCancel && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors text-sm"
                >
                  Cancel Order
                </button>
              )}
            </div>
          </div>

          <div className="px-8 py-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Complete These Steps</h2>
              <div className="flex flex-wrap gap-3">
                {isPendingReview && (
                  <button
                    onClick={() => setShowLotPicturesModal(true)}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-lg font-semibold transition-colors"
                  >
                    <MapPin className="w-5 h-5" />
                    Upload Lot Pictures
                  </button>
                )}

                {!isPendingReview && (
                  <>
                    <button
                      onClick={() => setShowLotPicturesModal(true)}
                      className={`flex items-center gap-2 px-5 py-3 rounded-lg font-semibold transition-colors ${
                        needsWaiver
                          ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                      }`}
                    >
                      <MapPin className="w-5 h-5" />
                      Lot Pictures
                    </button>

                    <button
                      onClick={() => setShowWaiverModal(true)}
                      className={`flex items-center gap-2 px-5 py-3 rounded-lg font-semibold transition-colors ${
                        needsWaiver
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {needsWaiver ? (
                        <FileText className="w-5 h-5" />
                      ) : (
                        <CheckCircle className="w-5 h-5" />
                      )}
                      {needsWaiver ? 'Sign Waiver (Required)' : 'Waiver Signed'}
                    </button>

                    <button
                      onClick={() => setShowPicturesModal(true)}
                      className="flex items-center gap-2 bg-slate-200 text-slate-600 hover:bg-slate-300 px-5 py-3 rounded-lg font-semibold transition-colors"
                    >
                      <ImageIcon className="w-5 h-5" />
                      Event Pictures
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Order Information</h3>

                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Event Date</p>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-blue-600" />
                      <p className="font-medium text-slate-900">
                        {format(new Date(order.event_date), 'MMMM d, yyyy')}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-slate-600 mb-1">Time Window</p>
                    <p className="font-medium text-slate-900">{order.start_window}</p>
                  </div>
                </div>

                {order.addresses && (
                  <div className="mb-4">
                    <p className="text-xs text-slate-600 mb-1">Event Location</p>
                    <div className="flex items-start gap-2">
                      <MapPinIcon className="w-4 h-4 text-blue-600 mt-0.5" />
                      <p className="font-medium text-slate-900">
                        {order.addresses.line1}
                        {order.addresses.line2 && `, ${order.addresses.line2}`}
                        <br />
                        {order.addresses.city}, {order.addresses.state} {order.addresses.zip}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Summary</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(order.subtotal_cents)}
                    </span>
                  </div>
                  {order.travel_fee_cents > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Travel Fee:</span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(order.travel_fee_cents)}
                      </span>
                    </div>
                  )}
                  {order.surface_fee_cents > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Surface Fee:</span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(order.surface_fee_cents)}
                      </span>
                    </div>
                  )}
                  {order.tax_cents > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Tax:</span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(order.tax_cents)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-slate-300">
                    <span className="font-semibold text-slate-900">Total:</span>
                    <span className="text-lg font-bold text-slate-900">
                      {formatCurrency(
                        order.subtotal_cents +
                        order.travel_fee_cents +
                        order.surface_fee_cents +
                        order.same_day_pickup_fee_cents +
                        order.tax_cents
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Already Paid:</span>
                    <span className="font-semibold text-green-700">
                      {formatCurrency(totalPaid)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-300">
                    <span className="font-semibold text-slate-900">Balance Due:</span>
                    <span className="text-xl font-bold text-blue-600">
                      {formatCurrency(balanceDue)}
                    </span>
                  </div>
                </div>

                {balanceDue > 0 ? (
                  <button
                    onClick={handlePayment}
                    className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <CreditCard className="w-5 h-5" />
                    Pay Balance Now
                  </button>
                ) : (
                  <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                    <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                    <p className="font-semibold text-green-900">Payment Complete</p>
                    <p className="text-sm text-green-700 mt-1">Thank you for your payment!</p>
                  </div>
                )}
              </div>

              {successfulPayments.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment History</h3>
                  <div className="space-y-3">
                    {successfulPayments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex items-center justify-between bg-white border border-slate-200 rounded-lg p-4"
                      >
                        <div>
                          <p className="font-medium text-slate-900">
                            {formatCurrency(payment.amount_cents)}
                          </p>
                          <p className="text-xs text-slate-600">
                            {format(new Date(payment.created_at), 'MMM d, yyyy h:mm a')}
                          </p>
                          <p className="text-xs text-slate-500">
                            {payment.payment_method === 'card' ? 'Credit Card' : payment.payment_method}
                          </p>
                        </div>
                        <button
                          onClick={() => window.print()}
                          className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          <Printer className="w-4 h-4" />
                          Print Receipt
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-slate-600">
          <p>Questions? Call us or text us at the number provided in your confirmation.</p>
        </div>
      </div>

      {showWaiverModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-xl font-bold text-slate-900">Sign Waiver</h2>
              <button
                onClick={() => setShowWaiverModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              <WaiverTab orderId={orderId} order={order} />
            </div>
          </div>
        </div>
      )}

      {showLotPicturesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-xl font-bold text-slate-900">Lot Pictures</h2>
              <button
                onClick={() => setShowLotPicturesModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              <LotPicturesTab orderId={orderId} orderNumber={order.order_number} />
            </div>
          </div>
        </div>
      )}

      {showPicturesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-xl font-bold text-slate-900">Event Pictures</h2>
              <button
                onClick={() => setShowPicturesModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              <PicturesTab onSubmit={handleSubmitPictures} />
            </div>
          </div>
        </div>
      )}

      {showCancelModal && (
        <CancelOrderModal
          orderId={order.id}
          eventDate={order.event_date}
          onClose={() => setShowCancelModal(false)}
          onSuccess={() => {
            onReload();
            showToast('Your order has been cancelled', 'success');
          }}
        />
      )}
    </div>
  );
}
